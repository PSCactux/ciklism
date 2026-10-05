import Foundation
import CoreBluetooth

/// BLE peripheral that mimics a commercial cadence sensor (CSC profile).
final class CadencePeripheral: NSObject, ObservableObject, MeasurementSender {
    static let cscService = CBUUID(string: "1816")
    static let cscMeasurement = CBUUID(string: "2A5B")
    static let cscFeature = CBUUID(string: "2A5C")
    static let sensorLocation = CBUUID(string: "2A5D")

    /// Summary for the main screen.
    @Published private(set) var status: String = "iniciando…"
    // Details for the Bluetooth status screen.
    @Published private(set) var bluetoothState: String = "desconocido"
    @Published private(set) var advertising = false
    @Published private(set) var subscriberCount = 0
    @Published private(set) var measurementsSent = 0
    @Published private(set) var droppedMeasurements = 0
    @Published private(set) var lastError: String?

    var statusText: String { status }

    private var manager: CBPeripheralManager!
    private var measurementChar: CBMutableCharacteristic?
    private var subscribedCentrals = Set<UUID>()

    override init() {
        super.init()
        manager = CBPeripheralManager(delegate: self, queue: nil)
    }

    func send(_ m: CSCMeasurement) {
        guard let c = measurementChar else { return }
        if manager.updateValue(m.encode(), for: c, onSubscribedCentrals: nil) {
            measurementsSent += 1
        } else {
            droppedMeasurements += 1 // queue full; the next cumulative measurement makes up for it
        }
    }

    /// Manually restarts the service and advertising (the detail screen's "Reconectar" button).
    func restartAdvertising() {
        guard manager.state == .poweredOn else {
            status = "bluetooth no disponible"
            return
        }
        lastError = nil
        advertising = false
        subscribedCentrals.removeAll()
        subscriberCount = 0
        setupService(on: manager)
        status = "reiniciando anuncio…"
    }

    private func setupService(on peripheral: CBPeripheralManager) {
        peripheral.stopAdvertising()
        peripheral.removeAllServices()
        let service = CBMutableService(type: Self.cscService, primary: true)
        let measurement = CBMutableCharacteristic(
            type: Self.cscMeasurement, properties: [.notify], value: nil, permissions: [])
        let feature = CBMutableCharacteristic(
            type: Self.cscFeature, properties: [.read],
            value: Data([0x02, 0x00]), permissions: [.readable]) // crank revolution data supported
        let location = CBMutableCharacteristic(
            type: Self.sensorLocation, properties: [.read],
            value: Data([0x05]), permissions: [.readable]) // left crank
        service.characteristics = [measurement, feature, location]
        measurementChar = measurement
        peripheral.add(service)
    }
}

extension CadencePeripheral: CBPeripheralManagerDelegate {
    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        bluetoothState = switch peripheral.state {
        case .poweredOn: "encendido"
        case .poweredOff: "apagado"
        case .unauthorized: "sin permiso"
        case .unsupported: "no soportado"
        case .resetting: "reiniciando"
        default: "desconocido"
        }
        guard peripheral.state == .poweredOn else {
            advertising = false
            subscribedCentrals.removeAll()
            subscriberCount = 0
            status = "bluetooth no disponible"
            return
        }
        setupService(on: peripheral)
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           didAdd service: CBService,
                           error: Error?) {
        if let error {
            lastError = "registro del servicio: \(error.localizedDescription)"
            status = "error al registrar servicio BLE"
            return
        }
        peripheral.startAdvertising([
            CBAdvertisementDataServiceUUIDsKey: [Self.cscService],
            CBAdvertisementDataLocalNameKey: "Pedal",
        ])
    }

    func peripheralManagerDidStartAdvertising(_ peripheral: CBPeripheralManager,
                                              error: Error?) {
        if let error {
            advertising = false
            lastError = "anuncio: \(error.localizedDescription)"
            status = "error al anunciar"
            return
        }
        advertising = true
        status = subscribedCentrals.isEmpty ? "anunciando…" : "conectado al visor"
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           central: CBCentral,
                           didSubscribeTo characteristic: CBCharacteristic) {
        subscribedCentrals.insert(central.identifier)
        subscriberCount = subscribedCentrals.count
        status = "conectado al visor"
    }

    func peripheralManager(_ peripheral: CBPeripheralManager,
                           central: CBCentral,
                           didUnsubscribeFrom characteristic: CBCharacteristic) {
        subscribedCentrals.remove(central.identifier)
        subscriberCount = subscribedCentrals.count
        status = subscribedCentrals.isEmpty ? "anunciando…" : "conectado al visor"
    }
}
