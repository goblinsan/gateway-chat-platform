import Foundation

public protocol AppConfigurationStoring {
  func load() -> AppConfiguration
  func save(_ configuration: AppConfiguration)
  func clear()
}

public final class UserDefaultsAppConfigurationStore: AppConfigurationStoring {
  private enum Keys {
    static let baseURL = "gateway.base_url"
    static let deviceName = "gateway.device_name"
    static let notificationPreference = "gateway.notification_preference"
  }

  private let defaults: UserDefaults

  public init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  public func load() -> AppConfiguration {
    let rawPref = defaults.string(forKey: Keys.notificationPreference) ?? ""
    let preference = NotificationPreferenceLevel(rawValue: rawPref) ?? .highAndAbove
    return AppConfiguration(
      baseURLString: defaults.string(forKey: Keys.baseURL) ?? "",
      deviceName: defaults.string(forKey: Keys.deviceName) ?? "",
      notificationPreference: preference
    )
  }

  public func save(_ configuration: AppConfiguration) {
    defaults.set(configuration.baseURLString, forKey: Keys.baseURL)
    defaults.set(configuration.deviceName, forKey: Keys.deviceName)
    defaults.set(configuration.notificationPreference.rawValue, forKey: Keys.notificationPreference)
  }

  public func clear() {
    defaults.removeObject(forKey: Keys.baseURL)
    defaults.removeObject(forKey: Keys.deviceName)
    defaults.removeObject(forKey: Keys.notificationPreference)
  }
}
