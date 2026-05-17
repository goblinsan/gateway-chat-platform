import Foundation

/// A lightweight JSON-file-backed cache for recently fetched alerts.
///
/// The cache persists alert lists per ``GatewayAlertStatus`` and is used to
/// show stale data while the network is unavailable.  Each entry carries a
/// timestamp so callers can decide whether the data is fresh enough to show.
public final class LocalAlertCache {
  public struct CachedAlerts: Codable {
    public let alerts: [GatewayAlertSummary]
    public let cachedAt: Date
  }

  private let cacheDirectory: URL

  public init(cacheDirectory: URL? = nil) {
    if let dir = cacheDirectory {
      self.cacheDirectory = dir
    } else {
      let appSupport = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
        ?? FileManager.default.temporaryDirectory
      self.cacheDirectory = appSupport.appendingPathComponent("GatewayAlertCache", isDirectory: true)
    }
  }

  /// Persist a fetched list of alerts for the given status bucket.
  public func save(alerts: [GatewayAlertSummary], forStatus status: GatewayAlertStatus) {
    createDirectoryIfNeeded()
    let entry = CachedAlerts(alerts: alerts, cachedAt: Date())
    guard let data = try? JSONEncoder().encode(entry) else { return }
    try? data.write(to: cacheFileURL(forStatus: status), options: .atomic)
  }

  /// Returns cached alerts for the given status, or `nil` if no cache exists.
  public func load(forStatus status: GatewayAlertStatus) -> CachedAlerts? {
    let url = cacheFileURL(forStatus: status)
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(CachedAlerts.self, from: data)
  }

  /// Removes all cached alert files.
  public func clear() {
    for status in GatewayAlertStatus.allCases {
      try? FileManager.default.removeItem(at: cacheFileURL(forStatus: status))
    }
  }

  // MARK: - Private helpers

  private func cacheFileURL(forStatus status: GatewayAlertStatus) -> URL {
    cacheDirectory.appendingPathComponent("alerts_\(status.rawValue).json")
  }

  private func createDirectoryIfNeeded() {
    guard !FileManager.default.fileExists(atPath: cacheDirectory.path) else { return }
    try? FileManager.default.createDirectory(at: cacheDirectory, withIntermediateDirectories: true)
  }
}
