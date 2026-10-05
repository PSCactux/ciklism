import XCTest
@testable import Pedal

final class PedalPeakDetectorTests: XCTestCase {
    private func makeDetector() -> PedalPeakDetector {
        PedalPeakDetector(highThreshold: 1.0, lowThreshold: 0.5, minInterval: 0.3)
    }

    func testCrossingHighThresholdCountsOneRevolution() {
        var d = makeDetector()
        XCTAssertFalse(d.process(magnitude: 0.2, at: 0.00))
        XCTAssertTrue(d.process(magnitude: 1.2, at: 0.02))
    }

    func testStayingHighDoesNotRecount() {
        var d = makeDetector()
        XCTAssertTrue(d.process(magnitude: 1.2, at: 0.0))
        XCTAssertFalse(d.process(magnitude: 1.5, at: 0.4))
        XCTAssertFalse(d.process(magnitude: 1.1, at: 0.8))
    }

    func testRearmsAfterDroppingBelowLowThreshold() {
        var d = makeDetector()
        XCTAssertTrue(d.process(magnitude: 1.2, at: 0.0))
        XCTAssertFalse(d.process(magnitude: 0.3, at: 0.5)) // re-arms
        XCTAssertTrue(d.process(magnitude: 1.2, at: 1.0))
    }

    func testRespectsMinInterval() {
        var d = makeDetector()
        XCTAssertTrue(d.process(magnitude: 1.2, at: 0.00))
        XCTAssertFalse(d.process(magnitude: 0.3, at: 0.05)) // re-arms
        XCTAssertFalse(d.process(magnitude: 1.2, at: 0.10)) // too soon
        XCTAssertFalse(d.process(magnitude: 0.3, at: 0.20))
        XCTAssertTrue(d.process(magnitude: 1.2, at: 0.40))  // minInterval has elapsed
    }

    func testSubThresholdNoiseCountsNothing() {
        var d = makeDetector()
        for i in 0..<100 {
            XCTAssertFalse(d.process(magnitude: 0.4, at: Double(i) * 0.02))
        }
    }

    func testSyntheticPedalingAt60RPM() {
        // 1 Hz sine wave for 5 s at 50 Hz: 5 peaks = 5 revolutions.
        var d = makeDetector()
        var revs = 0
        for i in 0..<250 {
            let t = Double(i) * 0.02
            let magnitude = 0.75 + 0.75 * sin(2 * .pi * t) // oscillates between 0 and 1.5
            if d.process(magnitude: magnitude, at: t) { revs += 1 }
        }
        XCTAssertEqual(revs, 5)
    }
}
