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

public final class GatewayHealthClient: GatewayHealthChecking {
  private let session: URLSession

  public init(session: URLSession = .shared) {
    self.session = session
  }

  public func checkHealth(baseURL: URL, token: String?) async throws -> GatewayHealthResponse {
    let url = baseURL.appending(path: "api/health")
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
}
