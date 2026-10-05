import SwiftUI

@main
struct PedalApp: App {
    @StateObject private var peripheral = CadencePeripheral()

    var body: some Scene {
        WindowGroup {
            ContentView(peripheral: peripheral)
        }
    }
}
