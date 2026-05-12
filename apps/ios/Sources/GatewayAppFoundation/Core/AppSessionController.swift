import Foundation

public final class AppSessionController {
  private let configurationStore: AppConfigurationStoring
  private let tokenStore: TokenStoring
  private let healthChecker: GatewayHealthChecking
  private let identityChecker: GatewaySessionIdentityChecking?

  public private(set) var configuration: AppConfiguration
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
    self.configuration = configurationStore.load()
  }

  public var isSetupComplete: Bool {
    configuration.isSetupComplete && tokenStore.readToken()?.isEmpty == false
  }

  public func saveSetup(baseURLString: String, token: String, deviceName: String) throws {
    let trimmedURL = baseURLString.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedName = deviceName.trimmingCharacters(in: .whitespacesAndNewlines)

    let configuration = AppConfiguration(baseURLString: trimmedURL, deviceName: trimmedName)

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
  }

  @discardableResult
  public func runHealthCheck() async -> GatewayConnectionStatus {
    guard isSetupComplete, let baseURL = configuration.baseURL else {
      connectionStatus = .failed("Complete setup before testing connection.")
      return connectionStatus
    }

    connectionStatus = .checking

    do {
      let response = try await healthChecker.checkHealth(baseURL: baseURL, token: tokenStore.readToken())
      connectionStatus = response.status == "ok" ? .connected : .failed("Gateway status: \(response.status)")
      if case .connected = connectionStatus {
        do {
          connectionIdentity = try await identityChecker?.fetchConnectionIdentity(baseURL: baseURL, token: tokenStore.readToken())
        } catch {
          connectionIdentity = nil
          connectionStatus = .failed("Gateway connected, but identity lookup failed: \(error.localizedDescription)")
        }
      } else {
        connectionIdentity = nil
      }
    } catch {
      connectionStatus = .failed(error.localizedDescription)
      connectionIdentity = nil
    }

    return connectionStatus
  }

  public func replaceToken(_ token: String) {
    let trimmedToken = token.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedToken.isEmpty else { return }
    _ = tokenStore.saveToken(trimmedToken)
    connectionStatus = .unknown
    connectionIdentity = nil
  }

  public func clearLocalData() {
    configurationStore.clear()
    _ = tokenStore.clearToken()
    configuration = configurationStore.load()
    connectionStatus = .unknown
    connectionIdentity = nil
  }
}
