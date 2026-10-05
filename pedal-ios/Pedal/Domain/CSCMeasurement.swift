import Foundation

/// CSC Measurement characteristic (0x2A5B) with crank data only.
struct CSCMeasurement: Equatable {
    let cumulativeCrankRevolutions: UInt16
    let lastCrankEventTime: UInt16 // units of 1/1024 s

    func encode() -> Data {
        var d = Data([0x02]) // flags: crank revolution data present
        d.append(contentsOf: withUnsafeBytes(of: cumulativeCrankRevolutions.littleEndian, Array.init))
        d.append(contentsOf: withUnsafeBytes(of: lastCrankEventTime.littleEndian, Array.init))
        return d
    }
}
