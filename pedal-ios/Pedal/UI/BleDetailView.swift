import SwiftUI

/// BLE peripheral status details, with a manual advertising restart.
struct BleDetailView: View {
    @ObservedObject var peripheral: CadencePeripheral

    var body: some View {
        List {
            Section("Estado") {
                LabeledContent("Bluetooth", value: peripheral.bluetoothState)
                LabeledContent("Anuncio",
                               value: peripheral.advertising ? "anunciando como \"Pedal\"" : "detenido")
                LabeledContent("Visores conectados", value: "\(peripheral.subscriberCount)")
            }
            Section("Tráfico") {
                LabeledContent("Medidas enviadas", value: "\(peripheral.measurementsSent)")
                if peripheral.droppedMeasurements > 0 {
                    LabeledContent("Medidas descartadas", value: "\(peripheral.droppedMeasurements)")
                }
            }
            if let error = peripheral.lastError {
                Section("Último error") {
                    Text(error).foregroundStyle(.red)
                }
            }
            Section {
                Button("Reconectar (reiniciar anuncio)") {
                    peripheral.restartAdvertising()
                }
            } footer: {
                Text("Corta el anuncio actual, vuelve a registrar el servicio de cadencia y anuncia de nuevo. Útil si el visor se queda enganchado buscando.")
            }
        }
        .navigationTitle("Estado Bluetooth")
    }
}
