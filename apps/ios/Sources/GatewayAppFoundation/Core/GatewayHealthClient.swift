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
    // Keep any base path (for example /chat) and append /api/health.
    // Route mounting is controlled by gateway-control-plane deployment config.
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
    return decoded.user?.id ?? decoded.id ?? decoded.userId ?? decoded.email
  }

  private func endpointURL(baseURL: URL, endpointPath: String) -> URL? {
    var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)
    let basePath = components?.path.trimmingCharacters(in: CharacterSet(charactersIn: "/")) ?? ""
    let endpoint = endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    components?.path = basePath.isEmpty ? "/\(endpoint)" : "/\(basePath)/\(endpoint)"
    return components?.url
  }
}

private struct SessionMeResponse: Decodable {
  let id: String?
  let userId: String?
  let email: String?
  let user: SessionUser?
}

private struct SessionUser: Decodable {
  let id: String?
  let email: String?
}
