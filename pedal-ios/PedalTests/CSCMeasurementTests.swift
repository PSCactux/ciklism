import XCTest
@testable import Pedal

final class CSCMeasurementTests: XCTestCase {
    func testEncodeFlagsCrankDataLittleEndian() {
        let m = CSCMeasurement(cumulativeCrankRevolutions: 5, lastCrankEventTime: 1028)
        // flags 0x02 (crank data present), revs 0x0005 LE, time 0x0404 LE
        XCTAssertEqual(m.encode(), Data([0x02, 0x05, 0x00, 0x04, 0x04]))
    }

    func testEncodeMaxValues() {
        let m = CSCMeasurement(cumulativeCrankRevolutions: 0xFFFF, lastCrankEventTime: 0xFFFF)
        XCTAssertEqual(m.encode(), Data([0x02, 0xFF, 0xFF, 0xFF, 0xFF]))
    }
}
