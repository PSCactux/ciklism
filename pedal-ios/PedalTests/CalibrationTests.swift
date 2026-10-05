import XCTest
@testable import Pedal

@MainActor
final class CalibrationTests: XCTestCase {

    private func makeController(suite: String = "test-calib-\(UUID().uuidString)") -> SessionController {
        SessionController(sender: FakeSender(), defaults: UserDefaults(suiteName: suite)!)
    }

    func testDefaultThresholds() {
        let c = makeController()
        XCTAssertEqual(c.highThreshold, 0.4, accuracy: 1e-9)
        XCTAssertEqual(c.lowThreshold, 0.25, accuracy: 1e-9)
    }

    func testSessionRevolutionCounterIncrementsAndResetsOnStart() {
        let c = makeController()
        c.start()
        c.registerRevolution(at: 1.0)
        c.registerRevolution(at: 1.5)
        c.registerRevolution(at: 2.0)
        XCTAssertEqual(c.revolutionsThisSession, 3)
        c.stop()
        c.start()
        XCTAssertEqual(c.revolutionsThisSession, 0) // each test session starts from zero
    }

    func testResetTestCounterMidSession() {
        let c = makeController()
        c.start()
        c.registerRevolution(at: 1.0)
        c.resetTestCounter()
        XCTAssertEqual(c.revolutionsThisSession, 0)
        c.registerRevolution(at: 2.0)
        XCTAssertEqual(c.revolutionsThisSession, 1)
    }

    func testLowThresholdClampedBelowHigh() {
        let c = makeController()
        c.lowThreshold = 0.5 // invalid with high=0.4: must clamp to high - 0.05
        XCTAssertEqual(c.lowThreshold, 0.35, accuracy: 1e-9)
        c.highThreshold = 0.2 // lowering high drags low down with it
        XCTAssertEqual(c.lowThreshold, 0.15, accuracy: 1e-9)
    }

    func testDetectionMethodDefaultsToFrequencyAndPersists() {
        let suite = "test-calib-method-\(UUID().uuidString)"
        let c1 = makeController(suite: suite)
        XCTAssertEqual(c1.detectionMethod, .frequency)
        c1.detectionMethod = .peaks
        let c2 = makeController(suite: suite)
        XCTAssertEqual(c2.detectionMethod, .peaks)
    }

    func testCalibrationPreviewTogglesWhenNoSessionRunning() {
        let c = makeController()
        XCTAssertFalse(c.previewingCalibration)
        c.startCalibrationPreview()
        XCTAssertTrue(c.previewingCalibration)
        c.stopCalibrationPreview()
        XCTAssertFalse(c.previewingCalibration)
    }

    func testCalibrationPreviewIsNoOpDuringRealMotionSession() {
        let c = makeController()
        c.mode = .motion
        c.start()
        c.startCalibrationPreview() // already sampling for real: no preview needed
        XCTAssertFalse(c.previewingCalibration)
        c.stop()
    }

    func testPreviewDuringSimulatedSessionDoesNotFeedRevolutions() {
        let c = makeController()
        c.mode = .simulated
        c.start()
        c.startCalibrationPreview()
        XCTAssertTrue(c.previewingCalibration)
        // the preview must not pollute the simulated session's counter
        XCTAssertEqual(c.revolutionsThisSession, 0)
        c.stopCalibrationPreview()
        c.stop()
    }

    func testThresholdsPersistAcrossControllers() {
        let suite = "test-calib-persist-\(UUID().uuidString)"
        let c1 = makeController(suite: suite)
        c1.highThreshold = 0.7
        c1.lowThreshold = 0.3
        let c2 = makeController(suite: suite)
        XCTAssertEqual(c2.highThreshold, 0.7, accuracy: 1e-9)
        XCTAssertEqual(c2.lowThreshold, 0.3, accuracy: 1e-9)
    }
}
