import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
import XCTest
@testable import GatewayAppFoundation

final class GatewayChatClientTests: XCTestCase {
  override class func setUp() {
    super.setUp()
    URLProtocolStub.reset()
    _ = URLProtocol.registerClass(URLProtocolStub.self)
  }

  override class func tearDown() {
    URLProtocol.unregisterClass(URLProtocolStub.self)
    URLProtocolStub.reset()
    super.tearDown()
  }

  override func setUp() {
    super.setUp()
    URLProtocolStub.reset()
  }

  func testFetchAgentsDecodesAgentListAndSendsAuthorizationHeader() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/agents")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")

      let body = """
      {"agents":[{"id":"agent-a","name":"Agent A","icon":"🤖","enabled":true}]}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let agents = try await client.fetchAgents(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123"
    )

    XCTAssertEqual(agents, [.init(id: "agent-a", name: "Agent A", icon: "🤖", enabled: true)])
  }

  func testRegisterAPNsDeviceNormalizesTokenAndUsesSessionEndpoint() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/session/mobile-devices/apns")
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Client-Platform"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Device-Name"), "My iPhone")

      let bodyData = try XCTUnwrap(request.httpBody)
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["apnsToken"] as? String, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")
      return (200, Data("{}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    try await client.registerAPNsDevice(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      apnsToken: "<ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789>",
      deviceName: "My iPhone"
    )
  }

  func testRegisterAPNsDeviceRejectsEmptyToken() async throws {
    let client = GatewayChatClient(session: makeSession())
    do {
      try await client.registerAPNsDevice(
        baseURL: URL(string: "https://gateway.example.com/chat/")!,
        token: "token-123",
        apnsToken: "   <>   ",
        deviceName: "My iPhone"
      )
      XCTFail("Expected invalid APNs token error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .invalidAPNsToken)
    }
  }

  func testSendPromptIncludesThreadAndConversationAndParsesResult() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/chat")
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Client-Platform"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Device-Name"), "My iPhone")

      guard let bodyData = request.httpBody else {
        return (400, Data("{}".utf8))
      }
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["agentId"] as? String, "agent-a")
      XCTAssertEqual(payload["threadId"] as? String, "thread-1")

      let messages = try XCTUnwrap(payload["messages"] as? [[String: String]])
      XCTAssertEqual(messages.count, 2)
      XCTAssertEqual(messages[0]["role"], "user")
      XCTAssertEqual(messages[1]["role"], "assistant")

      let response = """
      {"agentId":"agent-a","message":{"role":"assistant","content":"Hello back"},"threadId":"thread-2"}
      """
      return (200, Data(response.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let result = try await client.sendPrompt(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      prompt: GatewayTypedPrompt(text: "Hi", agentID: "agent-a"),
      messages: [
        .init(role: "user", content: "Hi"),
        .init(role: "assistant", content: "Hello"),
      ],
      threadID: "thread-1",
      deviceName: "My iPhone"
    )

    XCTAssertEqual(result, .init(agentID: "agent-a", content: "Hello back", threadID: "thread-2"))
  }

  func testSendPromptRejectsEmptyPromptAndMissingAgent() async throws {
    let client = GatewayChatClient(session: makeSession())
    do {
      _ = try await client.sendPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: nil,
        prompt: GatewayTypedPrompt(text: "  ", agentID: "agent-a"),
        messages: [],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected empty prompt error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .emptyPrompt)
    }

    do {
      _ = try await client.sendPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: nil,
        prompt: GatewayTypedPrompt(text: "Hello", agentID: nil),
        messages: [],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected missing agent error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .missingAgent)
    }
  }

  func testSendPromptMapsServerErrorsToHttpError() async throws {
    URLProtocolStub.handler = { _ in
      let body = """
      {"error":"Quota exceeded","message":"Quota exceeded for selected model."}
      """
      return (429, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())

    do {
      _ = try await client.sendPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: "token-123",
        prompt: GatewayTypedPrompt(text: "Hello", agentID: "agent-a"),
        messages: [.init(role: "user", content: "Hello")],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected HTTP error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .httpError(429, "Quota exceeded for selected model."))
    }
  }

  // MARK: - streamPrompt tests

  func testStreamPromptEmitsTokensAndDoneEvent() async throws {
    let sseBody = """
    data: {"type":"token","token":"Hello"}\n\ndata: {"type":"token","token":" world"}\n\ndata: {"type":"done","agentId":"agent-a","threadId":"thread-2"}\n\n
    """
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/chat/stream")
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Accept"), "text/event-stream")
      return (200, Data(sseBody.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let stream = try await client.streamPrompt(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      prompt: GatewayTypedPrompt(text: "Hi", agentID: "agent-a"),
      messages: [.init(role: "user", content: "Hi")],
      threadID: "thread-1",
      deviceName: nil
    )

    var collected: [GatewayStreamEvent] = []
    for try await event in stream {
      collected.append(event)
    }

    XCTAssertEqual(collected, [
      .token("Hello"),
      .token(" world"),
      .done(agentID: "agent-a", threadID: "thread-2"),
    ])
  }

  func testStreamPromptRejectsEmptyPromptAndMissingAgent() async throws {
    let client = GatewayChatClient(session: makeSession())
    do {
      _ = try await client.streamPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: nil,
        prompt: GatewayTypedPrompt(text: "  ", agentID: "agent-a"),
        messages: [],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected empty prompt error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .emptyPrompt)
    }

    do {
      _ = try await client.streamPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: nil,
        prompt: GatewayTypedPrompt(text: "Hello", agentID: nil),
        messages: [],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected missing agent error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .missingAgent)
    }
  }

  func testStreamPromptMapsServerErrorsToHttpError() async throws {
    URLProtocolStub.handler = { _ in
      let body = """
      {"error":"Quota exceeded","message":"Quota exceeded for selected model."}
      """
      return (429, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    do {
      _ = try await client.streamPrompt(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: "token-123",
        prompt: GatewayTypedPrompt(text: "Hello", agentID: "agent-a"),
        messages: [.init(role: "user", content: "Hello")],
        threadID: nil,
        deviceName: nil
      )
      XCTFail("Expected HTTP error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .httpError(429, "Quota exceeded for selected model."))
    }
  }

  func testStreamPromptEmitsErrorEvent() async throws {
    let sseBody = """
    data: {"type":"error","error":"Provider unavailable"}\n\n
    """
    URLProtocolStub.handler = { _ in (200, Data(sseBody.utf8)) }

    let client = GatewayChatClient(session: makeSession())
    let stream = try await client.streamPrompt(
      baseURL: URL(string: "https://gateway.example.com")!,
      token: nil,
      prompt: GatewayTypedPrompt(text: "Hi", agentID: "agent-a"),
      messages: [],
      threadID: nil,
      deviceName: nil
    )

    var collected: [GatewayStreamEvent] = []
    for try await event in stream {
      collected.append(event)
    }

    XCTAssertEqual(collected, [.error("Provider unavailable")])
  }

  func testStreamPromptIncludesThreadAndPlatformHeaders() async throws {
    let sseBody = "data: {\"type\":\"done\",\"agentId\":\"agent-a\",\"threadId\":\"t-99\"}\n\n"
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Client-Platform"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Device-Name"), "Test Device")

      guard let bodyData = request.httpBody else { return (400, Data("{}".utf8)) }
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["threadId"] as? String, "thread-1")
      return (200, Data(sseBody.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let stream = try await client.streamPrompt(
      baseURL: URL(string: "https://gateway.example.com")!,
      token: nil,
      prompt: GatewayTypedPrompt(text: "Hi", agentID: "agent-a"),
      messages: [.init(role: "user", content: "Hi")],
      threadID: "thread-1",
      deviceName: "Test Device"
    )
    for try await _ in stream {}
  }

  private func makeSession() -> URLSession {
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [URLProtocolStub.self]
    return URLSession(configuration: config)
  }

  // MARK: - Alert endpoint tests

  func testFetchAlertsDecodesAlertList() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/mobile/alerts")
      XCTAssertEqual(request.httpMethod, "GET")
      let query = request.url?.query ?? ""
      XCTAssertTrue(query.contains("status=open"), "Expected status=open in query: \(query)")
      XCTAssertTrue(query.contains("limit=20"), "Expected limit=20 in query: \(query)")
      let body = """
      {"alerts":[{"id":"a1","title":"CPU spike","severity":"high","source":"homelab","sourceNode":"node-1","sourceService":"prometheus","status":"open","createdAt":"2026-05-13T00:00:00.000Z","acknowledgedAt":null,"resolvedAt":null}]}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let alerts = try await client.fetchAlerts(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      status: .open,
      limit: 20,
      before: nil
    )

    XCTAssertEqual(alerts.count, 1)
    XCTAssertEqual(alerts[0].id, "a1")
    XCTAssertEqual(alerts[0].severityLevel, .high)
    XCTAssertEqual(alerts[0].statusLevel, .open)
  }

  func testFetchAlertDetail() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/mobile/alerts/a1")
      XCTAssertEqual(request.httpMethod, "GET")
      let body = """
      {"alert":{"id":"a1","title":"CPU spike","body":"CPU exceeded 90%.","severity":"high","source":"homelab","sourceNode":"node-1","sourceService":"prometheus","status":"open","relatedThreadId":null,"relatedActionId":null,"metadataJson":null,"createdAt":"2026-05-13T00:00:00.000Z","acknowledgedAt":null,"resolvedAt":null}}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let detail = try await client.fetchAlert(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      alertID: "a1"
    )

    XCTAssertEqual(detail.id, "a1")
    XCTAssertEqual(detail.body, "CPU exceeded 90%.")
    XCTAssertEqual(detail.severityLevel, .high)
  }

  func testAcknowledgeAlertPostsToAckEndpoint() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/mobile/alerts/a1/ack")
      XCTAssertEqual(request.httpMethod, "POST")
      let body = """
      {"alert":{"id":"a1","title":"CPU spike","body":null,"severity":"high","source":"homelab","sourceNode":null,"sourceService":null,"status":"acknowledged","relatedThreadId":null,"relatedActionId":null,"metadataJson":null,"createdAt":"2026-05-13T00:00:00.000Z","acknowledgedAt":"2026-05-13T01:00:00.000Z","resolvedAt":null}}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let updated = try await client.acknowledgeAlert(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      alertID: "a1"
    )

    XCTAssertEqual(updated.statusLevel, .acknowledged)
    XCTAssertNotNil(updated.acknowledgedAt)
  }

  func testResolveAlertPostsToResolveEndpoint() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/mobile/alerts/a1/resolve")
      XCTAssertEqual(request.httpMethod, "POST")
      let body = """
      {"alert":{"id":"a1","title":"CPU spike","body":null,"severity":"high","source":"homelab","sourceNode":null,"sourceService":null,"status":"resolved","relatedThreadId":null,"relatedActionId":null,"metadataJson":null,"createdAt":"2026-05-13T00:00:00.000Z","acknowledgedAt":null,"resolvedAt":"2026-05-13T02:00:00.000Z"}}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let updated = try await client.resolveAlert(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      alertID: "a1"
    )

    XCTAssertEqual(updated.statusLevel, .resolved)
    XCTAssertNotNil(updated.resolvedAt)
  }

  func testFetchAlertsPassesBeforeCursor() async throws {
    URLProtocolStub.handler = { request in
      let query = request.url?.query ?? ""
      XCTAssertTrue(query.contains("before=2026-05-13"), "Expected before cursor in query: \(query)")
      let body = "{\"alerts\":[]}"
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let alerts = try await client.fetchAlerts(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: nil,
      status: .open,
      limit: 10,
      before: "2026-05-13T00:00:00.000Z"
    )
    XCTAssertEqual(alerts.count, 0)
  }

  func testFetchAlertsMapsHttpError() async throws {
    URLProtocolStub.handler = { _ in
      return (401, Data("{\"error\":\"Unauthorized\"}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    do {
      _ = try await client.fetchAlerts(
        baseURL: URL(string: "https://gateway.example.com")!,
        token: nil,
        status: .open
      )
      XCTFail("Expected HTTP error")
    } catch let error as GatewayChatError {
      XCTAssertEqual(error, .httpError(401, "Unauthorized"))
    }
  }
}

private final class URLProtocolStub: URLProtocol {
  nonisolated(unsafe) static var handler: ((URLRequest) throws -> (Int, Data))?

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
      let (statusCode, data) = try handler(request)
      let response = HTTPURLResponse(
        url: request.url ?? URL(string: "https://gateway.example.com")!,
        statusCode: statusCode,
        httpVersion: nil,
        headerFields: ["Content-Type": "application/json"]
      )!
      client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
      client?.urlProtocol(self, didLoad: data)
      client?.urlProtocolDidFinishLoading(self)
    } catch {
      client?.urlProtocol(self, didFailWithError: error)
    }
  }

  override func stopLoading() {}
}
