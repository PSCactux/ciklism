import Foundation

/// Detects pedaling revolutions by threshold crossing with hysteresis.
/// The default thresholds are calibrated against real data in the final phase.
struct PedalPeakDetector {
    var highThreshold: Double
    var lowThreshold: Double
    var minInterval: TimeInterval

    private var armed = true
    private var lastRevolution: TimeInterval = -.infinity

    init(highThreshold: Double = 0.4, lowThreshold: Double = 0.25, minInterval: TimeInterval = 0.3) {
        self.highThreshold = highThreshold
        self.lowThreshold = lowThreshold
        self.minInterval = minInterval
    }

    mutating func process(magnitude: Double, at t: TimeInterval) -> Bool {
        if armed, magnitude >= highThreshold, t - lastRevolution >= minInterval {
            armed = false
            lastRevolution = t
            return true
        }
        if !armed, magnitude <= lowThreshold {
            armed = true
        }
        return false
    }
}
