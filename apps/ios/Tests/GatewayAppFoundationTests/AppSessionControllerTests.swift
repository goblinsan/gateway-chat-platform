import XCTest
@testable import GatewayAppFoundation

final class AppSessionControllerTests: XCTestCase {
  func testSetupCompletionRequiresValidConfigurationAndToken() throws {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "", deviceName: ""))
    let tokenStore = InMemoryTokenStore()
    let health = MockHealthChecker(response: .init(status: "ok"))
    let session = AppSessionController(configurationStore: configStore, tokenStore: tokenStore, healthChecker: health)

    XCTAssertFalse(session.isSetupComplete)

    try session.saveSetup(baseURLString: "https://gateway.example.com", token: "abc", deviceName: "My iPhone")

    XCTAssertTrue(session.isSetupComplete)
    XCTAssertEqual(session.configuration.baseURLString, "https://gateway.example.com")
    XCTAssertEqual(session.configuration.deviceName, "My iPhone")
  }

  func testSaveSetupRejectsInvalidInput() {
    let session = AppSessionController(
      configurationStore: MockConfigurationStore(configuration: .init(baseURLString: "", deviceName: "")),
      tokenStore: InMemoryTokenStore(),
      healthChecker: MockHealthChecker(response: .init(status: "ok"))
    )

    XCTAssertThrowsError(try session.saveSetup(baseURLString: "not-a-url", token: "abc", deviceName: "phone"))
    XCTAssertThrowsError(try session.saveSetup(baseURLString: "https://gateway.example.com", token: "   ", deviceName: "phone"))
    XCTAssertThrowsError(try session.saveSetup(baseURLString: "https://gateway.example.com", token: "abc", deviceName: "   "))
  }

  func testHealthCheckMapsHealthyResponseToConnected() async {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "https://gateway.example.com", deviceName: "My iPhone"))
    let tokenStore = InMemoryTokenStore(token: "abc")
    let health = MockHealthChecker(response: .init(status: "ok"))
    let session = AppSessionController(configurationStore: configStore, tokenStore: tokenStore, healthChecker: health)

    let status = await session.runHealthCheck()

    XCTAssertEqual(status, .connected)
  }

  func testHealthCheckMapsNonOkResponseToFailedStatus() async {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "https://gateway.example.com", deviceName: "My iPhone"))
    let tokenStore = InMemoryTokenStore(token: "abc")
    let health = MockHealthChecker(response: .init(status: "degraded"))
    let session = AppSessionController(configurationStore: configStore, tokenStore: tokenStore, healthChecker: health)

    let status = await session.runHealthCheck()

    XCTAssertEqual(status, .failed("Gateway status: degraded"))
  }

  func testHealthCheckCapturesConnectionIdentityWhenAvailable() async throws {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "https://gateway.example.com", deviceName: "My iPhone"))
    let tokenStore = InMemoryTokenStore(token: "abc")
    let health = MockHealthChecker(response: .init(status: "ok"))
    let identity = MockIdentityChecker(identity: "me@example.com")
    let session = AppSessionController(
      configurationStore: configStore,
      tokenStore: tokenStore,
      healthChecker: health,
      identityChecker: identity
    )

    _ = await session.runHealthCheck()

    XCTAssertEqual(session.connectionIdentity, "me@example.com")
  }

  func testIdentityLookupFailureUpdatesConnectionStatus() async {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "https://gateway.example.com", deviceName: "My iPhone"))
    let tokenStore = InMemoryTokenStore(token: "abc")
    let health = MockHealthChecker(response: .init(status: "ok"))
    let identity = ThrowingIdentityChecker()
    let session = AppSessionController(
      configurationStore: configStore,
      tokenStore: tokenStore,
      healthChecker: health,
      identityChecker: identity
    )

    let status = await session.runHealthCheck()

    guard case let .failed(message) = status else {
      return XCTFail("Expected failed status when identity lookup throws")
    }
    XCTAssertTrue(message.contains("identity lookup failed"))
  }

  func testReplacingTokenResetsConnectionState() async {
    let configStore = MockConfigurationStore(configuration: .init(baseURLString: "https://gateway.example.com", deviceName: "My iPhone"))
    let tokenStore = InMemoryTokenStore(token: "abc")
    let health = MockHealthChecker(response: .init(status: "ok"))
    let identity = MockIdentityChecker(identity: "me@example.com")
    let session = AppSessionController(
      configurationStore: configStore,
      tokenStore: tokenStore,
      healthChecker: health,
      identityChecker: identity
    )

    _ = await session.runHealthCheck()
    session.replaceToken("new-token")

    XCTAssertEqual(session.connectionStatus, .unknown)
    XCTAssertNil(session.connectionIdentity)
  }
}

private final class MockConfigurationStore: AppConfigurationStoring {
  private var configuration: AppConfiguration

  init(configuration: AppConfiguration) {
    self.configuration = configuration
  }

  func load() -> AppConfiguration {
    configuration
  }

  func save(_ configuration: AppConfiguration) {
    self.configuration = configuration
  }

  func clear() {
    configuration = .init(baseURLString: "", deviceName: "")
  }
}

private struct MockHealthChecker: GatewayHealthChecking {
  let response: GatewayHealthResponse

  func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse {
    response
  }
}

private struct MockIdentityChecker: GatewaySessionIdentityChecking {
  let identity: String?

  func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String? {
    identity
  }
}

private struct ThrowingIdentityChecker: GatewaySessionIdentityChecking {
  enum TestError: Error { case failed }

  func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String? {
    throw TestError.failed
  }
}
