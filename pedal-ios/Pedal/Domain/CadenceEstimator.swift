import Foundation

/// Result of one evaluation: dominant cadence and confidence (combined normalized
/// autocorrelation, 0…~1). rpm = 0 when there is no clear pedaling.
struct CadenceEstimate {
    let rpm: Double
    let confidence: Double
}

/// Estimates cadence by autocorrelation of the accelerometer signal,
/// with no thresholds to calibrate.
///
/// Analyzes the three axes separately and combines their energy-weighted
/// autocorrelations, so it detects both jerky pedaling (pulsing magnitude,
/// phone on the leg) and smooth circular motion, whose magnitude is nearly
/// constant but whose components rotate.
struct CadenceEstimator {
    let sampleRate: Double
    let windowSeconds: Double
    let evaluateEverySeconds: Double
    let minRPM: Double
    let maxRPM: Double
    /// Minimum confidence required to accept the periodicity.
    let minConfidence: Double

    private var buffers: [[Double]] = [[], [], []]
    private var samplesSinceEvaluation = 0

    init(
        sampleRate: Double = 50.0,
        windowSeconds: Double = 3.0,
        evaluateEverySeconds: Double = 0.5,
        minRPM: Double = 40.0,
        maxRPM: Double = 130.0,
        minConfidence: Double = 0.4
    ) {
        self.sampleRate = sampleRate
        self.windowSeconds = windowSeconds
        self.evaluateEverySeconds = evaluateEverySeconds
        self.minRPM = minRPM
        self.maxRPM = maxRPM
        self.minConfidence = minConfidence
    }

    mutating func process(x: Double, y: Double, z: Double) -> CadenceEstimate? {
        let windowSize = Int(windowSeconds * sampleRate)
        for (i, value) in [x, y, z].enumerated() {
            buffers[i].append(value)
            if buffers[i].count > windowSize {
                buffers[i].removeFirst(buffers[i].count - windowSize)
            }
        }
        samplesSinceEvaluation += 1
        guard buffers[0].count == windowSize,
              samplesSinceEvaluation >= Int(evaluateEverySeconds * sampleRate) else {
            return nil
        }
        samplesSinceEvaluation = 0
        return estimate()
    }

    private func estimate() -> CadenceEstimate {
        // Per axis: mean-removed signal and its energy.
        var detrended: [[Double]] = []
        var totalEnergy = 0.0
        for buffer in buffers {
            let mean = buffer.reduce(0, +) / Double(buffer.count)
            let x = buffer.map { $0 - mean }
            detrended.append(x)
            totalEnergy += x.reduce(0) { $0 + $1 * $1 }
        }
        // Flat signal on all three axes (phone at rest): nothing to look for.
        guard totalEnergy > 1e-9 else { return CadenceEstimate(rpm: 0, confidence: 0) }

        let minLag = Int((sampleRate * 60.0 / maxRPM).rounded(.down))
        let maxLag = Int((sampleRate * 60.0 / minRPM).rounded(.up))
        var bestLag = 0
        var bestR = 0.0
        for lag in minLag...maxLag where lag < detrended[0].count {
            var sum = 0.0
            for x in detrended {
                for i in 0..<(x.count - lag) {
                    sum += x[i] * x[i + lag]
                }
            }
            let r = sum / totalEnergy // combined, energy-weighted autocorrelation
            if r > bestR {
                bestR = r
                bestLag = lag
            }
        }
        guard bestLag > 0, bestR >= minConfidence else {
            return CadenceEstimate(rpm: 0, confidence: bestR)
        }
        return CadenceEstimate(rpm: 60.0 * sampleRate / Double(bestLag), confidence: bestR)
    }
}
