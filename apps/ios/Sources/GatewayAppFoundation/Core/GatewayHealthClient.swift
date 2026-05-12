import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct GatewayHealthResponse: Decodable, Equatable {
  public let status: String
}

public protocol GatewayHealthChecking {
  func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse
}

public protocol GatewaySessionIdentityChecking {
  func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String?
}

public enum GatewayHealthError: LocalizedError, Equatable {
  case invalidResponse
  case httpError(Int)

  public var errorDescription: String? {
    switch self {
    case .invalidResponse:
      return "Gateway returned an invalid response."
    case let .httpError(code):
      return "Gateway connection failed with HTTP \(code)."
    }
  }
}

public final class GatewayHealthClient: GatewayHealthChecking, GatewaySessionIdentityChecking {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse {
    // Keep any base path (e.g., hostname root or /chat/) and append /api/health.
    // Route mounting and base-path behavior are controlled by gateway-control-plane.
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
      throw GatewayHealthError.httpError(httpResponse.statusCode)
    }

    return try JSONDecoder().decode(GatewayHealthResponse.self, from: data)
  }

  public func fetchConnectionIdentity(baseURL: URL, token: String?) async throws -> String? {
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
      return nil
    }

    let decoded = try JSONDecoder().decode(SessionMeResponse.self, from: data)
    // Identity ordering is aligned to server-resolved /api/session/me response shapes:
    // no client-provided identifier is used for user identity.
    // 1) nested user.id, 2) top-level id.
    return decoded.user?.id ?? decoded.id
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
}

private struct SessionMeResponse: Decodable {
  let id: String?
  let user: SessionUser?
}

private struct SessionUser: Decodable {
  let id: String?
}
