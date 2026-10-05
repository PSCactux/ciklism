import XCTest
@testable import Pedal

final class CadenceSimulatorTests: XCTestCase {
    func testSixtyRPMisOneRevPerSecond() {
        var s = CadenceSimulator(cadenceRPM: 60)
        XCTAssertEqual(s.advance(by: 1.0), 1)
    }

    func testZeroCadenceProducesNothing() {
        var s = CadenceSimulator(cadenceRPM: 0)
        XCTAssertEqual(s.advance(by: 10.0), 0)
    }

    func testResidualCarriesAcrossCalls() {
        var s = CadenceSimulator(cadenceRPM: 120) // period 0.5 s
        XCTAssertEqual(s.advance(by: 0.4), 0)
        XCTAssertEqual(s.advance(by: 0.2), 1) // 0.4 + 0.2 = 0.6 → 1 rev, remainder 0.1
    }

    func testLargeDtProducesMultipleRevs() {
        var s = CadenceSimulator(cadenceRPM: 90) // period 0.666… s
        XCTAssertEqual(s.advance(by: 2.0), 3)
    }

    func testZeroCadenceResetsResidual() {
        var s = CadenceSimulator(cadenceRPM: 60)
        _ = s.advance(by: 0.9)          // remainder 0.9
        s.cadenceRPM = 0
        _ = s.advance(by: 1.0)          // stopped: discards the remainder
        s.cadenceRPM = 60
        XCTAssertEqual(s.advance(by: 0.5), 0) // doesn't carry over the earlier 0.9
    }
}
