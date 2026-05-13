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
  /// Set this to an alert ID to deep-link into its detail view when the app
  /// is foregrounded from a push notification tap.
  @Published public var pendingAlertID: String?

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
    self.pendingAlertID = nil
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
  @State private var selectedTab: Int = 0

  var body: some View {
    TabView(selection: $selectedTab) {
      ChatView(model: model)
        .tabItem {
          Label("Chat", systemImage: "bubble.left.and.bubble.right")
        }
        .tag(0)

      AlertInboxView(model: model)
        .tabItem {
          Label("Alerts", systemImage: "bell")
        }
        .tag(1)

      NavigationStack {
        Text("Approvals")
          .navigationTitle("Approvals")
      }
      .tabItem {
        Label("Approvals", systemImage: "checkmark.seal")
      }
      .tag(2)

      SettingsView(model: model)
        .tabItem {
          Label("Settings", systemImage: "gear")
        }
        .tag(3)
    }
    .onChange(of: model.pendingAlertID) { _, alertID in
      if alertID != nil {
        selectedTab = 1
      }
    }
  }
}

// MARK: - Alert Views

/// Colour-coded badge label for a severity level.
struct SeverityBadge: View {
  let severity: GatewayAlertSeverity

  var label: String {
    switch severity {
    case .critical: return "CRITICAL"
    case .high: return "HIGH"
    case .medium: return "MEDIUM"
    case .low: return "LOW"
    case .info: return "INFO"
    }
  }

  var color: Color {
    switch severity {
    case .critical: return .red
    case .high: return .orange
    case .medium: return .yellow
    case .low: return .blue
    case .info: return .gray
    }
  }

  var body: some View {
    Text(label)
      .font(.caption2.weight(.bold))
      .foregroundStyle(.white)
      .padding(.horizontal, 6)
      .padding(.vertical, 2)
      .background(color)
      .clipShape(RoundedRectangle(cornerRadius: 4))
  }
}

/// A single row in the alert inbox list.
struct AlertRowView: View {
  let alert: GatewayAlertSummary

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        SeverityBadge(severity: alert.severityLevel)
        Text(alert.title)
          .font(.headline)
          .lineLimit(1)
        Spacer()
      }
      HStack {
        Text(alert.source)
          .font(.caption)
          .foregroundStyle(.secondary)
        if let node = alert.sourceNode {
          Text("·")
            .font(.caption)
            .foregroundStyle(.secondary)
          Text(node)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        Text(alert.createdAt.alertFormattedDate())
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 2)
  }
}

/// The main alert inbox list view.
struct AlertInboxView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var alerts: [GatewayAlertSummary] = []
  @State private var selectedStatus: GatewayAlertStatus = .open
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var selectedAlertID: String?
  @State private var navigationPath = NavigationPath()

  var body: some View {
    NavigationStack(path: $navigationPath) {
      Group {
        if isLoading && alerts.isEmpty {
          ProgressView("Loading alerts…")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, alerts.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle)
              .foregroundStyle(.red)
            Text(errorMessage)
              .multilineTextAlignment(.center)
              .foregroundStyle(.secondary)
            Button("Retry") {
              Task { await loadAlerts() }
            }
          }
          .padding()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if alerts.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "bell.slash")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
            Text("No \(selectedStatus.rawValue) alerts")
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List(alerts) { alert in
            NavigationLink(value: alert.id) {
              AlertRowView(alert: alert)
            }
          }
          .refreshable {
            await loadAlerts()
          }
        }
      }
      .navigationTitle("Alerts")
      .toolbar {
        ToolbarItem(placement: .topBarTrailing) {
          Picker("Status", selection: $selectedStatus) {
            Text("Open").tag(GatewayAlertStatus.open)
            Text("Ack'd").tag(GatewayAlertStatus.acknowledged)
            Text("Resolved").tag(GatewayAlertStatus.resolved)
          }
          .pickerStyle(.segmented)
          .frame(minWidth: 180)
        }
      }
      .navigationDestination(for: String.self) { alertID in
        AlertDetailView(model: model, alertID: alertID)
      }
    }
    .task {
      await loadAlerts()
    }
    .onChange(of: selectedStatus) { _, _ in
      Task { await loadAlerts() }
    }
    .onChange(of: model.pendingAlertID) { _, alertID in
      if let alertID {
        navigationPath.append(alertID)
        model.pendingAlertID = nil
      }
    }
  }

  private func loadAlerts() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoading = true
    defer { isLoading = false }

    do {
      alerts = try await model.chatClient.fetchAlerts(
        baseURL: baseURL,
        token: model.gatewayToken,
        status: selectedStatus,
        limit: 50,
        before: nil
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}

/// Detail view for a single alert, with acknowledge and resolve actions.
struct AlertDetailView: View {
  @ObservedObject var model: GatewayAppViewModel
  let alertID: String

  @State private var alert: GatewayAlertDetail?
  @State private var isLoading = false
  @State private var isActioning = false
  @State private var errorMessage: String?

  var body: some View {
    Group {
      if isLoading && alert == nil {
        ProgressView("Loading…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let alert {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 8) {
              SeverityBadge(severity: alert.severityLevel)
              Text(alert.statusLevel.displayLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
              Spacer()
            }

            Text(alert.title)
              .font(.title2.weight(.semibold))

            Divider()

            Group {
              LabeledRow(label: "Source", value: alert.source)
              if let node = alert.sourceNode {
                LabeledRow(label: "Node", value: node)
              }
              if let service = alert.sourceService {
                LabeledRow(label: "Service", value: service)
              }
              LabeledRow(label: "Created", value: alert.createdAt.alertFormattedDate())
              if let ack = alert.acknowledgedAt {
                LabeledRow(label: "Acknowledged", value: ack.alertFormattedDate())
              }
              if let res = alert.resolvedAt {
                LabeledRow(label: "Resolved", value: res.alertFormattedDate())
              }
            }

            if let body = alert.body, !body.isEmpty {
              Divider()
              Text("Summary")
                .font(.headline)
              Text(body)
                .foregroundStyle(.primary)
            }

            if let meta = alert.metadataJson, !meta.isEmpty {
              Divider()
              Text("Metadata")
                .font(.headline)
              Text(meta)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
            }

            if let errorMessage {
              Text(errorMessage)
                .font(.footnote)
                .foregroundStyle(.red)
            }

            if alert.statusLevel != .resolved {
              Divider()
              HStack(spacing: 12) {
                if alert.statusLevel == .open {
                  Button {
                    Task { await acknowledge() }
                  } label: {
                    Label("Acknowledge", systemImage: "checkmark.circle")
                      .frame(maxWidth: .infinity)
                  }
                  .buttonStyle(.borderedProminent)
                  .disabled(isActioning)
                }

                Button {
                  Task { await resolve() }
                } label: {
                  Label("Resolve", systemImage: "checkmark.seal")
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(isActioning)
              }
            }
          }
          .padding()
        }
      } else if let errorMessage {
        VStack(spacing: 12) {
          Image(systemName: "exclamationmark.triangle")
            .font(.largeTitle)
            .foregroundStyle(.red)
          Text(errorMessage)
            .multilineTextAlignment(.center)
            .foregroundStyle(.secondary)
          Button("Retry") {
            Task { await loadAlert() }
          }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle("Alert Detail")
    .navigationBarTitleDisplayMode(.inline)
    .task {
      await loadAlert()
    }
  }

  private func loadAlert() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoading = true
    defer { isLoading = false }

    do {
      alert = try await model.chatClient.fetchAlert(
        baseURL: baseURL,
        token: model.gatewayToken,
        alertID: alertID
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func acknowledge() async {
    guard let baseURL = model.gatewayBaseURL else { return }

    isActioning = true
    defer { isActioning = false }

    do {
      alert = try await model.chatClient.acknowledgeAlert(
        baseURL: baseURL,
        token: model.gatewayToken,
        alertID: alertID
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func resolve() async {
    guard let baseURL = model.gatewayBaseURL else { return }

    isActioning = true
    defer { isActioning = false }

    do {
      alert = try await model.chatClient.resolveAlert(
        baseURL: baseURL,
        token: model.gatewayToken,
        alertID: alertID
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}

private struct LabeledRow: View {
  let label: String
  let value: String

  var body: some View {
    HStack(alignment: .top) {
      Text(label)
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(width: 90, alignment: .leading)
      Text(value)
        .font(.body)
    }
  }
}

private extension GatewayAlertStatus {
  var displayLabel: String {
    switch self {
    case .open: return "Open"
    case .acknowledged: return "Acknowledged"
    case .resolved: return "Resolved"
    }
  }
}

private extension String {
  /// Formats an ISO-8601 date string for display in the alert views.
  /// Falls back to the raw string if parsing fails.
  func alertFormattedDate() -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = formatter.date(from: self) {
      return date.formatted(date: .abbreviated, time: .shortened)
    }
    // Try without fractional seconds
    formatter.formatOptions = [.withInternetDateTime]
    if let date = formatter.date(from: self) {
      return date.formatted(date: .abbreviated, time: .shortened)
    }
    return self
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
