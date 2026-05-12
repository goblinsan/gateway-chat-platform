#if canImport(SwiftUI)
import SwiftUI

@MainActor
public final class GatewayAppViewModel: ObservableObject {
  @Published public var baseURL: String
  @Published public var apiToken: String
  @Published public var deviceName: String
  @Published public var connectionStatus: GatewayConnectionStatus
  @Published public var connectionIdentity: String?

  private let session: AppSessionController

  public init(session: AppSessionController) {
    self.session = session
    self.baseURL = ""
    self.deviceName = ""
    self.apiToken = ""
    self.connectionStatus = .unknown
    self.connectionIdentity = nil
    syncFromSession()
  }

  public var isSetupComplete: Bool {
    session.isSetupComplete
  }

  public func saveSetup() throws {
    try session.saveSetup(baseURLString: baseURL, token: apiToken, deviceName: deviceName)
    syncFromSession()
  }

  public func checkConnection() async {
    _ = await session.runHealthCheck()
    syncFromSession()
  }

  public func replaceToken(_ value: String) {
    guard !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
    session.replaceToken(value)
    apiToken = ""
    syncFromSession()
  }

  public func clearLocalData() {
    session.clearLocalData()
    syncFromSession()
    apiToken = ""
  }

  private func syncFromSession() {
    let configuration = session.configuration
    baseURL = configuration.baseURLString
    deviceName = configuration.deviceName
    connectionStatus = session.connectionStatus
    connectionIdentity = session.connectionIdentity
  }
}

public struct GatewayAppRootView: View {
  @StateObject private var model: GatewayAppViewModel

  public init(model: GatewayAppViewModel) {
    _model = StateObject(wrappedValue: model)
  }

  public var body: some View {
    Group {
      if model.isSetupComplete {
        MainNavigationView(model: model)
      } else {
        SetupView(model: model)
      }
    }
  }
}

struct SetupView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      Form {
        Section("Gateway") {
          TextField("Gateway API URL", text: $model.baseURL)
            .textInputAutocapitalization(.never)
            .keyboardType(.URL)
            .autocorrectionDisabled()

          SecureField("API Token", text: $model.apiToken)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()

          TextField("Device Name", text: $model.deviceName)
        }

        if let errorMessage {
          Section {
            Text(errorMessage)
              .foregroundStyle(.red)
          }
        }

        Section {
          Button("Save Setup") {
            do {
              try model.saveSetup()
              errorMessage = nil
            } catch {
              errorMessage = error.localizedDescription
            }
          }

          Button("Test Connection") {
            Task {
              await model.checkConnection()
            }
          }
        }
      }
      .navigationTitle("Gateway Setup")
    }
  }
}

struct MainNavigationView: View {
  @ObservedObject var model: GatewayAppViewModel

  var body: some View {
    TabView {
      NavigationStack {
        Text("Chat")
          .navigationTitle("Chat")
      }
      .tabItem {
        Label("Chat", systemImage: "bubble.left.and.bubble.right")
      }

      NavigationStack {
        Text("Alerts")
          .navigationTitle("Alerts")
      }
      .tabItem {
        Label("Alerts", systemImage: "bell")
      }

      NavigationStack {
        Text("Approvals")
          .navigationTitle("Approvals")
      }
      .tabItem {
        Label("Approvals", systemImage: "checkmark.seal")
      }

      SettingsView(model: model)
        .tabItem {
          Label("Settings", systemImage: "gear")
        }
    }
  }
}

struct SettingsView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var replacementToken = ""

  var body: some View {
    NavigationStack {
      Form {
        Section("Connection") {
          Text("Gateway URL: \(model.baseURL)")
          Text("Device: \(model.deviceName)")
          Text("Identity: \(model.connectionIdentity ?? "Unknown")")
          ConnectionStatusText(status: model.connectionStatus)
          Button("Retest Connection") {
            Task {
              await model.checkConnection()
            }
          }
        }

        Section("Credentials") {
          SecureField("Replace API Token", text: $replacementToken)
          Button("Save New Token") {
            model.replaceToken(replacementToken)
            replacementToken = ""
          }
        }

        Section {
          Button("Clear Local Data", role: .destructive) {
            model.clearLocalData()
          }
        }
      }
      .navigationTitle("Settings")
    }
  }
}

struct ConnectionStatusText: View {
  let status: GatewayConnectionStatus

  var body: some View {
    switch status {
    case .unknown:
      Text("Connection not tested")
    case .checking:
      Text("Checking connection…")
    case .connected:
      Text("Connected")
        .foregroundStyle(.green)
    case let .failed(message):
      Text(message)
        .foregroundStyle(.red)
    }
  }
}
#endif
