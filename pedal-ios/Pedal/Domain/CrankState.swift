import Foundation

/// Cumulative crank revolution counter, per the CSC specification.
struct CrankState {
    private(set) var revolutions: UInt16
    private(set) var lastEventTime1024: UInt16

    // Explicit init: with private(set) the synthesized memberwise init would be private
    // and tests couldn't build arbitrary initial states.
    init(revolutions: UInt16 = 0, lastEventTime1024: UInt16 = 0) {
        self.revolutions = revolutions
        self.lastEventTime1024 = lastEventTime1024
    }

    mutating func addRevolution(at t: TimeInterval) {
        revolutions &+= 1
        lastEventTime1024 = UInt16(UInt64(t * 1024.0) % 65536)
    }

    var measurement: CSCMeasurement {
        CSCMeasurement(cumulativeCrankRevolutions: revolutions,
                       lastCrankEventTime: lastEventTime1024)
    }
}
