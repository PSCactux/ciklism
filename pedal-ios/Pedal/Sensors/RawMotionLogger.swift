import Foundation

/// Records raw accelerometer samples to CSV for calibrating the detector.
/// Files are stored in Documents (visible from the Files app).
final class RawMotionLogger {
    private let directory: URL
    private var handle: FileHandle?
    private(set) var currentLogURL: URL?

    init(directory: URL) {
        self.directory = directory
    }

    func startNewLog() throws {
        let name = "pedal-log-\(Int(Date().timeIntervalSince1970)).csv"
        let url = directory.appendingPathComponent(name)
        try "t,magnitude\n".data(using: .utf8)!.write(to: url)
        handle = try FileHandle(forWritingTo: url)
        handle?.seekToEndOfFile()
        currentLogURL = url
    }

    func append(t: TimeInterval, magnitude: Double) {
        guard let data = "\(t),\(magnitude)\n".data(using: .utf8) else { return }
        try? handle?.write(contentsOf: data)
    }

    func finish() {
        try? handle?.close()
        handle = nil
    }
}
