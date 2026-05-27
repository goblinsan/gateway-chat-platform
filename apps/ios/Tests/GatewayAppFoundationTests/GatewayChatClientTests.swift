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

  func testFetchPlansDecodesNestedHierarchy() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/plans")
      XCTAssertEqual(request.httpMethod, "GET")
      let body = """
      {"plans":[{"id":"plan-1","userId":"me","title":"Goal","status":"on_track","progressPercent":50,"tags":[],"sourceSystems":["chat-ui"],"metrics":[{"label":"Open tasks","value":"2"}],"createdAt":"2026-05-27T00:00:00.000Z","updatedAt":"2026-05-27T00:00:00.000Z","milestones":[{"id":"m-1","planId":"plan-1","title":"Milestone","status":"on_track","progressPercent":40,"orderIndex":0,"createdAt":"2026-05-27T00:00:00.000Z","updatedAt":"2026-05-27T00:00:00.000Z","tasks":[{"id":"t-1","milestoneId":"m-1","title":"Task","status":"blocked","progressPercent":10,"orderIndex":0,"createdAt":"2026-05-27T00:00:00.000Z","updatedAt":"2026-05-27T00:00:00.000Z"}]}]}]}
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let plans = try await client.fetchPlans(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123"
    )

    XCTAssertEqual(plans.count, 1)
    XCTAssertEqual(plans[0].sourceSystems, ["chat-ui"])
    XCTAssertEqual(plans[0].milestones.first?.tasks.first?.status, .blocked)
  }

  func testCreateMilestonePostsTitleToPlanEndpoint() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/plans/plan-1/milestones")
      XCTAssertEqual(request.httpMethod, "POST")
      let bodyData = try XCTUnwrap(request.stubbedBodyData())
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: String])
      XCTAssertEqual(payload["title"], "MVP")
      return (201, Data("{\"milestone\":{\"id\":\"m-1\"}}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    try await client.createMilestone(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      planID: "plan-1",
      title: "MVP"
    )
  }

  func testRegisterAPNsDeviceNormalizesTokenAndUsesSessionEndpoint() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/session/mobile-devices/apns")
      XCTAssertEqual(request.httpMethod, "POST")
      XCTAssertEqual(request.value(forHTTPHeaderField: "Authorization"), "Bearer token-123")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Client-Platform"), "ios")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-Device-Name"), "My iPhone")
      XCTAssertEqual(request.value(forHTTPHeaderField: "X-Gateway-App-Version"), "1.2.3")

      let bodyData = try XCTUnwrap(request.stubbedBodyData())
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["apnsToken"] as? String, "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789")
      XCTAssertEqual(payload["notificationMinSeverity"] as? String, "high")
      return (200, Data("{}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    try await client.registerAPNsDevice(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      apnsToken: "<ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789>",
      deviceName: "My iPhone",
      appVersion: "1.2.3",
      notificationMinSeverity: .highAndAbove
    )
  }

  func testRegisterAPNsDeviceRejectsEmptyToken() async throws {
    let client = GatewayChatClient(session: makeSession())
    do {
      try await client.registerAPNsDevice(
        baseURL: URL(string: "https://gateway.example.com/chat/")!,
        token: "token-123",
        apnsToken: "   <>   ",
        deviceName: "My iPhone",
        appVersion: nil,
        notificationMinSeverity: .highAndAbove
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

      guard let bodyData = request.stubbedBodyData() else {
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

      guard let bodyData = request.stubbedBodyData() else { return (400, Data("{}".utf8)) }
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

  func testRegisterAPNsDeviceSendsNotificationMinSeverityInBody() async throws {
    URLProtocolStub.handler = { request in
      let bodyData = try XCTUnwrap(request.stubbedBodyData())
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["notificationMinSeverity"] as? String, "critical")
      return (200, Data("{}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    try await client.registerAPNsDevice(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      apnsToken: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      deviceName: nil,
      appVersion: nil,
      notificationMinSeverity: .criticalOnly
    )
  }

  func testRegisterAPNsDeviceSendsOffPreference() async throws {
    URLProtocolStub.handler = { request in
      let bodyData = try XCTUnwrap(request.stubbedBodyData())
      let payload = try XCTUnwrap(JSONSerialization.jsonObject(with: bodyData) as? [String: Any])
      XCTAssertEqual(payload["notificationMinSeverity"] as? String, "off")
      return (200, Data("{}".utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    try await client.registerAPNsDevice(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: nil,
      apnsToken: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      deviceName: nil,
      appVersion: nil,
      notificationMinSeverity: .off
    )
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

  func testFetchNotificationsToleratesMixedPayloadShapes() async throws {
    URLProtocolStub.handler = { request in
      XCTAssertEqual(request.url?.path, "/chat/api/notifications")
      XCTAssertEqual(request.httpMethod, "GET")
      let body = """
      {
        "notifications": [
          {
            "id": "n1",
            "user_id": "jamescoghlan",
            "kind": "scheduled_job.completed",
            "title": "Scheduled work completed",
            "body": "Drink water.",
            "thread_id": "thread-1",
            "source_run_id": "run-1",
            "payload": {
              "scheduled_job_id": "schedule-1",
              "retry_count": 2,
              "ok": true,
              "details": { "source": "scheduler" }
            },
            "read_at": null,
            "dismissed_at": null,
            "created_at": "2026-05-26T18:18:47.0627Z"
          },
          {
            "ID": "n2",
            "UserID": "jamescoghlan",
            "Kind": "scheduled_job.failed",
            "Title": "Scheduled work failed",
            "Body": "No healthy node.",
            "ThreadID": "thread-2",
            "SourceRunID": "run-2",
            "Payload": { "status": "failed" },
            "ReadAt": null,
            "DismissedAt": null,
            "CreatedAt": "2026-05-26T18:19:47.0627Z"
          }
        ]
      }
      """
      return (200, Data(body.utf8))
    }

    let client = GatewayChatClient(session: makeSession())
    let notifications = try await client.fetchNotifications(
      baseURL: URL(string: "https://gateway.example.com/chat/")!,
      token: "token-123",
      unreadOnly: false,
      limit: 25
    )

    XCTAssertEqual(notifications.count, 2)
    XCTAssertEqual(notifications[0].id, "n1")
    XCTAssertEqual(notifications[0].payload?["retry_count"], "2")
    XCTAssertEqual(notifications[0].payload?["ok"], "true")
    XCTAssertEqual(notifications[1].id, "n2")
    XCTAssertEqual(notifications[1].kind, "scheduled_job.failed")
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

private extension URLRequest {
  func stubbedBodyData() -> Data? {
    if let httpBody {
      return httpBody
    }

    guard let stream = httpBodyStream else {
      return nil
    }

    stream.open()
    defer { stream.close() }

    var data = Data()
    let bufferSize = 1024
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: bufferSize)
    defer { buffer.deallocate() }

    while stream.hasBytesAvailable {
      let bytesRead = stream.read(buffer, maxLength: bufferSize)
      if bytesRead < 0 {
        return nil
      }
      if bytesRead == 0 {
        break
      }
      data.append(buffer, count: bytesRead)
    }

    return data
  }
}
