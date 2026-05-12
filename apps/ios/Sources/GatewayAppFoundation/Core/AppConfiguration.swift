import Foundation

public struct AppConfiguration: Equatable {
  public var baseURLString: String
  public var deviceName: String

  public init(baseURLString: String, deviceName: String) {
    self.baseURLString = baseURLString
    self.deviceName = deviceName
  }

  public var baseURL: URL? {
    guard
      let parsed = URL(string: baseURLString),
      let scheme = parsed.scheme,
      !scheme.isEmpty,
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
  case missingDeviceName

  public var errorDescription: String? {
    switch self {
    case .invalidBaseURL:
      return "Enter a valid Gateway URL."
    case .missingDeviceName:
      return "Enter a device name."
    }
  }
}
