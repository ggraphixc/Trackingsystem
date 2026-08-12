import Foundation

/// Minimal client for the Dravex sync server (URLSession only).
/// Mirrors the desktop/Android clients' endpoints.
struct SyncClient {
    let baseURL: String

    init(_ baseURL: String) {
        self.baseURL = baseURL.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    private func send(_ method: String, _ path: String, _ body: [String: Any]?) async throws -> [String: Any]? {
        guard let url = URL(string: baseURL + path) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 8

        if let body {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            return nil
        }
        return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    }

    /// Claim a pairing code; returns the device id or nil.
    func claim(code: String, hostname: String, serial: String, platform: String) async throws -> String? {
        let body: [String: Any] = [
            "code": code.trimmingCharacters(in: .whitespacesAndNewlines).uppercased(),
            "hostname": hostname,
            "serialNumber": serial,
            "platform": platform,
        ]
        guard let res = try await send("POST", "/api/pair/claim", body) else { return nil }
        return res["deviceId"] as? String
    }

    /// Upload a last-known location fix.
    func postFix(deviceId: String, lat: Double, lng: Double) async throws -> Bool {
        let fix: [String: Any] = [
            "lat": lat,
            "lng": lng,
            "accuracy": 50,
            "source": "gps",
            "battery": 100,
            "timestamp": ISO8601DateFormatter().string(from: Date()),
            "confidence": 80,
        ]
        let res = try await send("POST", "/api/devices/\(deviceId)/fixes", ["fix": fix])
        return res != nil
    }
}
