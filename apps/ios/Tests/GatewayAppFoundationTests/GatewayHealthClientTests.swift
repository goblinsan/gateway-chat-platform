import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import GatewayAppFoundation

final class GatewayHealthClientTests: XCTestCase {
  override class func setUp() {
    super.setUp()
    HealthURLProtocolStub.reset()
    _ = URLProtocol.registerClass(HealthURLProtocolStub.self)
  }

  override class func tearDown() {
    URLProtocol.unregisterClass(HealthURLProtocolStub.self)
    HealthURLProtocolStub.reset()
    super.tearDown()
  }

  override func setUp() {
    super.setUp()
    HealthURLProtocolStub.reset()
  }

  func testCheckHealthDecodesJSONResponse() async throws {
    HealthURLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/api/health")
      return StubResponse(
        statusCode: 200,
        headers: ["Content-Type": "application/json"],
        body: Data(#"{"status":"ok"}"#.utf8)
      )
    }

    let client = GatewayHealthClient(session: makeSession())
    let response = try await client.checkHealth(
      baseURL: URL(string: "https://gateway.example.com")!,
      token: "token-123"
    )

    XCTAssertEqual(response, .init(status: "ok"))
  }

  func testCheckHealthReportsCloudflareAccessRedirectAsExplicitError() async {
    HealthURLProtocolStub.handler = { _ in
      StubResponse(
        url: URL(string: "https://team.cloudflareaccess.com/cdn-cgi/access/login")!,
        statusCode: 200,
        headers: ["Content-Type": "text/html; charset=utf-8"],
        body: Data("<html><body>Cloudflare Access login</body></html>".utf8)
      )
    }

    let client = GatewayHealthClient(session: makeSession())

    do {
      _ = try await client.checkHealth(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: "token-123"
      )
      XCTFail("Expected Cloudflare Access error")
    } catch let error as GatewayHealthError {
      XCTAssertEqual(
        error,
        .accessLoginRequired("https://team.cloudflareaccess.com/cdn-cgi/access/login")
      )
    } catch {
      XCTFail("Unexpected error: \(error)")
    }
  }

  func testFetchConnectionIdentityAcceptsUserIdPayload() async throws {
    HealthURLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/api/session/me")
      return StubResponse(
        statusCode: 200,
        headers: ["Content-Type": "application/json"],
        body: Data(#"{"userId":"mobile-user"}"#.utf8)
      )
    }

    let client = GatewayHealthClient(session: makeSession())
    let identity = try await client.fetchConnectionIdentity(
      baseURL: URL(string: "https://gateway.example.com")!,
      token: "token-123"
    )

    XCTAssertEqual(identity, "mobile-user")
  }

  private func makeSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HealthURLProtocolStub.self]
    return URLSession(configuration: config)
  }
}

private struct StubResponse {
  var url: URL = URL(string: "https://gateway.example.com")!
  var statusCode: Int
  var headers: [String: String]
  var body: Data
}

private final class HealthURLProtocolStub: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> StubResponse)?

  static func reset() {
    handler = nil
  }

  override class func canInit(with request: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    guard let handler = Self.handler else {
      client?.urlProtocol(self, didFailWithError: URLError(.badServerResponse))
      return
    }

    do {
      let stub = try handler(request)
      let response = HTTPURLResponse(
        url: stub.url,
        statusCode: stub.statusCode,
        httpVersion: nil,
        headerFields: stub.headers
      )!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: stub.body)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
