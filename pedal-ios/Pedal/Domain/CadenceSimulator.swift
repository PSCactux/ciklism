import Foundation

/// Generates synthetic revolutions at a given cadence, for development without a bike.
struct CadenceSimulator {
    var cadenceRPM: Double
    private var residual: TimeInterval = 0

    init(cadenceRPM: Double) {
        self.cadenceRPM = cadenceRPM
    }

    mutating func advance(by dt: TimeInterval) -> Int {
        guard cadenceRPM > 0 else {
            residual = 0
            return 0
        }
        let period = 60.0 / cadenceRPM
        residual += dt
        let revs = Int(residual / period)
        residual -= Double(revs) * period
        return revs
    }
}
