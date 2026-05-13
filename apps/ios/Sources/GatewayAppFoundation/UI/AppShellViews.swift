#if canImport(SwiftUI)
import SwiftUI
#if canImport(UIKit)
import UIKit
#elseif canImport(AppKit)
import AppKit
#endif
#if canImport(Speech)
import Speech
import AVFoundation
#endif

@MainActor
public final class GatewayAppViewModel: ObservableObject {
  @Published public var baseURL: String
  @Published public var apiToken: String
  @Published public var deviceName: String
  @Published public var connectionStatus: GatewayConnectionStatus
  @Published public var connectionIdentity: String?

  private let session: AppSessionController
  let chatClient: GatewayChatServing

  public init(session: AppSessionController, chatClient: GatewayChatServing = GatewayChatClient()) {
    self.session = session
    self.chatClient = chatClient
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

  var gatewayBaseURL: URL? {
    session.configuration.baseURL
  }

  var gatewayToken: String? {
    session.apiToken
  }

  var gatewayDeviceName: String {
    session.configuration.deviceName
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
      ChatView(model: model)
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

struct ChatView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var agents: [GatewayAgentSummary] = []
  @State private var selectedAgentID: String?
  @State private var messages: [ChatMessageRow] = []
  @State private var threadID: String?
  @State private var prompt = ""
  @State private var isLoadingAgents = false
  @State private var isSending = false
  @State private var errorMessage: String?
  @State private var streamingTask: Task<Void, Never>?
  #if canImport(Speech)
  @StateObject private var speechController = SpeechRecognitionController()
  #endif

  // Fall back to the first item from the latest loaded agent list when no explicit selection is made.
  private var fallbackAgentID: String? {
    agents.first?.id
  }

  private var resolvedAgentID: String? {
    selectedAgentID ?? fallbackAgentID
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        if isLoadingAgents {
          ProgressView("Loading agents…")
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if !agents.isEmpty {
          Picker("Agent", selection: $selectedAgentID) {
            if let defaultName = agents.first?.name {
              Text("Auto-select (\(defaultName))").tag(Optional<String>.none)
            }
            ForEach(agents) { agent in
              Text("\(agent.icon ?? "🤖") \(agent.name)").tag(Optional(agent.id))
            }
          }
          .pickerStyle(.menu)
          .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let threadID {
          Text("Thread: \(threadID)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        ScrollView {
          LazyVStack(alignment: .leading, spacing: 8) {
            if messages.isEmpty {
              Text("Send a prompt to start chatting.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
              ForEach(messages) { message in
                ChatMessageBubble(message: message)
              }
            }
          }
        }

        if let errorMessage {
          Text(errorMessage)
            .font(.footnote)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        HStack(alignment: .bottom, spacing: 8) {
          TextField("Type a prompt…", text: $prompt, axis: .vertical)
            .lineLimit(1...4)
            .textInputAutocapitalization(.sentences)
            .autocorrectionDisabled(false)

          #if canImport(Speech)
          Button {
            Task {
              if speechController.isRecording {
                speechController.stopRecording()
              } else {
                await speechController.requestPermissions()
                guard speechController.recognitionState != .permissionDenied,
                      speechController.recognitionState != .unavailable
                else { return }
                do {
                  try speechController.startRecording()
                } catch {
                  errorMessage = error.localizedDescription
                }
              }
            }
          } label: {
            Image(systemName: speechController.isRecording ? "stop.circle.fill" : "mic.circle")
              .imageScale(.large)
          }
          .disabled(isSending)
          .foregroundStyle(speechController.isRecording ? Color.red : Color.secondary)
          #endif

          if isSending {
            Button("Cancel") {
              streamingTask?.cancel()
            }
          } else {
            Button {
              streamingTask = Task {
                await sendPrompt()
              }
            } label: {
              Text("Send")
            }
            .disabled(prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
          }
        }
      }
      .padding()
      .navigationTitle("Chat")
      #if canImport(Speech)
      .onChange(of: speechController.isRecording) { _, isNowRecording in
        if !isNowRecording, !speechController.transcript.isEmpty {
          prompt = speechController.transcript
        }
      }
      .onChange(of: speechController.recognitionState) { _, newState in
        switch newState {
        case .permissionDenied:
          errorMessage = "Microphone or speech recognition permission denied. Enable access in Settings."
        case .unavailable:
          errorMessage = "Speech recognition is not available on this device."
        case .failed(let msg):
          errorMessage = msg
        default:
          break
        }
      }
      #endif
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Button("Reload Agents") {
            Task {
              await loadAgents()
            }
          }
          .disabled(isLoadingAgents || isSending)
        }
      }
    }
    .task {
      await loadAgents()
    }
  }

  private func loadAgents() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoadingAgents = true
    defer { isLoadingAgents = false }

    do {
      let fetched = try await model.chatClient.fetchAgents(baseURL: baseURL, token: model.gatewayToken)
      agents = fetched
      if let selectedAgentID, !agents.contains(where: { $0.id == selectedAgentID }) {
        self.selectedAgentID = nil
      }
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func sendPrompt() async {
    let trimmedPrompt = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else {
      errorMessage = GatewayChatError.emptyPrompt.localizedDescription
      return
    }
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }
    guard let resolvedAgentID else {
      errorMessage = GatewayChatError.missingAgent.localizedDescription
      return
    }
    guard agents.contains(where: { $0.id == resolvedAgentID }) else {
      errorMessage = "Selected agent is no longer available. Please tap \"Reload Agents\" to refresh the list."
      return
    }

    let userMessage = ChatMessageRow(role: .user, content: trimmedPrompt)
    messages.append(userMessage)
    prompt = ""
    isSending = true
    errorMessage = nil
    defer { isSending = false }

    let conversation = messages.map { message in
      let role: String
      switch message.role {
      case .user:
        role = "user"
      case .assistant:
        role = "assistant"
      }
      return GatewayConversationMessage(role: role, content: message.content)
    }

    // Append a placeholder for the in-progress assistant reply so the user
    // sees the bubble appear immediately and tokens stream into it.
    let placeholderID = UUID()
    messages.append(ChatMessageRow(role: .assistant, content: "", id: placeholderID))

    do {
      let stream = try await model.chatClient.streamPrompt(
        baseURL: baseURL,
        token: model.gatewayToken,
        prompt: GatewayTypedPrompt(text: trimmedPrompt, agentID: resolvedAgentID),
        messages: conversation,
        threadID: threadID,
        deviceName: model.gatewayDeviceName
      )

      var accumulated = ""
      for try await event in stream {
        switch event {
        case let .token(tok):
          accumulated += tok
          if let idx = messages.firstIndex(where: { $0.id == placeholderID }) {
            messages[idx].content = accumulated
          }
        case let .done(_, returnedThreadID):
          if let tid = returnedThreadID {
            threadID = tid
          }
        case let .error(msg):
          errorMessage = msg
        default:
          break
        }
      }

      // Remove the placeholder if nothing was accumulated (e.g. empty response).
      if accumulated.isEmpty {
        messages.removeAll { $0.id == placeholderID }
      }
    } catch is CancellationError {
      // User cancelled: retain partial content, remove empty placeholder.
      if let idx = messages.firstIndex(where: { $0.id == placeholderID }),
         messages[idx].content.isEmpty {
        messages.remove(at: idx)
      }
    } catch {
      // Streaming failed: remove placeholder and retry with the non-streaming endpoint.
      // Show a brief diagnostic message so the user (and any operator watching the screen)
      // can see that streaming was unavailable before the fallback result arrives.
      errorMessage = "Streaming unavailable, retrying… (\(error.localizedDescription))"
      messages.removeAll { $0.id == placeholderID }
      do {
        let result = try await model.chatClient.sendPrompt(
          baseURL: baseURL,
          token: model.gatewayToken,
          prompt: GatewayTypedPrompt(text: trimmedPrompt, agentID: resolvedAgentID),
          messages: conversation,
          threadID: threadID,
          deviceName: model.gatewayDeviceName
        )
        if let returnedThreadID = result.threadID {
          threadID = returnedThreadID
        }
        messages.append(ChatMessageRow(role: .assistant, content: result.content))
        errorMessage = nil
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }
}

struct ChatMessageBubble: View {
  let message: ChatMessageRow

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(message.role == .user ? "You" : "Assistant")
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        if message.role == .assistant {
          Button("Copy") {
            copyToClipboard(message.content)
          }
          .font(.caption)
        }
      }

      Text(message.content)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(message.role == .user ? Color.blue.opacity(0.15) : Color.gray.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))
    }
  }
}

struct ChatMessageRow: Identifiable, Equatable {
  enum Role: String {
    case user
    case assistant
  }

  let id: UUID
  let role: Role
  var content: String

  init(role: Role, content: String, id: UUID = UUID()) {
    self.id = id
    self.role = role
    self.content = content
  }
}

private func copyToClipboard(_ text: String) {
  #if canImport(UIKit)
  UIPasteboard.general.string = text
  #elseif canImport(AppKit)
  NSPasteboard.general.clearContents()
  NSPasteboard.general.setString(text, forType: .string)
  #endif
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
