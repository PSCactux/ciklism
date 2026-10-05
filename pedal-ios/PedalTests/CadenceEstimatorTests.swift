import XCTest
@testable import Pedal

final class CadenceEstimatorTests: XCTestCase {

    /// Feeds `seconds` of per-axis signal sampled at 50 Hz and returns the latest estimate.
    private func feed(
        _ estimator: inout CadenceEstimator,
        seconds: Double,
        signal: (Double) -> (x: Double, y: Double, z: Double)
    ) -> CadenceEstimate? {
        var last: CadenceEstimate? = nil
        let n = Int(seconds * 50.0)
        for i in 0..<n {
            let t = Double(i) / 50.0
            let s = signal(t)
            if let e = estimator.process(x: s.x, y: s.y, z: s.z) { last = e }
        }
        return last
    }

    func testDetectsSixtyRpmPulsingOnOneAxis() {
        var e = CadenceEstimator()
        // jerky, pulsing pedaling at 60 rpm: oscillation on one axis
        let est = feed(&e, seconds: 4.0) { t in (0.5 * sin(2 * .pi * t), 0.0, 0.0) }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 60.0, accuracy: 3.0)
        XCTAssertGreaterThan(est!.confidence, 0.4)
    }

    /// Smooth circular ("crank") motion: the magnitude is constant but
    /// the components rotate. The magnitude-based version was blind to this.
    func testDetectsSmoothCircularMotionWithConstantMagnitude() {
        var e = CadenceEstimator()
        let est = feed(&e, seconds: 4.0) { t in
            (0.5 * cos(2 * .pi * t), 0.5 * sin(2 * .pi * t), 0.0)
        }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 60.0, accuracy: 3.0)
        XCTAssertGreaterThan(est!.confidence, 0.4)
    }

    func testDetectsNinetyRpm() {
        var e = CadenceEstimator()
        let est = feed(&e, seconds: 4.0) { t in (0.5 * sin(2 * .pi * 1.5 * t), 0.0, 0.0) }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 90.0, accuracy: 4.0)
    }

    func testSilenceYieldsZeroWithLowConfidence() {
        var e = CadenceEstimator()
        let est = feed(&e, seconds: 4.0) { _ in (0.0, 0.0, 0.0) }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 0.0)
        XCTAssertLessThan(est!.confidence, 0.4)
    }

    func testConstantOffsetYieldsZero() {
        var e = CadenceEstimator()
        // phone at rest: constant components, no periodicity
        let est = feed(&e, seconds: 4.0) { _ in (0.1, -0.2, 0.05) }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 0.0)
    }

    func testNoEstimateBeforeWindowFills() {
        var e = CadenceEstimator()
        let est = feed(&e, seconds: 2.0) { t in (0.5 * sin(2 * .pi * t), 0.0, 0.0) }
        XCTAssertNil(est)
    }

    func testTracksCadenceChange() {
        var e = CadenceEstimator()
        _ = feed(&e, seconds: 4.0) { t in (0.5 * sin(2 * .pi * t), 0.0, 0.0) }
        let est = feed(&e, seconds: 5.0) { t in (0.5 * sin(2 * .pi * 1.5 * t), 0.0, 0.0) }
        XCTAssertNotNil(est)
        XCTAssertEqual(est!.rpm, 90.0, accuracy: 4.0)
    }
}
