import Foundation

public final class AppSessionController: @unchecked Sendable {
  private let configurationStore: AppConfigurationStoring
  private let tokenStore: TokenStoring
  private let healthChecker: GatewayHealthChecking
  private let identityChecker: GatewaySessionIdentityChecking?

  public private(set) var configuration: AppConfiguration
  private var storedToken: String?
  public private(set) var hasLoadedPersistedState = false
  public private(set) var connectionStatus: GatewayConnectionStatus = .unknown
  public private(set) var connectionIdentity: String?

  public init(
    configurationStore: AppConfigurationStoring,
    tokenStore: TokenStoring,
    healthChecker: GatewayHealthChecking,
    identityChecker: GatewaySessionIdentityChecking? = nil
  ) {
    self.configurationStore = configurationStore
    self.tokenStore = tokenStore
    self.healthChecker = healthChecker
    self.identityChecker = identityChecker
    self.configuration = AppConfiguration(baseURLString: "", deviceName: "")
    self.storedToken = nil
  }

  public var isSetupComplete: Bool {
    configuration.isSetupComplete && storedToken?.isEmpty == false
  }

  public var apiToken: String? {
    storedToken
  }

  public func loadPersistedState() async {
    guard !hasLoadedPersistedState else { return }

    configuration = configurationStore.load()
    storedToken = tokenStore.readToken()
    hasLoadedPersistedState = true
  }

  public func saveSetup(baseURLString: String, token: String, deviceName: String) throws {
    let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedName = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)

    let configuration = AppConfiguration(
      baseURLString: trimmedURL,
      deviceName: trimmedName,
      notificationPreference: self.configuration.notificationPreference
    )

    guard configuration.baseURL != nil else {
      throw GatewaySetupError.invalidBaseURL
    }

    guard !trimmedName.isEmpty else {
      throw GatewaySetupError.missingDeviceName
    }

    guard !trimmedToken.isEmpty else {
      throw GatewaySetupError.missingToken
    }

    configurationStore.save(configuration)
    _ = tokenStore.saveToken(trimmedToken)
    self.configuration = configuration
    self.storedToken = trimmedToken
    hasLoadedPersistedState = true
  }

  @discardableResult
  public func runHealthCheck() async -> GatewayConnectionStatus {
    guard isSetupComplete, let baseURL = configuration.baseURL else {
      connectionStatus = .failed("Complete setup before testing connection.")
      return connectionStatus
    }

    connectionStatus = .checking

    do {
      let token = storedToken
      if let identityChecker {
        if let identity = try await identityChecker.fetchConnectionIdentity(baseURL: baseURL, token: token) {
          connectionIdentity = identity
          connectionStatus = .connected
        } else {
          connectionIdentity = nil
          connectionStatus = .failed("Gateway identity lookup returned no user.")
        }
      } else {
        let response = try await healthChecker.checkHealth(baseURL: baseURL, token: token)
        connectionStatus = isReachableGatewayStatus(response.status)
          ? .connected
          : .failed("Gateway status: \(response.status)")
        connectionIdentity = nil
      }
    } catch {
      connectionStatus = .failed(error.localizedDescription)
      connectionIdentity = nil
    }

    return connectionStatus
  }

  private func isReachableGatewayStatus(_ status: String) -> Bool {
    let normalized = status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    return normalized == "ok" || normalized == "degraded"
  }

  public func replaceToken(_ token: String) {
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedToken.isEmpty else { return }
    _ = tokenStore.saveToken(trimmedToken)
    storedToken = trimmedToken
    hasLoadedPersistedState = true
    connectionStatus = .unknown
    connectionIdentity = nil
  }

  /// Persists a new notification preference level.
  public func saveNotificationPreference(_ level: NotificationPreferenceLevel) {
    var updated = configuration
    updated.notificationPreference = level
    configurationStore.save(updated)
    configuration = updated
  }

  public func clearLocalData() {
    configurationStore.clear()
    _ = tokenStore.clearToken()
    configuration = configurationStore.load()
    storedToken = nil
    hasLoadedPersistedState = true
    connectionStatus = .unknown
    connectionIdentity = nil
  }
}
