import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct GatewayAgentSummary: Decodable, Equatable, Identifiable {
  public let id: String
  public let name: String
  public let icon: String?
  public let enabled: Bool?
}

// MARK: - Alert models

/// Severity level for a gateway alert.
public enum GatewayAlertSeverity: String, Decodable, Equatable, CaseIterable, Sendable {
  case critical
  case high
  case medium
  case low
  case info
}

/// Status of a gateway alert.
public enum GatewayAlertStatus: String, Decodable, Equatable, CaseIterable, Sendable {
  case open
  case acknowledged
  case resolved
}

/// Summary fields returned by the alert list endpoint.
public struct GatewayAlertSummary: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let severity: String
  public let source: String
  public let sourceNode: String?
  public let sourceService: String?
  public let status: String
  public let createdAt: String
  public let acknowledgedAt: String?
  public let resolvedAt: String?

  public var severityLevel: GatewayAlertSeverity {
    GatewayAlertSeverity(rawValue: severity) ?? .info
  }

  public var statusLevel: GatewayAlertStatus {
    GatewayAlertStatus(rawValue: status) ?? .open
  }
}

/// Full alert detail returned by the single-alert endpoint.
public struct GatewayAlertDetail: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let body: String?
  public let severity: String
  public let source: String
  public let sourceNode: String?
  public let sourceService: String?
  public let status: String
  public let relatedThreadId: String?
  public let relatedActionId: String?
  public let metadataJson: String?
  public let createdAt: String
  public let acknowledgedAt: String?
  public let resolvedAt: String?

  public var severityLevel: GatewayAlertSeverity {
    GatewayAlertSeverity(rawValue: severity) ?? .info
  }

  public var statusLevel: GatewayAlertStatus {
    GatewayAlertStatus(rawValue: status) ?? .open
  }
}

// MARK: - Action Approval models

/// Risk level for an action approval request.
public enum GatewayApprovalRiskLevel: String, Decodable, Equatable, CaseIterable, Sendable {
  case critical
  case high
  case medium
  case low
}

/// Status of an action approval request.
public enum GatewayApprovalStatus: String, Decodable, Equatable, CaseIterable, Sendable {
  case pending
  case approved
  case denied
  case expired
}

/// An action approval record returned by the approvals API.
public struct GatewayActionApproval: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let userId: String
  public let title: String
  public let description: String?
  public let riskLevel: String
  public let actionType: String
  public let targetNode: String?
  public let targetService: String?
  public let proposedByAgentId: String?
  public let status: String
  public let expiresAt: String?
  public let createdAt: String
  public let decidedAt: String?
  public let decidedBy: String?
  public let metadataJson: String?

  public var riskLevelValue: GatewayApprovalRiskLevel {
    GatewayApprovalRiskLevel(rawValue: riskLevel) ?? .medium
  }

  public var statusValue: GatewayApprovalStatus {
    GatewayApprovalStatus(rawValue: status) ?? .pending
  }
}

/// A single event emitted by the `/api/chat/stream` SSE endpoint.
public enum GatewayStreamEvent: Equatable, Sendable {
  /// A text token from the assistant response.
  case token(String)
  /// Stream finished normally. Carries the resolved agent and thread IDs.
  case done(agentID: String, threadID: String?)
  /// The orchestrated agent requires human approval before proceeding.
  case approvalRequest
  /// An alert was created during the agent run.
  case alertCreated
  /// A tool invocation has started.
  case toolStarted
  /// A tool invocation returned a result.
  case toolResult
  /// The server reported a streaming error.
  case error(String)
}

public struct GatewayConversationMessage: Equatable, Encodable {
  public let role: String
  public let content: String

  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}

public struct GatewayTypedPrompt: Equatable {
  public let text: String
  public let agentID: String?

  public init(text: String, agentID: String?) {
    self.text = text
    self.agentID = agentID
  }
}

public struct GatewayChatResult: Equatable {
  public let agentID: String
  public let content: String
  public let threadID: String?
}

public protocol GatewayChatServing {
  func fetchAgents(baseURL: URL, token: String?) async throws -> [GatewayAgentSummary]
  func registerAPNsDevice(
    baseURL: URL,
    token: String?,
    apnsToken: String,
    deviceName: String?
  ) async throws
  func sendPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> GatewayChatResult
  /// Open a streaming request to `/api/chat/stream` and emit SSE events via
  /// the returned `AsyncThrowingStream`. Pre-flight errors (empty prompt, missing
  /// agent, bad URL) are thrown before the stream is returned.  Iterating the
  /// stream yields events until a `.done` event or an error is encountered.
  /// Cancelling the consuming `Task` closes the connection gracefully.
  func streamPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> AsyncThrowingStream<GatewayStreamEvent, Error>

  /// Fetch a page of alerts for the authenticated user.
  func fetchAlerts(
    baseURL: URL,
    token: String?,
    status: GatewayAlertStatus,
    limit: Int,
    before: String?
  ) async throws -> [GatewayAlertSummary]

  /// Fetch the full detail for a single alert.
  func fetchAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  /// Acknowledge an alert (mark it as read/actioned).
  func acknowledgeAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  /// Resolve an alert.
  func resolveAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  // MARK: - Action Approval

  /// Fetch pending action approvals for the authenticated user.
  func fetchPendingApprovals(
    baseURL: URL,
    token: String?
  ) async throws -> [GatewayActionApproval]

  /// Fetch the full detail for a single action approval.
  func fetchApproval(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval

  /// Approve a pending action.
  func approveAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval

  /// Deny a pending action.
  func denyAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval
}

public enum GatewayChatError: LocalizedError, Equatable {
  case missingConfiguration
  case invalidAPNsToken
  case emptyPrompt
  case missingAgent
  case invalidResponse
  case httpError(Int, String?)
  case transport(String)

  public var errorDescription: String? {
    switch self {
    case .missingConfiguration:
      return "Complete setup before using chat."
    case .invalidAPNsToken:
      return "Provide a valid APNs token."
    case .emptyPrompt:
      return "Enter a prompt before sending."
    case .missingAgent:
      return "Select an agent before sending your message."
    case .invalidResponse:
      return "Gateway returned an invalid chat response."
    case let .httpError(statusCode, message):
      if let message, !message.isEmpty {
        return message
      }
      return "Gateway chat request failed with HTTP \(statusCode)."
    case let .transport(message):
      return "Unable to reach the gateway. \(message)"
    }
  }
}

public final class GatewayChatClient: GatewayChatServing {
  private static let apnsTokenPattern = "^[a-f0-9]{32,512}$"
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func fetchAgents(baseURL: URL, token: String?) async throws -> [GatewayAgentSummary] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/agents") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AgentsResponse.self, from: data)
    return decoded.agents
  }

  public func registerAPNsDevice(
    baseURL: URL,
    token: String?,
    apnsToken: String,
    deviceName: String?
  ) async throws {
    let normalizedToken = apnsToken
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "<", with: "")
      .replacingOccurrences(of: ">", with: "")
      .replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
      .lowercased()
    guard normalizedToken.range(of: Self.apnsTokenPattern, options: .regularExpression) != nil else {
      throw GatewayChatError.invalidAPNsToken
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/session/mobile-devices/apns") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(RegisterAPNsDevicePayload(apnsToken: normalizedToken))

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func sendPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> GatewayChatResult {
    let trimmedPrompt = prompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else { throw GatewayChatError.emptyPrompt }

    guard let agentID = prompt.agentID?.trimmingCharacters(in: .whitespacesAndNewlines), !agentID.isEmpty else {
      throw GatewayChatError.missingAgent
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/chat") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = ChatRequestPayload(
      agentID: agentID,
      threadID: threadID,
      messages: messages.map { .init(role: $0.role, content: $0.content) }
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ChatResponsePayload.self, from: data)
    let assistantContent = decoded.message.content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !assistantContent.isEmpty else { throw GatewayChatError.invalidResponse }
    let normalizedAgentID = decoded.agentID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedAgentID.isEmpty else { throw GatewayChatError.invalidResponse }
    let normalizedThreadID = decoded.threadID?.trimmingCharacters(in: .whitespacesAndNewlines)

    return GatewayChatResult(
      agentID: normalizedAgentID,
      content: assistantContent,
      threadID: (normalizedThreadID?.isEmpty == false) ? normalizedThreadID : nil
    )
  }

  private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
    do {
      return try await session.data(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }
  }

  public func streamPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> AsyncThrowingStream<GatewayStreamEvent, Error> {
    let trimmedPrompt = prompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else { throw GatewayChatError.emptyPrompt }

    guard let agentID = prompt.agentID?.trimmingCharacters(in: .whitespacesAndNewlines), !agentID.isEmpty else {
      throw GatewayChatError.missingAgent
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/chat/stream") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

    let payload = ChatRequestPayload(
      agentID: agentID,
      threadID: threadID,
      messages: messages.map { .init(role: $0.role, content: $0.content) }
    )
    request.httpBody = try JSONEncoder().encode(payload)

    #if canImport(FoundationNetworking)
    // FoundationNetworking (Linux) does not expose URLSession.bytes(for:).
    // Load the full response body and replay SSE events synchronously.
    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let sseText = String(data: data, encoding: .utf8) ?? ""
    let events = sseText.components(separatedBy: "\n").compactMap {
      parseSseLine($0, fallbackAgentID: agentID)
    }
    return AsyncThrowingStream { continuation in
      for event in events {
        continuation.yield(event)
      }
      continuation.finish()
    }
    #else
    // On Apple platforms use the native streaming API so tokens arrive
    // incrementally as they are produced by the server.
    let (bytes, response): (URLSession.AsyncBytes, URLResponse)
    do {
      (bytes, response) = try await session.bytes(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }

    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      var errorData = Data()
      for try await byte in bytes {
        errorData.append(byte)
      }
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: errorData))
    }

    return AsyncThrowingStream { continuation in
      let feedTask = Task {
        do {
          for try await line in bytes.lines {
            if Task.isCancelled { break }
            if let event = parseSseLine(line, fallbackAgentID: agentID) {
              continuation.yield(event)
            }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in feedTask.cancel() }
    }
    #endif
  }

  /// Parse a single SSE `data:` line into a `GatewayStreamEvent`.
  /// Returns `nil` for lines that are not SSE data lines or contain unknown types.
  private func parseSseLine(_ line: String, fallbackAgentID: String) -> GatewayStreamEvent? {
    guard line.hasPrefix("data: ") else { return nil }
    let jsonStr = String(line.dropFirst(6))
    guard
      let data = jsonStr.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = json["type"] as? String
    else { return nil }

    switch type {
    case "token":
      guard let tok = json["token"] as? String else { return nil }
      return .token(tok)
    case "done":
      let aid = (json["agentId"] as? String) ?? fallbackAgentID
      let rawTID = json["threadId"] as? String
      let tid = (rawTID?.isEmpty == false) ? rawTID : nil
      return .done(agentID: aid, threadID: tid)
    case "approval_request":
      return .approvalRequest
    case "alert_created":
      return .alertCreated
    case "tool_started":
      return .toolStarted
    case "tool_result":
      return .toolResult
    case "error":
      let msg = json["error"] as? String ?? "Unknown streaming error"
      return .error(msg)
    default:
      return nil
    }
  }

  // MARK: - Alert endpoints

  public func fetchAlerts(
    baseURL: URL,
    token: String?,
    status: GatewayAlertStatus = .open,
    limit: Int = 20,
    before: String? = nil
  ) async throws -> [GatewayAlertSummary] {
    var components = URLComponents()
    components.queryItems = [
      URLQueryItem(name: "status", value: status.rawValue),
      URLQueryItem(name: "limit", value: String(limit)),
    ]
    if let before {
      components.queryItems?.append(URLQueryItem(name: "before", value: before))
    }
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts") else {
      throw GatewayChatError.missingConfiguration
    }
    var urlWithQuery = url
    if let query = components.percentEncodedQuery {
      urlWithQuery = URL(string: url.absoluteString + "?" + query) ?? url
    }

    var request = URLRequest(url: urlWithQuery)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertsListResponse.self, from: data)
    return decoded.alerts
  }

  public func fetchAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  public func acknowledgeAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)/ack") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  public func resolveAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)/resolve") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  // MARK: - Action Approval endpoints

  public func fetchPendingApprovals(
    baseURL: URL,
    token: String?
  ) async throws -> [GatewayActionApproval] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/pending") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalsListResponse.self, from: data)
    return decoded.approvals
  }

  public func fetchApproval(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  public func approveAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)/approve") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  public func denyAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)/deny") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await perform(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  private func validateHTTPResponse(_ response: URLResponse) throws -> HTTPURLResponse {
    guard let httpResponse = response as? HTTPURLResponse else {
      throw GatewayChatError.invalidResponse
    }
    return httpResponse
  }

  private func parseErrorMessage(from data: Data) -> String? {
    guard !data.isEmpty else { return nil }
    guard let decoded = try? JSONDecoder().decode(APIErrorPayload.self, from: data) else { return nil }
    return decoded.message ?? decoded.error
  }

  private func addCommonHeaders(request: inout URLRequest, token: String?, deviceName: String?) {
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    request.setValue("ios", forHTTPHeaderField: "X-Gateway-Client-Platform")
    if let deviceName, !deviceName.isEmpty {
      request.setValue(deviceName, forHTTPHeaderField: "X-Gateway-Device-Name")
    }
  }

  private func endpointURL(baseURL: URL, endpointPath: String) -> URL? {
    let endpoint = endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard !endpoint.isEmpty else { return baseURL }
    return baseURL.appendingPathComponent(endpoint)
  }
}

private struct AgentsResponse: Decodable {
  let agents: [GatewayAgentSummary]
}

private struct ChatRequestPayload: Encodable {
  let agentID: String
  let threadID: String?
  let messages: [Message]

  enum CodingKeys: String, CodingKey {
    case agentID = "agentId"
    case threadID = "threadId"
    case messages
  }

  struct Message: Encodable {
    let role: String
    let content: String
  }
}

private struct RegisterAPNsDevicePayload: Encodable {
  let apnsToken: String
}

private struct ChatResponsePayload: Decodable {
  let agentID: String
  let message: AssistantMessage
  let threadID: String?

  enum CodingKeys: String, CodingKey {
    case agentID = "agentId"
    case message
    case threadID = "threadId"
  }

  struct AssistantMessage: Decodable {
    let content: String
  }
}

private struct APIErrorPayload: Decodable {
  let error: String?
  let message: String?
}

private struct AlertsListResponse: Decodable {
  let alerts: [GatewayAlertSummary]
}

private struct AlertDetailResponse: Decodable {
  let alert: GatewayAlertDetail
}

private struct ApprovalsListResponse: Decodable {
  let approvals: [GatewayActionApproval]
}

private struct ApprovalDetailResponse: Decodable {
  let approval: GatewayActionApproval
}
