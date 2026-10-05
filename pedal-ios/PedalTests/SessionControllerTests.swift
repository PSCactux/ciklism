import XCTest
@testable import Pedal

final class FakeSender: MeasurementSender {
    var sent: [CSCMeasurement] = []
    var statusText: String = "fake"
    func send(_ m: CSCMeasurement) { sent.append(m) }
}

@MainActor
final class SessionControllerTests: XCTestCase {
    func testSimulatedModeAccumulatesRevolutions() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.mode = .simulated
        c.simulatedCadence = 60
        c.start()
        // dt = 0.25 is exact in binary: 4 ticks sum to exactly 1.0 (10×0.1 would give 0.999…)
        for i in 1...4 { c.tick(dt: 0.25, now: Double(i) * 0.25) } // 1 s at 60 rpm → 1 rev
        c.notifyTick(now: 1.0)
        XCTAssertEqual(sender.sent.count, 1)
        XCTAssertEqual(sender.sent[0].cumulativeCrankRevolutions, 1)
    }

    func testNotifyWithoutRunningSendsNothing() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.notifyTick(now: 1.0)
        XCTAssertTrue(sender.sent.isEmpty)
    }

    func testCurrentRPMFromRevolutionInterval() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.start()
        c.registerRevolution(at: 1.0)
        c.registerRevolution(at: 1.5) // 0.5 s between revs → 120 rpm
        XCTAssertEqual(c.currentRPM, 120, accuracy: 0.1)
    }

    func testRPMDecaysToZeroAfterThreeSecondsWithoutRevs() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.start()
        c.registerRevolution(at: 1.0)
        c.registerRevolution(at: 1.5)
        c.tick(dt: 0.1, now: 5.0) // > 3 s since the last rev
        XCTAssertEqual(c.currentRPM, 0)
    }

    func testRPMDecayUsesSessionTimeBase() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.start()
        c.registerRevolution(at: 1.0)
        c.registerRevolution(at: 1.5) // 120 rpm in the session time base
        c.tick(dt: 0.1, now: 5.0)     // 3.5 s without revolutions → decays
        XCTAssertEqual(c.currentRPM, 0)
        c.registerRevolution(at: 6.0) // a later rev resumes the calculation
        c.registerRevolution(at: 6.5)
        XCTAssertEqual(c.currentRPM, 120, accuracy: 0.1)
    }

    func testStopResetsRunningButKeepsCounter() {
        let sender = FakeSender()
        let c = SessionController(sender: sender)
        c.start()
        c.registerRevolution(at: 1.0)
        c.stop()
        XCTAssertFalse(c.running)
        c.start()
        c.registerRevolution(at: 2.0)
        c.notifyTick(now: 2.0)
        XCTAssertEqual(sender.sent.last?.cumulativeCrankRevolutions, 2) // the cumulative CSC count never resets
    }
}
