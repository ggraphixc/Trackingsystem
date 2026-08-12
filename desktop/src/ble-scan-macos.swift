// Dravex BLE scanner (macOS) — compiled once by ble-scan.js with swiftc.
//
// CoreBluetooth CentralManager scanning for the Dravex service UUID
// (0000fffa-0000-1000-8000-00805f9b34fb). The beacon id is read from the
// service data payload: version byte 0x01 + 12 ASCII hex chars. Prints one
// JSON array [{ "beacon": "...", "rssi": ... }] to stdout.
//
// Requires the app to have Bluetooth permission (NSBluetoothAlwaysUsageDescription
// in Info.plist) and the user to have granted "Bluetooth" in System Settings.
// Build:  xcrun -sdk macosx swiftc -O ble-scan-macos.swift -o dravex-ble-scan

import CoreBluetooth
import Foundation

let serviceUUID = CBUUID(string: "0000fffa-0000-1000-8000-00805f9b34fb")
let durationArg = CommandLine.arguments.count > 1 ? Int(CommandLine.arguments[1]) ?? 10 : 10

final class Scanner: NSObject, CBCentralManagerDelegate {
    var manager: CBCentralManager!
    var results: [[String: Any]] = []
    var seen = Set<String>()

    func start() {
        manager = CBCentralManager(delegate: self, queue: nil)
        RunLoop.current.run(until: Date().addingTimeInterval(TimeInterval(durationArg) + 8))
        printResults()
        exit(0)
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        guard central.state == .poweredOn else {
            printResults()
            exit(0)
        }
        central.scanForPeripherals(withServices: [serviceUUID], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
        DispatchQueue.main.asyncAfter(deadline: .now() + .seconds(durationArg)) {
            central.stopScan()
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral,
                        advertisementData: [String: Any], rssi RSSI: NSNumber) {
        guard let data = advertisementData[CBAdvertisementDataServiceDataKey] as? [CBUUID: Data],
              let payload = data[serviceUUID] else { return }
        var bytes = [UInt8](payload)
        guard bytes.count >= 13, bytes[0] == 0x01 else { return }
        // Bytes 1..12 are the ASCII-hex beacon id.
        let hex = String(decoding: payload[payload.startIndex.advanced(by: 1)..<payload.startIndex.advanced(by: 13)], as: UTF8.self)
        guard hex.count == 12, hex.range(of: "^[0-9a-f]{12}$", options: .regularExpression) != nil else { return }
        guard !seen.contains(hex) else { return }
        seen.insert(hex)
        results.append(["beacon": hex, "rssi": RSSI.intValue])
    }

    func printResults() {
        guard let data = try? JSONSerialization.data(withJSONObject: results),
              let out = String(data: data, encoding: .utf8) else { return }
        print(out)
    }
}

Scanner().start()
