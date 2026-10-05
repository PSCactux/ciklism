import Foundation
import CoreMotion

/// Reads the accelerometer at 50 Hz and produces pedaling revolutions.
///
/// Two detection methods:
/// - `.frequency` (default): `CadenceEstimator` estimates the cadence by
///   autocorrelation (no thresholds) and revolutions are synthesized at that
///   cadence with `CadenceSimulator`.
/// - `.peaks`: classic peak detection with hysteresis (`PedalPeakDetector`)
///   and calibratable thresholds. Kept as a fallback until real bike data
///   validates the autocorrelation approach.
final class MotionRevolutionSource {

    enum DetectionMethod: String {
        case frequency
        case peaks
    }

    var onRevolution: ((TimeInterval) -> Void)?
    var onSample: ((TimeInterval, Double) -> Void)?
    /// Latest estimate (.frequency method only), for the calibration UI.
    var onCadenceEstimate: ((CadenceEstimate) -> Void)?

    var method: DetectionMethod = .frequency

    private let manager = CMMotionManager()
    private var detector = PedalPeakDetector()
    private var estimator = CadenceEstimator()
    private var synthesizer = CadenceSimulator(cadenceRPM: 0)
    private var lastSampleTime: TimeInterval?

    /// Live adjustment of the detection thresholds (.peaks method only).
    func setThresholds(high: Double, low: Double) {
        detector.highThreshold = high
        detector.lowThreshold = low
    }

    func start() {
        guard manager.isDeviceMotionAvailable else { return }
        estimator = CadenceEstimator()
        synthesizer = CadenceSimulator(cadenceRPM: 0)
        lastSampleTime = nil
        manager.deviceMotionUpdateInterval = 1.0 / 50.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let self, let m = motion else { return }
            let a = m.userAcceleration
            let magnitude = (a.x * a.x + a.y * a.y + a.z * a.z).squareRoot()
            self.onSample?(m.timestamp, magnitude)
            switch self.method {
            case .peaks:
                if self.detector.process(magnitude: magnitude, at: m.timestamp) {
                    self.onRevolution?(m.timestamp)
                }
            case .frequency:
                if let estimate = self.estimator.process(x: a.x, y: a.y, z: a.z) {
                    self.synthesizer.cadenceRPM = estimate.rpm
                    self.onCadenceEstimate?(estimate)
                }
                if let last = self.lastSampleTime {
                    let revs = self.synthesizer.advance(by: m.timestamp - last)
                    for _ in 0..<revs { self.onRevolution?(m.timestamp) }
                }
            }
            self.lastSampleTime = m.timestamp
        }
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
    }
}
