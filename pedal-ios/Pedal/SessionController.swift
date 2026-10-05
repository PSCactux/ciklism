import Foundation
import Combine

protocol MeasurementSender: AnyObject {
    func send(_ m: CSCMeasurement)
    var statusText: String { get }
}

@MainActor
final class SessionController: ObservableObject {
    enum Mode { case simulated, motion }

    @Published var mode: Mode = .simulated
    @Published var simulatedCadence: Double = 80
    @Published private(set) var running = false
    @Published private(set) var currentRPM: Double = 0

    // Calibration: detector thresholds, adjustable live and persisted.
    @Published var highThreshold: Double { didSet { thresholdsChanged() } }
    @Published var lowThreshold: Double { didSet { thresholdsChanged() } }
    /// Pedal-stroke detection method (threshold-free frequency / peaks), persisted.
    @Published var detectionMethod: MotionRevolutionSource.DetectionMethod { didSet { applyMethod() } }
    /// Latest cadence estimated by autocorrelation (0 = no clear pedaling).
    @Published private(set) var estimatedCadence: Double = 0
    /// Confidence (0…~1) of the latest estimate; drives the signal indicator.
    @Published private(set) var estimateConfidence: Double = 0
    /// The calibration screen is sampling the sensor with no session running.
    @Published private(set) var previewingCalibration = false
    /// Session pedal-stroke counter, for the manual counting test.
    @Published private(set) var revolutionsThisSession = 0

    let motionSamples = MotionSampleBuffer()

    private static let highThresholdKey = "calib.highThreshold"
    private static let lowThresholdKey = "calib.lowThreshold"
    private static let methodKey = "calib.detectionMethod"
    private let defaults: UserDefaults
    private let sender: MeasurementSender
    private var crank = CrankState()
    private var simulator = CadenceSimulator(cadenceRPM: 0)
    private var lastRevolutionAt: TimeInterval?
    private var tickTimer: Timer?
    private var notifyTimer: Timer?
    private let epoch = Date()
    private let motionSource = MotionRevolutionSource()
    private let logger = RawMotionLogger(directory: FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0])

    init(sender: MeasurementSender, defaults: UserDefaults = .standard) {
        self.sender = sender
        self.defaults = defaults
        self.highThreshold = defaults.object(forKey: Self.highThresholdKey) as? Double ?? 0.4
        self.lowThreshold = defaults.object(forKey: Self.lowThresholdKey) as? Double ?? 0.25
        self.detectionMethod = defaults.string(forKey: Self.methodKey)
            .flatMap(MotionRevolutionSource.DetectionMethod.init(rawValue:)) ?? .frequency
        applyThresholds() // didSet doesn't fire during init
        applyMethod()
        motionSource.onCadenceEstimate = { [weak self] estimate in
            Task { @MainActor in
                self?.estimatedCadence = estimate.rpm
                self?.estimateConfidence = estimate.confidence
            }
        }
    }

    deinit {
        tickTimer?.invalidate()
        notifyTimer?.invalidate()
        motionSource.stop()
        logger.finish()
    }

    var senderStatus: String { sender.statusText }

    func resetTestCounter() {
        revolutionsThisSession = 0
    }

    /// The calibration screen turns the sensor on when opened, even with no
    /// session: it only feeds the chart and the estimated cadence, never the
    /// counter or BLE (onRevolution stays disconnected).
    func startCalibrationPreview() {
        guard !(running && mode == .motion) else { return } // already sampling for real
        guard !previewingCalibration else { return }
        previewingCalibration = true
        motionSource.onRevolution = nil
        motionSource.onSample = { [weak self] t, mag in
            Task { @MainActor in
                self?.motionSamples.append(t: t, magnitude: mag)
                self?.logger.append(t: t, magnitude: mag) // no-op when no log is open
            }
        }
        motionSource.start()
    }

    func stopCalibrationPreview() {
        guard previewingCalibration else { return }
        previewingCalibration = false
        if !(running && mode == .motion) {
            motionSource.stop()
        }
    }

    // Low always stays at least 0.05 g below high (useful hysteresis).
    private func thresholdsChanged() {
        if lowThreshold > highThreshold - 0.05 {
            lowThreshold = max(0.05, highThreshold - 0.05) // re-triggers didSet, now with the condition false
            return
        }
        applyThresholds()
    }

    private func applyThresholds() {
        motionSource.setThresholds(high: highThreshold, low: lowThreshold)
        defaults.set(highThreshold, forKey: Self.highThresholdKey)
        defaults.set(lowThreshold, forKey: Self.lowThresholdKey)
    }

    private func applyMethod() {
        motionSource.method = detectionMethod
        defaults.set(detectionMethod.rawValue, forKey: Self.methodKey)
    }

    func start() {
        running = true
        revolutionsThisSession = 0
        if previewingCalibration && mode == .simulated {
            motionSource.stop() // a simulated session doesn't need the sensor
        }
        previewingCalibration = false // the session takes over the sensor
        scheduleTimers()
        if mode == .motion {
            try? logger.startNewLog()
            motionSource.onSample = { [weak self] t, mag in
                Task { @MainActor in
                    self?.motionSamples.append(t: t, magnitude: mag)
                    self?.logger.append(t: t, magnitude: mag)
                }
            }
            motionSource.onRevolution = { [weak self] _ in
                Task { @MainActor in
                    guard let self else { return }
                    self.registerRevolution(at: Date().timeIntervalSince(self.epoch))
                }
            }
            motionSource.start()
        }
    }

    func stop() {
        running = false
        currentRPM = 0
        tickTimer?.invalidate()
        notifyTimer?.invalidate()
        motionSource.stop()
        logger.finish()
    }

    /// Advances the simulated source and decays the displayed cadence. `now` is seconds since the session epoch.
    func tick(dt: TimeInterval, now: TimeInterval) {
        guard running else { return }
        if mode == .simulated {
            simulator.cadenceRPM = simulatedCadence
            let revs = simulator.advance(by: dt)
            for _ in 0..<revs { registerRevolution(at: now) }
        }
        if let last = lastRevolutionAt, now - last > 3.0 {
            currentRPM = 0
        }
    }

    /// Single entry point for revolutions, used by both the simulator and the motion source.
    func registerRevolution(at t: TimeInterval) {
        guard running else { return }
        crank.addRevolution(at: t)
        revolutionsThisSession += 1
        if let last = lastRevolutionAt, t > last {
            currentRPM = 60.0 / (t - last)
        }
        lastRevolutionAt = t
    }

    /// Sends the current CSC measurement (~1/s from the timer).
    func notifyTick(now: TimeInterval) {
        guard running else { return }
        sender.send(crank.measurement)
    }

    private func scheduleTimers() {
        tickTimer?.invalidate()
        notifyTimer?.invalidate()
        tickTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.tick(dt: 0.1, now: Date().timeIntervalSince(self.epoch))
            }
        }
        notifyTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.notifyTick(now: Date().timeIntervalSince(self.epoch))
            }
        }
    }
}

@MainActor
final class MotionSampleBuffer: ObservableObject {
    @Published private(set) var samples: [(t: TimeInterval, magnitude: Double)] = []
    func append(t: TimeInterval, magnitude: Double) {
        samples.append((t, magnitude))
        if samples.count > 250 { samples.removeFirst(samples.count - 250) } // last 5 s at 50 Hz
    }
    func clear() { samples.removeAll() }
}
