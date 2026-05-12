import Foundation

public protocol TokenStoring {
  func readToken() -> String?
  @discardableResult
  func saveToken(_ token: String) -> Bool
  @discardableResult
  func clearToken() -> Bool
}

public final class InMemoryTokenStore: TokenStoring {
  private var token: String?

  public init(token: String? = nil) {
    self.token = token
  }

  public func readToken() -> String? {
    token
  }

  @discardableResult
  public func saveToken(_ token: String) -> Bool {
    self.token = token
    return true
  }

  @discardableResult
  public func clearToken() -> Bool {
    token = nil
    return true
  }
}

#if canImport(Security)
import Security

public final class KeychainTokenStore: TokenStoring {
  private let service: String
  private let account: String

  public init(service: String = "gateway-chat-platform", account: String = "api-token") {
    self.service = service
    self.account = account
  }

  public func readToken() -> String? {
    var query = baseQuery
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess,
          let data = item as? Data,
          let token = String(data: data, encoding: .utf8)
    else {
      return nil
    }

    return token
  }

  @discardableResult
  public func saveToken(_ token: String) -> Bool {
    guard let data = token.data(using: .utf8) else { return false }

    var addQuery = baseQuery
    addQuery[kSecValueData as String] = data

    let addStatus = SecItemAdd(addQuery as CFDictionary, nil)
    if addStatus == errSecSuccess {
      return true
    }

    guard addStatus == errSecDuplicateItem else { return false }

    let attributes = [kSecValueData as String: data] as CFDictionary
    let updateStatus = SecItemUpdate(baseQuery as CFDictionary, attributes)
    return updateStatus == errSecSuccess
  }

  @discardableResult
  public func clearToken() -> Bool {
    let status = SecItemDelete(baseQuery as CFDictionary)
    return status == errSecSuccess || status == errSecItemNotFound
  }

  private var baseQuery: [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
  }
}
#endif
