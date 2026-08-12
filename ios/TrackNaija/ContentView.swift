import SwiftUI

struct ContentView: View {
    @State private var serverURL = UserDefaults.standard.string(forKey: "server_url") ?? "http://192.168.1.100:4173"
    @State private var pairCode = ""
    @State private var deviceId = UserDefaults.standard.string(forKey: "device_id")
    @State private var statusMessage = ""
    @State private var lastFixText = "No location reported yet"

    private let locationReporter = LocationReporter()

    var body: some View {
        TabView {
            deviceView
                .tabItem { Label("This iPhone", systemImage: "iphone") }

            reportView
                .tabItem { Label("Report lost", systemImage: "exclamationmark.shield") }

            FindMyGuideView()
                .tabItem { Label("Find My", systemImage: "location.magnifyingglass") }
        }
    }

    // MARK: - This iPhone

    private var deviceView: some View {
        NavigationStack {
            Form {
                Section("Link to dashboard") {
                    TextField("Sync server URL", text: $serverURL)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                    TextField("Pairing code", text: $pairCode)
                        .textInputAutocapitalization(.characters)
                    Button(deviceId == nil ? "Link this iPhone" : "Re-link") {
                        link()
                    }
                    if let deviceId {
                        Text("Linked as \(deviceId.prefix(8))…")
                            .foregroundStyle(.green)
                            .font(.footnote)
                    }
                }

                Section("Last-known location") {
                    Text(lastFixText)
                        .font(.footnote.monospaced())
                    Button("Report location now") {
                        reportLocation()
                    }
                    Text("iOS doesn't allow third-party background tracking. Opening this app and tapping the button above sends your phone's current location to your dashboard.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if !statusMessage.isEmpty {
                    Section { Text(statusMessage).font(.caption) }
                }
            }
            .navigationTitle("Dravex")
            .onAppear {
                // Wire the location reporter's callback to upload.
                locationReporter.onFix = { coordinate in
                    uploadFix(coordinate.latitude, coordinate.longitude)
                }
            }
        }
    }

    // MARK: - Report lost

    private var reportView: some View {
        NavigationStack {
            Form {
                Section {
                    Text("If this iPhone is lost or stolen, Apple's Find My is the fastest way to locate, lock, or erase it. Dravex covers the rest: the police report and stolen-device registry.")
                        .font(.footnote)
                }
                Section("Stolen-device report") {
                    NavigationLink("Generate police report") {
                        PoliceReportView()
                    }
                    NavigationLink("Open Find My instructions") {
                        FindMyGuideView()
                    }
                }
            }
            .navigationTitle("Report lost")
        }
    }

    // MARK: - Actions

    private func link() {
        Task {
            let info = DeviceInfo.current
            let result = try? await SyncClient(serverURL).claim(
                code: pairCode,
                hostname: info.hostname,
                serial: info.serial,
                platform: "ios"
            )
            await MainActor.run {
                if let deviceId = result {
                    self.deviceId = deviceId
                    UserDefaults.standard.set(deviceId, forKey: "device_id")
                    UserDefaults.standard.set(serverURL, forKey: "server_url")
                    statusMessage = "Linked successfully."
                } else {
                    statusMessage = "Pairing failed — check the code and that the server is reachable."
                }
            }
        }
    }

    private func reportLocation() {
        lastFixText = "Locating…"
        locationReporter.requestLocation()
    }

    private func uploadFix(_ lat: Double, _ lng: Double) {
        guard let deviceId else {
            lastFixText = "Link this iPhone first."
            return
        }
        Task {
            let ok = try? await SyncClient(serverURL).postFix(
                deviceId: deviceId,
                lat: lat,
                lng: lng
            )
            await MainActor.run {
                let time = ISO8601DateFormatter().string(from: Date())
                lastFixText = ok == true
                    ? String(format: "%.5f, %.5f · uploaded %@", lat, lng, time)
                    : "Upload failed — is the sync server running?"
            }
        }
    }
}

/// Light device info for the pairing payload.
struct DeviceInfo {
    let hostname: String
    let serial: String

    static var current: DeviceInfo {
        DeviceInfo(
            hostname: UIDevice.current.name,
            serial: UIDevice.current.identifierForVendor?.uuidString ?? "unknown"
        )
    }
}
