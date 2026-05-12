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
  func sendPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> GatewayChatResult
}

public enum GatewayChatError: LocalizedError, Equatable {
  case missingConfiguration
  case emptyPrompt
  case missingAgent
  case invalidResponse
  case httpError(Int, String?)
  case transport(String)

  public var errorDescription: String? {
    switch self {
    case .missingConfiguration:
      return "Complete setup before using chat."
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
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    let basePath = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    let endpoint = endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    components?.path = basePath.isEmpty ? "/\(endpoint)" : "/\(basePath)/\(endpoint)"
    return components?.url
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
