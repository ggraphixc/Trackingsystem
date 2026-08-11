import CoreLocation
import Foundation

/// Requests a single location fix using when-in-use authorization.
/// iOS gives third-party apps one-shot fixes — no background tracking.
final class LocationReporter: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()

    /// Called with the coordinate when a fix arrives.
    var onFix: ((CLLocationCoordinate2D) -> Void)?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyHundredMeters
    }

    func requestLocation() {
        switch manager.authorizationStatus {
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        default:
            // Permission denied — surface it via a 0,0 "failure" is misleading;
            // keep silent and let the UI show its own hint.
            break
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse
            || manager.authorizationStatus == .authorizedAlways {
            manager.requestLocation()
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        onFix?(location.coordinate)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // No fix available — the UI will simply show "Locating…" until the
        // next attempt. No crash, no crash logs.
    }
}
