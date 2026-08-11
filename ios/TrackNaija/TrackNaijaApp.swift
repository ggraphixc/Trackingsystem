import SwiftUI

/// TrackNaija iOS companion.
///
/// iOS restricts third-party background tracking, so this app complements
/// Apple's Find My instead of competing with it: it reports the phone's
/// last-known location when opened, steers users to Find My for live
/// tracking, and links into the TrackNaija reporting/registry pipeline.
@main
struct TrackNaijaApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
