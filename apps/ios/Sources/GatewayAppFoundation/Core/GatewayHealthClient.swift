import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct GatewayHealthResponse: Decodable, Equatable, Sendable {
  public let status: String

  public init(status: String) {
    self.status = status
  }
}

public protocol GatewayHealthChecking {
  func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse
}

public protocol GatewaySessionIdentityChecking {
  func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String?
}

public enum GatewayHealthError: LocalizedError, Equatable {
  case invalidResponse
  case httpError(Int, String?)
  case invalidContentType(String?)
  case accessLoginRequired(String?)
  case invalidPayload(String)

  public var errorDescription: String? {
    switch self {
    case .invalidResponse:
      return "Gateway returned an invalid response."
    case let .httpError(code, message):
      if let message, !message.isEmpty {
        return message
      }
      return "Gateway connection failed with HTTP \(code)."
    case let .invalidContentType(contentType):
      let suffix = contentType.map { " (\($0))" } ?? ""
      return "Gateway returned a non-JSON response\(suffix)."
    case let .accessLoginRequired(urlString):
      if let urlString, !urlString.isEmpty {
        return "Gateway is behind Cloudflare Access. The mobile client was redirected to \(urlString)."
      }
      return "Gateway is behind Cloudflare Access. The mobile client received an HTML login response instead of API JSON."
    case let .invalidPayload(message):
      return "Gateway returned JSON in an unexpected format: \(message)"
    }
  }
}

public final class GatewayHealthClient: GatewayHealthChecking, GatewaySessionIdentityChecking, Sendable {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse {
    // Keep any base path (e.g., hostname root or /chat/) and append /api/health.
    // This endpoint path is part of the gateway-control-plane deployment contract.
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/health") else {
      throw GatewayHealthError.invalidResponse
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    let (data, response) = try await session.data(for: request)

    guard let httpResponse = response as? HTTPURLResponse else {
      throw GatewayHealthError.invalidResponse
    }

    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayHealthError.httpError(
        httpResponse.statusCode,
        parseErrorMessage(from: data)
      )
    }

    try validateJSONResponse(httpResponse, data: data)

    do {
      return try JSONDecoder().decode(GatewayHealthResponse.self, from: data)
    } catch let error as DecodingError {
      throw GatewayHealthError.invalidPayload(String(describing: error))
    }
  }

  public func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String? {
    // /api/session/me is the server-owned identity contract; coordinate with
    // gateway-control-plane before changing this endpoint or response assumptions.
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/session/me") else {
      throw GatewayHealthError.invalidResponse
    }

    var request = URLRequest(url: url)
    request.httpMethod = "GET"
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }

    let (data, response) = try await session.data(for: request)
    guard let httpResponse = response as? HTTPURLResponse else {
      throw GatewayHealthError.invalidResponse
    }

    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayHealthError.httpError(
        httpResponse.statusCode,
        parseErrorMessage(from: data)
      )
    }

    try validateJSONResponse(httpResponse, data: data)

    let decoded: SessionMeResponse
    do {
      decoded = try JSONDecoder().decode(SessionMeResponse.self, from: data)
    } catch let error as DecodingError {
      throw GatewayHealthError.invalidPayload(String(describing: error))
    }
    // Prefer nested user.id when the API returns a user object; otherwise fall back
    // to top-level id for deployments that return a flat session payload.
    // No client-provided identifier is used.
    return decoded.user?.id ?? decoded.id ?? decoded.userID
  }

  private func endpointURL(baseURL: URL, endpointPath: String) -> URL? {
    // This preserves both root-mounted hosts and fallback /chat/ mounting by appending
    // endpoints under the incoming base URL path. If this joining rule changes, the
    // gateway-control-plane deployment contract must be updated in lockstep.
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    let basePath = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    let endpoint = endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    components?.path = basePath.isEmpty ? "/\(endpoint)" : "/\(basePath)/\(endpoint)"
    return components?.url
  }

  private func validateJSONResponse(_ response: HTTPURLResponse, data: Data) throws {
    let contentType = response.value(forHTTPHeaderField: "Content-Type")?.lowercased()
    guard contentType?.contains("application/json") == true else {
      if isCloudflareAccessResponse(response: response, data: data) {
        throw GatewayHealthError.accessLoginRequired(response.url?.absoluteString)
      }
      throw GatewayHealthError.invalidContentType(contentType)
    }
  }

  private func isCloudflareAccessResponse(response: HTTPURLResponse, data: Data) -> Bool {
    if let host = response.url?.host?.lowercased(), host.contains("cloudflareaccess.com") {
      return true
    }

    guard let body = String(data: data.prefix(512), encoding: .utf8)?.lowercased() else {
      return false
    }
    return body.contains("cloudflare") && body.contains("access")
  }

  private func parseErrorMessage(from data: Data) -> String? {
    guard
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let message = object["error"] as? String ?? object["message"] as? String
    else {
      return nil
    }
    let trimmed = message.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }
}

private struct SessionMeResponse: Decodable {
  let id: String?
  let userID: String?
  let user: SessionUser?

  enum CodingKeys: String, CodingKey {
    case id
    case userID = "userId"
    case user
  }
}

private struct SessionUser: Decodable {
  let id: String?
}
