import Foundation

/// Minimum alert severity level that triggers a push notification.
/// Stored per-device and sent to the server during APNs registration so the
/// server can filter outbound pushes accordingly.
public enum NotificationPreferenceLevel: String, CaseIterable, Equatable, Sendable {
  /// Send push notifications for all alerts (info and above).
  case all
  /// Send pushes for medium, high, and critical alerts.
  case mediumAndAbove = "medium"
  /// Send pushes for high and critical alerts only (default).
  case highAndAbove = "high"
  /// Send pushes for critical alerts only.
  case criticalOnly = "critical"
  /// Never send push notifications.
  case off

  public var displayLabel: String {
    switch self {
    case .all: return "All alerts"
    case .mediumAndAbove: return "Medium and above"
    case .highAndAbove: return "High and above"
    case .criticalOnly: return "Critical only"
    case .off: return "Off"
    }
  }
}

public struct AppConfiguration: Equatable {
  public var baseURLString: String
  public var deviceName: String
  /// Minimum severity level that triggers a push notification.
  public var notificationPreference: NotificationPreferenceLevel

  public init(
    baseURLString: String,
    deviceName: String,
    notificationPreference: NotificationPreferenceLevel = .highAndAbove
  ) {
    self.baseURLString = baseURLString
    self.deviceName = deviceName
    self.notificationPreference = notificationPreference
  }

  public var baseURL: URL? {
    guard
      let parsed = URL(string: baseURLString),
      let scheme = parsed.scheme,
      ["http", "https"].contains(scheme.lowercased()),
      let host = parsed.host,
      !host.isEmpty
    else {
      return nil
    }

    return parsed
  }

  public var isSetupComplete: Bool {
    baseURL != nil && !deviceName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
  }
}

public enum GatewayConnectionStatus: Equatable {
  case unknown
  case checking
  case connected
  case failed(String)
}

public enum GatewaySetupError: LocalizedError, Equatable {
  case invalidBaseURL
  case missingToken
  case missingDeviceName

  public var errorDescription: String? {
    switch self {
    case .invalidBaseURL:
      return "Enter a valid Gateway URL."
    case .missingToken:
      return "Enter an API token."
    case .missingDeviceName:
      return "Enter a device name."
    }
  }
}
