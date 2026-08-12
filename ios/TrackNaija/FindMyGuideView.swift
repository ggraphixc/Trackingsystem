import SwiftUI

/// Step-by-step Find My instructions + deep links.
/// Third-party apps can't tap into Apple's Find My network — this view
/// steers users to the official tools that actually work on iOS.
struct FindMyGuideView: View {
    var body: some View {
        List {
            Section {
                Label("Apple Find My is the fastest way to locate, lock or erase a lost iPhone.", systemImage: "checkmark.shield.fill")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section("Before it's lost — offline readiness") {
                ForEach([
                    "Enable Offline Finding: Settings → Apple ID → Find My → Offline Finding.",
                    "Know your Apple ID email and password — you need them to locate, lock or erase.",
                    "Activation Lock stays on (it does by default whenever Find My is on).",
                    "Note your IMEI: Settings → General → About, or dial *#06#.",
                    "Keep Bluetooth on — the Find My network uses it to relay the device's beacon.",
                ], id: \.self) { step in
                    Label(step, systemImage: "checkmark.circle")
                        .font(.footnote)
                }
            }

            Section("1 · Open Find My") {
                Button {
                    open(URL(string: "findmy://") ?? URL(string: "https://www.icloud.com/find")!)
                } label: {
                    Label("Open the Find My app", systemImage: "location.magnifyingglass")
                }
                Button {
                    open(URL(string: "https://www.icloud.com/find")!)
                } label: {
                    Label("Or use iCloud on the web", systemImage: "icloud")
                }
            }

            Section("2 · What to do") {
                ForEach([
                    "Play a sound if the phone is nearby.",
                    "Mark it as Lost — locks the screen with your contact message.",
                    "See its location on the map; enable Notify When Found.",
                    "If all else fails, erase it remotely (this ends tracking).",
                ], id: \.self) { step in
                    Label(step, systemImage: "arrow.right.circle")
                        .font(.footnote)
                }
            }

            Section("3 · Then report it") {
                Text("Back on the Report tab, generate your police report and list the device in the Dravex stolen registry — a fenced iPhone becomes unsellable.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Find My")
    }

    private func open(_ url: URL) {
        UIApplication.shared.open(url)
    }
}

/// Minimal police-report generator (mirrors the dashboard's report content).
struct PoliceReportView: View {
    @State private var ref = ""
    @State private var copied = false

    var body: some View {
        Form {
            Section {
                Text("Dravex generates your report text; submit it via the NPF NCCC portal (nccc.npf.gov.ng) or CRP (crp.ng, USSD *121#).")
                    .font(.footnote)
            }
            Section("Report") {
                if ref.isEmpty {
                    Button("Generate police report") {
                        ref = "CRP-2026-\(Int.random(in: 10000...99999))"
                    }
                } else {
                    Text("LOST / STOLEN DEVICE REPORT\nReference: \(ref)\nDevice: iPhone (serial \(DeviceInfo.current.serial.prefix(8))…)\nSubmit via: nccc.npf.gov.ng or crp.ng")
                        .font(.footnote.monospaced())
                    Button(copied ? "Copied" : "Copy report") {
                        UIPasteboard.general.string = reportText(ref)
                        copied = true
                    }
                }
            }
        }
        .navigationTitle("Police report")
    }

    private func reportText(_ reference: String) -> String {
        """
        LOST / STOLEN DEVICE REPORT
        Reference: \(reference)
        Device: iPhone (serial \(DeviceInfo.current.serial.prefix(8))…)
        Submit via: NPF NCCC nccc.npf.gov.ng or CRP crp.ng / *121#
        """
    }
}
