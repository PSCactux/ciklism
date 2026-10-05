import XCTest
@testable import Pedal

final class RawMotionLoggerTests: XCTestCase {
    func testWritesCSVSamples() throws {
        let dir = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let logger = RawMotionLogger(directory: dir)
        try logger.startNewLog()
        logger.append(t: 0.02, magnitude: 0.5)
        logger.append(t: 0.04, magnitude: 1.25)
        logger.finish()
        let url = try XCTUnwrap(logger.currentLogURL)
        let content = try String(contentsOf: url, encoding: .utf8)
        XCTAssertEqual(content, "t,magnitude\n0.02,0.5\n0.04,1.25\n")
    }
}
