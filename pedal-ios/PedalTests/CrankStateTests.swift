import XCTest
@testable import Pedal

final class CrankStateTests: XCTestCase {
    func testAddRevolutionIncrementsAndStampsTimeIn1024ths() {
        var s = CrankState()
        s.addRevolution(at: 2.0) // 2 s → 2048 units of 1/1024 s
        XCTAssertEqual(s.revolutions, 1)
        XCTAssertEqual(s.lastEventTime1024, 2048)
    }

    func testRevolutionCounterWrapsAt16Bits() {
        var s = CrankState(revolutions: 0xFFFF, lastEventTime1024: 0)
        s.addRevolution(at: 1.0)
        XCTAssertEqual(s.revolutions, 0)
    }

    func testEventTimeWrapsModulo65536() {
        var s = CrankState()
        s.addRevolution(at: 64.5) // 64.5 * 1024 = 66048 → 66048 % 65536 = 512
        XCTAssertEqual(s.lastEventTime1024, 512)
    }

    func testMeasurementReflectsState() {
        var s = CrankState()
        s.addRevolution(at: 1.0)
        let m = s.measurement
        XCTAssertEqual(m.cumulativeCrankRevolutions, 1)
        XCTAssertEqual(m.lastCrankEventTime, 1024)
    }
}
