import SwiftUI

struct ContentView: View {
    @ObservedObject var peripheral: CadencePeripheral
    @StateObject private var session: SessionController

    init(peripheral: CadencePeripheral) {
        self.peripheral = peripheral
        _session = StateObject(wrappedValue: SessionController(sender: peripheral))
    }

    // With no subscribed viewer there's nobody to send to, so Start waits for a connection.
    // Stop stays available even if the viewer drops mid-session.
    private var startDisabled: Bool {
        !session.running && peripheral.subscriberCount == 0
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                Text("Pedal").font(.largeTitle.bold())

                NavigationLink {
                    BleDetailView(peripheral: peripheral)
                } label: {
                    HStack(spacing: 4) {
                        Text(peripheral.status)
                        Image(systemName: "chevron.right").font(.caption2)
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)

                Text("\(Int(session.currentRPM)) rpm")
                    .font(.system(size: 64, weight: .heavy, design: .rounded))
                    .monospacedDigit()

                Picker("Modo", selection: $session.mode) {
                    Text("Simulación").tag(SessionController.Mode.simulated)
                    Text("Pedaleo real").tag(SessionController.Mode.motion)
                }
                .pickerStyle(.segmented)
                .disabled(session.running)
                .padding(.horizontal)

                if session.mode == .simulated {
                    VStack {
                        Slider(value: $session.simulatedCadence, in: 0...120, step: 5)
                        Text("Cadencia simulada: \(Int(session.simulatedCadence)) rpm")
                            .font(.caption)
                    }
                    .padding(.horizontal)
                } else if session.running || session.previewingCalibration {
                    // Signal indicator: green = pedaling detected, nothing to calibrate.
                    HStack(spacing: 8) {
                        Circle()
                            .fill(session.estimatedCadence > 0 ? Color.green : Color.orange)
                            .frame(width: 12, height: 12)
                        Text(session.estimatedCadence > 0
                             ? "Pedaleo detectado: \(Int(session.estimatedCadence)) rpm"
                             : "Sin pedaleo detectado — sigue unos segundos o revisa la sujeción")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.horizontal)
                }

                Button(action: { session.running ? session.stop() : session.start() }) {
                    Text(session.running ? "Parar" : "Empezar")
                        .font(.title2.bold())
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(startDisabled ? Color.gray : (session.running ? Color.red : Color.green))
                        .foregroundStyle(.white)
                        .clipShape(RoundedRectangle(cornerRadius: 16))
                }
                .disabled(startDisabled)
                .padding(.horizontal)

                if startDisabled {
                    Text("Esperando al visor: conéctate desde la app Ciklism y Empezar se activará.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                NavigationLink("Calibración (acelerómetro)") {
                    DebugChartView(session: session, buffer: session.motionSamples)
                }
                .font(.footnote)

                Spacer()
            }
            .padding(.top, 40)
        }
    }
}
