#if canImport(SwiftUI)
import SwiftUI
#if canImport(UniformTypeIdentifiers)
import UniformTypeIdentifiers
#endif
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
  @Published public private(set) var isBootstrappingSession = true
  @Published public var baseURL: String
  @Published public var apiToken: String
  @Published public var deviceName: String
  @Published public var connectionStatus: GatewayConnectionStatus
  @Published public var connectionIdentity: String?
  /// Set this to an alert ID to deep-link into its detail view when the app
  /// is foregrounded from a push notification tap.
  @Published public var pendingAlertID: String?
  /// Set this to an approval ID to deep-link into its approval card when the
  /// app is foregrounded from an approval push notification tap.
  @Published public var pendingApprovalID: String?
  /// Current notification preference level, persisted across launches.
  @Published public var notificationPreference: NotificationPreferenceLevel

  // MARK: - TTS state

  /// Whether the gateway has TTS enabled (set after first voices fetch).
  @Published public var ttsEnabled: Bool = false
  /// Voices reported by the gateway for the picker.
  @Published public var availableVoices: [GatewayVoice] = []
  /// Persisted voice selection used for all speech synthesis.  `nil` means
  /// "use server default".
  @Published public var selectedVoiceID: String?
  /// Active TTS playback controller — also exposes `isSpeaking` for the UI.
  #if canImport(AVFoundation)
  public let ttsController = TTSController()
  #endif

  private static let selectedVoiceDefaultsKey = "gateway.tts.selectedVoiceID"

  private let session: AppSessionController
  let chatClient: GatewayChatServing
  let alertCache: LocalAlertCache

  public init(
    session: AppSessionController,
    chatClient: GatewayChatServing = GatewayChatClient(),
    alertCache: LocalAlertCache = LocalAlertCache()
  ) {
    self.session = session
    self.chatClient = chatClient
    self.alertCache = alertCache
    self.baseURL = ""
    self.deviceName = ""
    self.apiToken = ""
    self.connectionStatus = .unknown
    self.connectionIdentity = nil
    self.pendingAlertID = nil
    self.pendingApprovalID = nil
    self.notificationPreference = .highAndAbove
    self.isBootstrappingSession = !session.hasLoadedPersistedState
    self.selectedVoiceID = UserDefaults.standard.string(forKey: Self.selectedVoiceDefaultsKey)
    syncFromSession()
  }

  public var isSetupComplete: Bool {
    session.isSetupComplete
  }

  public func bootstrapSessionIfNeeded() async {
    guard isBootstrappingSession else { return }
    await session.loadPersistedState()
    syncFromSession()
    isBootstrappingSession = false
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

  public func saveNotificationPreference(_ level: NotificationPreferenceLevel) {
    session.saveNotificationPreference(level)
    notificationPreference = level
  }

  public func clearLocalData() {
    session.clearLocalData()
    alertCache.clear()
    syncFromSession()
    apiToken = ""
  }

  // MARK: - TTS

  /// Refresh the voice list from the gateway.  Updates `ttsEnabled` based on
  /// the server response so callers can hide Speak buttons when disabled.
  public func loadVoices() async {
    guard let baseURL = gatewayBaseURL else { return }
    do {
      let result = try await chatClient.fetchVoices(baseURL: baseURL, token: gatewayToken)
      availableVoices = result.voices
      ttsEnabled = result.enabled
      // Drop a stale selection if the server no longer offers that voice.
      if let id = selectedVoiceID, !result.voices.contains(where: { $0.id == id }) {
        setSelectedVoice(nil)
      }
    } catch {
      ttsEnabled = false
    }
  }

  /// Persist the user's voice choice across launches.
  public func setSelectedVoice(_ voiceID: String?) {
    selectedVoiceID = voiceID
    let defaults = UserDefaults.standard
    if let voiceID, !voiceID.isEmpty {
      defaults.set(voiceID, forKey: Self.selectedVoiceDefaultsKey)
    } else {
      defaults.removeObject(forKey: Self.selectedVoiceDefaultsKey)
    }
  }

  /// Synthesize and play `text` using the currently selected voice.  Silently
  /// no-ops when TTS is disabled or the gateway is unreachable.
  public func speak(text: String, voice: String? = nil) async {
    #if canImport(AVFoundation)
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let baseURL = gatewayBaseURL else { return }
    do {
      let result = try await chatClient.synthesizeSpeech(
        baseURL: baseURL,
        token: gatewayToken,
        text: trimmed,
        voice: voice ?? selectedVoiceID
      )
      ttsController.play(audio: result.audio, contentType: result.contentType)
    } catch {
      // Surface via the controller's lastError so the UI can show it if it
      // chooses; otherwise stay quiet for fire-and-forget auto-speak.
      ttsController.stop()
    }
    #endif
  }

  public func stopSpeaking() {
    #if canImport(AVFoundation)
    ttsController.stop()
    #endif
  }

  private func syncFromSession() {
    let configuration = session.configuration
    baseURL = configuration.baseURLString
    deviceName = configuration.deviceName
    connectionStatus = session.connectionStatus
    connectionIdentity = session.connectionIdentity
    notificationPreference = configuration.notificationPreference
  }
}

public struct GatewayAppRootView: View {
  @StateObject private var model: GatewayAppViewModel

  public init(model: GatewayAppViewModel) {
    _model = StateObject(wrappedValue: model)
  }

  public var body: some View {
    Group {
      if model.isBootstrappingSession {
        ProgressView("Loading Gateway…")
      } else if model.isSetupComplete {
        MainNavigationView(model: model)
      } else {
        SetupView(model: model)
      }
    }
    .task {
      await model.bootstrapSessionIfNeeded()
    }
  }
}

struct SetupView: View {
  private enum Field: Hashable {
    case baseURL
    case apiToken
    case deviceName
  }

  @ObservedObject var model: GatewayAppViewModel
  @State private var errorMessage: String?
  @State private var isSavingSetup = false
  @State private var isTestingConnection = false
  @State private var revealToken = false
  @FocusState private var focusedField: Field?

  var body: some View {
    NavigationStack {
      Form {
        Section("Gateway") {
          TextField("Gateway API URL", text: $model.baseURL)
            .gatewayTextInputAutocapitalizationNever()
            .gatewayURLKeyboard()
            .autocorrectionDisabled()
            .focused($focusedField, equals: .baseURL)

          RevealableTokenField(
            title: "API Token",
            text: $model.apiToken,
            isRevealed: $revealToken
          )
          .focused($focusedField, equals: .apiToken)

          TextField("Device Name", text: $model.deviceName)
            .focused($focusedField, equals: .deviceName)
        }

        if let errorMessage {
          Section {
            Text(errorMessage)
              .foregroundStyle(.red)
          }
        }

        if case let .failed(reason) = model.connectionStatus {
          Section {
            Text(reason)
              .foregroundStyle(.red)
          }
        } else if case .connected = model.connectionStatus {
          Section {
            Text("Connected")
              .foregroundStyle(.green)
          }
        }

        Section {
          Button("Save Setup") {
            isSavingSetup = true
            do {
              try model.saveSetup()
              errorMessage = nil
            } catch {
              errorMessage = error.localizedDescription
            }
            isSavingSetup = false
          }
          .disabled(isSavingSetup || isTestingConnection)

          Button {
            isTestingConnection = true
            Task {
              await model.checkConnection()
              isTestingConnection = false
            }
          } label: {
            HStack(spacing: 6) {
              Text("Test Connection")
              if isTestingConnection {
                ProgressView()
                  .controlSize(.small)
              }
            }
          }
          .disabled(isSavingSetup || isTestingConnection)
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .navigationTitle("Gateway Setup")
    }
  }
}

struct MainNavigationView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var selectedTab: Int = 0

  var body: some View {
    TabView(selection: $selectedTab) {
      DeferredTabView(isActive: selectedTab == 0) {
        ChatView(model: model)
      }
        .tabItem {
          Label("Chat", systemImage: "bubble.left.and.bubble.right")
        }
        .tag(0)

      DeferredTabView(isActive: selectedTab == 1) {
        LivePlanTrackerView(model: model)
      }
        .tabItem {
          Label("Plans", systemImage: "target")
        }
        .tag(1)

      DeferredTabView(isActive: selectedTab == 2) {
        AlertInboxView(model: model)
      }
        .tabItem {
          Label("Alerts", systemImage: "bell")
        }
        .tag(2)

      DeferredTabView(isActive: selectedTab == 3) {
        ApprovalInboxView(model: model)
      }
        .tabItem {
          Label("Approvals", systemImage: "checkmark.seal")
        }
        .tag(3)

      DeferredTabView(isActive: selectedTab == 4) {
        SettingsView(model: model)
      }
        .tabItem {
          Label("Settings", systemImage: "gear")
        }
        .tag(4)
    }
    .onChange(of: model.pendingAlertID) { _, alertID in
      if alertID != nil {
        selectedTab = 2
      }
    }
    .onChange(of: model.pendingApprovalID) { _, approvalID in
      if approvalID != nil {
        selectedTab = 3
      }
    }
  }
}

struct DeferredTabView<Content: View>: View {
  let isActive: Bool
  @ViewBuilder let content: () -> Content

  var body: some View {
    Group {
      if isActive {
        content()
      } else {
        Color.clear
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
  @State private var notifications: [GatewayNotificationSummary] = []
  @State private var isLoading = false
  @State private var errorMessage: String?

  var body: some View {
    NavigationStack {
      Group {
        if isLoading && notifications.isEmpty {
          ProgressView("Loading inbox…")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, notifications.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle)
              .foregroundStyle(.red)
            Text(errorMessage)
              .multilineTextAlignment(.center)
              .foregroundStyle(.secondary)
            Button("Retry") {
              Task { await loadNotifications() }
            }
          }
          .padding()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if notifications.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "bell.slash")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
            Text("No notifications")
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List(notifications) { notification in
            VStack(alignment: .leading, spacing: 8) {
              HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                  Text(notification.title)
                    .font(.headline)
                  Text(notification.kind.replacingOccurrences(of: "_", with: " "))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
                Spacer()
                if !notification.isRead {
                  Circle()
                    .fill(.blue)
                    .frame(width: 10, height: 10)
                }
              }

              if let body = notification.body, !body.isEmpty {
                Text(body)
                  .font(.subheadline)
                  .foregroundStyle(.primary)
              }

              HStack {
                Text(notification.createdAt.alertFormattedDate())
                  .font(.caption)
                  .foregroundStyle(.secondary)
                Spacer()
                if let threadID = notification.threadID, !threadID.isEmpty {
                  Text(threadID)
                    .font(.caption2.monospaced())
                    .foregroundStyle(.secondary)
                }
              }

              if model.ttsEnabled, let speechText = notificationSpeechText(notification) {
                HStack {
                  Spacer()
                  Button {
                    Task { await model.speak(text: speechText) }
                  } label: {
                    Label("Read aloud", systemImage: "speaker.wave.2")
                      .font(.caption)
                  }
                  .buttonStyle(.borderless)
                }
              }
            }
            .padding(.vertical, 4)
            .swipeActions(edge: .trailing, allowsFullSwipe: false) {
              Button(role: .destructive) {
                Task { await deleteNotification(notification.id) }
              } label: {
                Label("Delete", systemImage: "trash")
              }

              if !notification.isRead {
                Button {
                  Task { await markNotificationRead(notification.id) }
                } label: {
                  Label("Read", systemImage: "checkmark")
                }
                .tint(.blue)
              }
            }
            .swipeActions(edge: .leading, allowsFullSwipe: false) {
              if let speechText = notificationSpeechText(notification) {
                Button {
                  Task { await model.speak(text: speechText) }
                } label: {
                  Label("Speak", systemImage: "speaker.wave.2")
                }
                .tint(.indigo)
              }
            }
          }
          .refreshable {
            await loadNotifications()
          }
        }
      }
      .navigationTitle("Alerts")
    }
    .task {
      await model.loadVoices()
      await loadNotifications()
    }
  }

  private func notificationSpeechText(_ notification: GatewayNotificationSummary) -> String? {
    let title = notification.title.trimmingCharacters(in: .whitespacesAndNewlines)
    let body = notification.body?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    let text: String
    switch (title.isEmpty, body.isEmpty) {
    case (false, false):
      text = "\(title). \(body)"
    case (false, true):
      text = title
    case (true, false):
      text = body
    case (true, true):
      return nil
    }
    return text
  }

  private func loadNotifications() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoading = true
    defer { isLoading = false }

    do {
      notifications = try await model.chatClient.fetchNotifications(
        baseURL: baseURL,
        token: model.gatewayToken,
        unreadOnly: false,
        limit: 100
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func markNotificationRead(_ notificationID: String) async {
    guard let baseURL = model.gatewayBaseURL else { return }

    do {
      try await model.chatClient.markNotificationRead(
        baseURL: baseURL,
        token: model.gatewayToken,
        notificationID: notificationID
      )
      notifications = notifications.map { notification in
        guard notification.id == notificationID else { return notification }
        return GatewayNotificationSummary(
          id: notification.id,
          userID: notification.userID,
          kind: notification.kind,
          title: notification.title,
          body: notification.body,
          threadID: notification.threadID,
          sourceRunID: notification.sourceRunID,
          payload: notification.payload,
          readAt: ISO8601DateFormatter().string(from: Date()),
          dismissedAt: notification.dismissedAt,
          createdAt: notification.createdAt
        )
      }
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func deleteNotification(_ notificationID: String) async {
    guard let baseURL = model.gatewayBaseURL else { return }

    do {
      try await model.chatClient.deleteNotification(
        baseURL: baseURL,
        token: model.gatewayToken,
        notificationID: notificationID
      )
      notifications.removeAll { $0.id == notificationID }
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
    .gatewayInlineNavigationTitle()
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

// MARK: - Approval Views

/// Colour-coded risk badge for an action approval.
struct RiskLevelBadge: View {
  let riskLevel: GatewayApprovalRiskLevel

  var label: String {
    switch riskLevel {
    case .critical: return "CRITICAL"
    case .high: return "HIGH"
    case .medium: return "MEDIUM"
    case .low: return "LOW"
    }
  }

  var color: Color {
    switch riskLevel {
    case .critical: return .red
    case .high: return .orange
    case .medium: return .yellow
    case .low: return .blue
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

/// A single row in the approval inbox list.
struct ApprovalRowView: View {
  let approval: GatewayActionApproval

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      HStack(spacing: 6) {
        RiskLevelBadge(riskLevel: approval.riskLevelValue)
        Text(approval.title)
          .font(.headline)
          .lineLimit(1)
        Spacer()
      }
      HStack {
        Text(approval.actionType)
          .font(.caption)
          .foregroundStyle(.secondary)
        if let node = approval.targetNode {
          Text("·")
            .font(.caption)
            .foregroundStyle(.secondary)
          Text(node)
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        Spacer()
        Text(approval.createdAt.alertFormattedDate())
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
    }
    .padding(.vertical, 2)
  }
}

/// The pending-approvals inbox list view.
struct ApprovalInboxView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var approvals: [GatewayActionApproval] = []
  @State private var isLoading = false
  @State private var errorMessage: String?
  @State private var navigationPath = NavigationPath()

  var body: some View {
    NavigationStack(path: $navigationPath) {
      Group {
        if isLoading && approvals.isEmpty {
          ProgressView("Loading approvals…")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, approvals.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle)
              .foregroundStyle(.red)
            Text(errorMessage)
              .multilineTextAlignment(.center)
              .foregroundStyle(.secondary)
            Button("Retry") {
              Task { await loadApprovals() }
            }
          }
          .padding()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if approvals.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "checkmark.seal")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
            Text("No pending approvals")
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List(approvals) { approval in
            NavigationLink(value: approval.id) {
              ApprovalRowView(approval: approval)
            }
          }
          .refreshable {
            await loadApprovals()
          }
        }
      }
      .navigationTitle("Approvals")
      .navigationDestination(for: String.self) { approvalID in
        ApprovalCardView(model: model, approvalID: approvalID) {
          approvals.removeAll { $0.id == approvalID }
        }
      }
    }
    .task {
      await loadApprovals()
    }
    .onChange(of: model.pendingApprovalID) { _, approvalID in
      if let approvalID {
        navigationPath.append(approvalID)
        model.pendingApprovalID = nil
      }
    }
  }

  private func loadApprovals() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoading = true
    defer { isLoading = false }

    do {
      approvals = try await model.chatClient.fetchPendingApprovals(
        baseURL: baseURL,
        token: model.gatewayToken
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}

/// Detail card for a single action approval, with approve, deny, and
/// ask-for-more-details actions.
struct ApprovalCardView: View {
  @ObservedObject var model: GatewayAppViewModel
  let approvalID: String
  /// Called when the approval is decided so the parent list can remove the row.
  var onDecided: (() -> Void)?

  @State private var approval: GatewayActionApproval?
  @State private var isLoading = false
  @State private var isActioning = false
  @State private var errorMessage: String?
  @State private var showAskMoreDetails = false
  @State private var askMoreDetailsText: String = ""

  var body: some View {
    Group {
      if isLoading && approval == nil {
        ProgressView("Loading…")
          .frame(maxWidth: .infinity, maxHeight: .infinity)
      } else if let approval {
        ScrollView {
          VStack(alignment: .leading, spacing: 16) {
            // Header: risk badge + status
            HStack(spacing: 8) {
              RiskLevelBadge(riskLevel: approval.riskLevelValue)
              Text(approval.statusValue.displayLabel)
                .font(.caption)
                .foregroundStyle(.secondary)
              Spacer()
            }

            Text(approval.title)
              .font(.title2.weight(.semibold))

            Divider()

            // Action metadata
            Group {
              LabeledRow(label: "Action Type", value: approval.actionType)
              if let node = approval.targetNode {
                LabeledRow(label: "Target Node", value: node)
              }
              if let service = approval.targetService {
                LabeledRow(label: "Target Service", value: service)
              }
              if let agent = approval.proposedByAgentId {
                LabeledRow(label: "Proposed By", value: agent)
              }
              LabeledRow(label: "Created", value: approval.createdAt.alertFormattedDate())
              if let expires = approval.expiresAt {
                LabeledRow(label: "Expires", value: expires.alertFormattedDate())
              }
              if let decidedAt = approval.decidedAt {
                LabeledRow(label: "Decided", value: decidedAt.alertFormattedDate())
              }
              if let decidedBy = approval.decidedBy {
                LabeledRow(label: "Decided By", value: decidedBy)
              }
            }

            // Rationale / description
            if let description = approval.description, !description.isEmpty {
              Divider()
              Text("Rationale")
                .font(.headline)
              Text(description)
                .foregroundStyle(.primary)
            }

            // Raw metadata
            if let meta = approval.metadataJson, !meta.isEmpty {
              Divider()
              Text("Audit Metadata")
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

            // Action buttons (only for pending approvals)
            if approval.statusValue == .pending {
              Divider()
              VStack(spacing: 10) {
                HStack(spacing: 12) {
                  Button {
                    Task { await approve() }
                  } label: {
                    Label("Approve", systemImage: "checkmark.circle.fill")
                      .frame(maxWidth: .infinity)
                  }
                  .buttonStyle(.borderedProminent)
                  .tint(.green)
                  .disabled(isActioning)

                  Button {
                    Task { await deny() }
                  } label: {
                    Label("Deny", systemImage: "xmark.circle.fill")
                      .frame(maxWidth: .infinity)
                  }
                  .buttonStyle(.borderedProminent)
                  .tint(.red)
                  .disabled(isActioning)
                }

                Button {
                  showAskMoreDetails = true
                } label: {
                  Label("Ask for More Details", systemImage: "questionmark.circle")
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
            Task { await loadApproval() }
          }
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }
    .navigationTitle("Action Approval")
    .gatewayInlineNavigationTitle()
    .task {
      await loadApproval()
    }
    .alert("Ask for More Details", isPresented: $showAskMoreDetails) {
      TextField("Your question…", text: $askMoreDetailsText)
      Button("Send") {
        // Placeholder: in a full implementation this would send a follow-up
        // message to the proposing agent's thread.
        askMoreDetailsText = ""
      }
      Button("Cancel", role: .cancel) {
        askMoreDetailsText = ""
      }
    } message: {
      Text("Describe what additional information you need before deciding.")
    }
  }

  private func loadApproval() async {
    guard let baseURL = model.gatewayBaseURL else {
      errorMessage = GatewayChatError.missingConfiguration.localizedDescription
      return
    }

    isLoading = true
    defer { isLoading = false }

    do {
      approval = try await model.chatClient.fetchApproval(
        baseURL: baseURL,
        token: model.gatewayToken,
        approvalID: approvalID
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func approve() async {
    guard let baseURL = model.gatewayBaseURL else { return }

    isActioning = true
    defer { isActioning = false }

    do {
      approval = try await model.chatClient.approveAction(
        baseURL: baseURL,
        token: model.gatewayToken,
        approvalID: approvalID
      )
      errorMessage = nil
      onDecided?()
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func deny() async {
    guard let baseURL = model.gatewayBaseURL else { return }

    isActioning = true
    defer { isActioning = false }

    do {
      approval = try await model.chatClient.denyAction(
        baseURL: baseURL,
        token: model.gatewayToken,
        approvalID: approvalID
      )
      errorMessage = nil
      onDecided?()
    } catch {
      errorMessage = error.localizedDescription
    }
  }
}

private extension GatewayApprovalStatus {
  var displayLabel: String {
    switch self {
    case .pending: return "Pending"
    case .approved: return "Approved"
    case .denied: return "Denied"
    case .expired: return "Expired"
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
  @State private var importStatusMessage: String?
  @State private var streamingTask: Task<Void, Never>?
  @State private var didRunInitialLoad = false
  @State private var showingPlanImporter = false

  // Thread browsing (cross-device chat sync) state.
  @State private var threads: [GatewayThreadSummary] = []
  @State private var isLoadingThreads = false
  @State private var isLoadingThreadMessages = false
  @State private var showingThreadList = false
  @State private var threadErrorMessage: String?
  @State private var resumableThreadID: String?

  /// Per-thread auto-speak preference, keyed by thread id (empty string for
  /// the "new chat" pre-thread state).  Persisted in UserDefaults so the
  /// toggle sticks across app launches.
  @State private var autoSpeakByThread: [String: Bool] = [:]

  private static let autoSpeakDefaultsKey = "gateway.tts.autoSpeakByThread"
  private static let activeThreadIDDefaultsKey = "gateway.activeThreadID"
  private static let cachedAgentsDefaultsKey = "gateway.cachedAgents"
  private static let speechInputLaunchArgument = "-GatewayAppEnableSpeechInput"
  #if canImport(UniformTypeIdentifiers)
  private static let planImportTypes: [UTType] = [
    .plainText,
    .text,
    UTType(filenameExtension: "md") ?? .plainText,
    UTType(filenameExtension: "markdown") ?? .plainText,
    UTType(filenameExtension: "yaml") ?? .plainText,
    UTType(filenameExtension: "yml") ?? .plainText,
  ]
  #endif
  private var autoSpeakKey: String { threadID ?? "" }
  private var autoSpeakEnabled: Bool { autoSpeakByThread[autoSpeakKey] ?? false }
  private var speechInputEnabled: Bool {
    ProcessInfo.processInfo.arguments.contains(Self.speechInputLaunchArgument)
  }

  init(model: GatewayAppViewModel) {
    self.model = model
    _agents = State(initialValue: Self.loadCachedAgents())
  }

  /// Binding for the auto-speak Toggle: reads/writes the per-thread entry in
  /// `autoSpeakByThread` and persists the whole dict so the preference
  /// survives relaunches and follows the user across threads.
  private var autoSpeakBinding: Binding<Bool> {
    Binding(
      get: { autoSpeakEnabled },
      set: { newValue in
        autoSpeakByThread[autoSpeakKey] = newValue
        UserDefaults.standard.set(autoSpeakByThread, forKey: Self.autoSpeakDefaultsKey)
        if !newValue {
          model.stopSpeaking()
        }
      }
    )
  }

  @FocusState private var isPromptFocused: Bool
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

  private var resolvedAgentVoiceID: String? {
    guard let resolvedAgentID,
          let voiceID = agents.first(where: { $0.id == resolvedAgentID })?.ttsVoiceId,
          !voiceID.isEmpty
    else {
      return model.selectedVoiceID
    }
    return voiceID
  }

  var body: some View {
    NavigationStack {
      VStack(spacing: 12) {
        if isLoadingAgents {
          ProgressView("Loading agents…")
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if agents.isEmpty, let agentsError = errorMessage, !isSending {
          HStack(alignment: .top, spacing: 8) {
            Image(systemName: "wifi.slash")
              .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 4) {
              Text(agentsError)
                .font(.footnote)
                .foregroundStyle(.secondary)
              Button("Retry") {
                errorMessage = nil
                Task { await loadAgents() }
              }
              .font(.footnote)
            }
          }
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
        } else if let resumableThreadID {
          HStack(spacing: 8) {
            Image(systemName: "clock.arrow.circlepath")
              .foregroundStyle(.secondary)
            Button("Resume previous chat") {
              Task {
                await switchToThread(resumableThreadID)
                self.resumableThreadID = nil
              }
            }
            .font(.footnote)
            Spacer()
          }
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
                ChatMessageBubble(
                  message: message,
                  onToggleReasoning: {
                    toggleReasoning(for: message.id)
                  },
                  onSpeak: model.ttsEnabled ? { text in
                    let voiceID = resolvedAgentVoiceID
                    Task { await model.speak(text: text, voice: voiceID) }
                  } : nil
                )
              }
            }
          }
        }
        .scrollDismissesKeyboard(.interactively)
        .contentShape(Rectangle())
        .onTapGesture {
          isPromptFocused = false
        }

        if let errorMessage {
          Text(errorMessage)
            .font(.footnote)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        if let importStatusMessage {
          Text(importStatusMessage)
            .font(.footnote)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
        }

        HStack(alignment: .bottom, spacing: 8) {
          TextField("Type a prompt…", text: $prompt, axis: .vertical)
            .lineLimit(1...4)
            .gatewayTextInputAutocapitalizationSentences()
            .autocorrectionDisabled(false)
            .focused($isPromptFocused)
            .disabled(isSending)

          #if canImport(Speech)
          if speechInputEnabled {
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
          }
          #endif

          if isSending {
            Button("Cancel") {
              streamingTask?.cancel()
            }
          } else {
            Button {
              submitPrompt()
            } label: {
              Text("Send")
            }
            .disabled(
              prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
              (resolvedAgentID == nil && !isLoadingAgents)
            )
          }
        }
      }
      .padding()
      .contentShape(Rectangle())
      .onTapGesture {
        isPromptFocused = false
      }
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
        #if os(macOS)
        ToolbarItem(placement: .automatic) {
          Button {
            showingThreadList = true
            Task { await loadThreads() }
          } label: {
            Label("Threads", systemImage: "list.bullet.rectangle")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .automatic) {
          Button {
            startNewChat()
          } label: {
            Label("New Chat", systemImage: "square.and.pencil")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .automatic) {
          Button {
            showingPlanImporter = true
          } label: {
            Label("Import Plan", systemImage: "doc.badge.plus")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .automatic) {
          Button("Reload Agents") {
            Task {
              await loadAgents()
            }
          }
          .disabled(isLoadingAgents || isSending)
        }
        if model.ttsEnabled {
          ToolbarItem(placement: .automatic) {
            Toggle(isOn: autoSpeakBinding) {
              Label("Auto-speak", systemImage: "speaker.wave.2")
            }
            .toggleStyle(.switch)
          }
          #if canImport(AVFoundation)
          if model.ttsController.isSpeaking {
            ToolbarItem(placement: .automatic) {
              Button {
                model.stopSpeaking()
              } label: {
                Label("Stop", systemImage: "stop.circle")
              }
            }
          }
          #endif
        }
        #else
        ToolbarItem(placement: .topBarLeading) {
          Button {
            showingThreadList = true
            Task { await loadThreads() }
          } label: {
            Label("Threads", systemImage: "list.bullet.rectangle")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            startNewChat()
          } label: {
            Label("New Chat", systemImage: "square.and.pencil")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            showingPlanImporter = true
          } label: {
            Label("Import Plan", systemImage: "doc.badge.plus")
          }
          .disabled(isSending)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("Reload Agents") {
            Task {
              await loadAgents()
            }
          }
          .disabled(isLoadingAgents || isSending)
        }
        if model.ttsEnabled {
          ToolbarItem(placement: .topBarTrailing) {
            Toggle(isOn: autoSpeakBinding) {
              Label("Auto-speak", systemImage: "speaker.wave.2")
            }
            .toggleStyle(.button)
          }
          #if canImport(AVFoundation)
          if model.ttsController.isSpeaking {
            ToolbarItem(placement: .topBarTrailing) {
              Button {
                model.stopSpeaking()
              } label: {
                Label("Stop", systemImage: "stop.circle")
              }
            }
          }
          #endif
        }
        #endif
      }
      .sheet(isPresented: $showingThreadList) {
        ThreadListSheet(
          threads: threads,
          activeThreadID: threadID,
          isLoading: isLoadingThreads,
          errorMessage: threadErrorMessage,
          onSelect: { selected in
            showingThreadList = false
            Task { await switchToThread(selected.id) }
          },
          onDelete: { toDelete in
            Task { await deleteThread(toDelete.id) }
          },
          onRefresh: {
            Task { await loadThreads() }
          },
          onDismiss: {
            showingThreadList = false
          }
        )
      }
      #if canImport(UniformTypeIdentifiers)
      .fileImporter(
        isPresented: $showingPlanImporter,
        allowedContentTypes: Self.planImportTypes,
        allowsMultipleSelection: false
      ) { result in
        handlePlanImportSelection(result)
      }
      #endif
    }
    .task {
      guard !didRunInitialLoad else { return }
      didRunInitialLoad = true

      // Remember the last active thread, but do not auto-load it on launch.
      // Large synced histories make the app feel hung before the user can act.
      if threadID == nil,
         let stored = UserDefaults.standard.string(forKey: Self.activeThreadIDDefaultsKey),
         !stored.isEmpty {
        resumableThreadID = stored
      }
      // Restore per-thread auto-speak preferences synchronously so the
      // toolbar Toggle reflects saved state before any network calls start.
      if let stored = UserDefaults.standard.dictionary(forKey: Self.autoSpeakDefaultsKey) as? [String: Bool] {
        autoSpeakByThread = stored
      }

      if agents.isEmpty {
        agents = Self.loadCachedAgents()
      }
      Task {
        await loadAgents()
      }
      Task {
        await model.loadVoices()
      }
    }
    .onChange(of: threadID) { _, newValue in
      if let newValue, !newValue.isEmpty {
        UserDefaults.standard.set(newValue, forKey: Self.activeThreadIDDefaultsKey)
      } else {
        UserDefaults.standard.removeObject(forKey: Self.activeThreadIDDefaultsKey)
      }
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
      Self.saveCachedAgents(fetched)
      if let selectedAgentID, !agents.contains(where: { $0.id == selectedAgentID }) {
        self.selectedAgentID = nil
      }
      errorMessage = fetched.isEmpty
        ? "No agents are available from this gateway. Verify the token or sync the gateway agent registry."
        : nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private static func loadCachedAgents() -> [GatewayAgentSummary] {
    guard
      let data = UserDefaults.standard.data(forKey: cachedAgentsDefaultsKey),
      let decoded = try? JSONDecoder().decode([GatewayAgentSummary].self, from: data)
    else {
      return []
    }
    return decoded
  }

  private static func saveCachedAgents(_ agents: [GatewayAgentSummary]) {
    guard let data = try? JSONEncoder().encode(agents) else { return }
    UserDefaults.standard.set(data, forKey: cachedAgentsDefaultsKey)
  }

  private func shouldRefreshPlansAfterSend(_ prompt: String) -> Bool {
    let normalized = prompt.lowercased()
    return normalized.contains("plan_ingest_text") || normalized.contains("<plan_document>")
  }

  private func submitPrompt() {
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

    if threadID == nil {
      threadID = UUID().uuidString
    }

    let userMessage = ChatMessageRow(role: .user, content: trimmedPrompt)
    let conversation = (messages + [userMessage]).map { message in
      let role: String
      switch message.role {
      case .user:
        role = "user"
      case .assistant:
        role = "assistant"
      }
      return GatewayConversationMessage(role: role, content: message.content)
    }

    let placeholderID = UUID()

    streamingTask?.cancel()
    messages.append(userMessage)
    prompt = ""
    isPromptFocused = false
    dismissKeyboard()
    isSending = true
    errorMessage = nil
    importStatusMessage = nil
    messages.append(ChatMessageRow(role: .assistant, content: "Sending…", id: placeholderID, isReasoningExpanded: true))

    streamingTask = Task {
      await sendPrompt(
        trimmedPrompt: trimmedPrompt,
        baseURL: baseURL,
        resolvedAgentID: resolvedAgentID,
        conversation: conversation,
        placeholderID: placeholderID
      )
    }
  }

  private func dismissKeyboard() {
    #if canImport(UIKit)
    UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
    #endif
  }

  private func sendPrompt(
    trimmedPrompt: String,
    baseURL: URL,
    resolvedAgentID: String,
    conversation: [GatewayConversationMessage],
    placeholderID: UUID
  ) async {
    let progressTask = Task { @MainActor in
      let statuses = ["Waiting for the gateway…", "Model is working…", "Still working…"]
      for status in statuses {
        do {
          try await Task.sleep(nanoseconds: 4_000_000_000)
        } catch {
          return
        }
        guard !Task.isCancelled else { return }
        if let idx = messages.firstIndex(where: { $0.id == placeholderID }),
           isTransientSendStatus(messages[idx].content) {
          messages[idx].content = status
        }
      }
    }
    defer {
      progressTask.cancel()
      isSending = false
      streamingTask = nil
    }

    var lastStreamRender = Date.distantPast
    func renderAssistantReply(_ content: String, force: Bool = false) -> Bool {
      let now = Date()
      guard force || now.timeIntervalSince(lastStreamRender) >= 0.12 else { return false }
      if let idx = messages.firstIndex(where: { $0.id == placeholderID }) {
        messages[idx].content = content
      }
      lastStreamRender = now
      return true
    }

    var lastReasoningRender = Date.distantPast
    func renderReasoning(_ content: String, force: Bool = false) -> Bool {
      let now = Date()
      guard force || now.timeIntervalSince(lastReasoningRender) >= 0.20 else { return false }
      if let idx = messages.firstIndex(where: { $0.id == placeholderID }) {
        messages[idx].reasoning = content
        messages[idx].isReasoningExpanded = true
      }
      lastReasoningRender = now
      return true
    }

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
      var accumulatedReasoning = ""
      for try await event in stream {
        switch event {
        case let .token(tok):
          accumulated += tok
          if renderAssistantReply(accumulated) {
            await Task.yield()
          }
        case let .reasoning(text):
          accumulatedReasoning += text
          if renderReasoning(accumulatedReasoning) {
            await Task.yield()
          }
        case let .status(message):
          if accumulated.isEmpty {
            _ = renderAssistantReply(message, force: true)
          }
        case let .done(_, returnedThreadID, completionTokensPerSecond):
          if let tid = returnedThreadID {
            threadID = tid
          }
          if let completionTokensPerSecond,
             let idx = messages.firstIndex(where: { $0.id == placeholderID }) {
            messages[idx].completionTokensPerSecond = completionTokensPerSecond
          }
          _ = renderReasoning(accumulatedReasoning, force: true)
          collapseReasoning(for: placeholderID)
        case let .error(msg):
          errorMessage = msg
        default:
          break
        }
      }

      _ = renderAssistantReply(accumulated, force: true)
      _ = renderReasoning(accumulatedReasoning, force: true)
      collapseReasoning(for: placeholderID)

      // Remove the placeholder if nothing was accumulated (e.g. empty response).
      if accumulated.isEmpty {
        messages.removeAll { $0.id == placeholderID }
      }
    } catch is CancellationError {
      // User cancelled: retain partial content, remove empty placeholder.
      if let idx = messages.firstIndex(where: { $0.id == placeholderID }),
         messages[idx].content.isEmpty || isTransientSendStatus(messages[idx].content) {
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

    // Refresh the thread list in the background so the sidebar shows the
    // updated last-snippet and new thread (if this was the first send).
    Task { await loadThreads() }
    if shouldRefreshPlansAfterSend(trimmedPrompt) {
      NotificationCenter.default.post(name: .gatewayPlansPossiblyChanged, object: nil)
    }

    // Auto-speak the assistant reply if enabled for the current thread.
    if autoSpeakEnabled, model.ttsEnabled,
       let last = messages.last, last.role == .assistant, !last.content.isEmpty {
      let spoken = last.content
      let voiceID = resolvedAgentVoiceID
      Task { await model.speak(text: spoken, voice: voiceID) }
    }
  }

  private func toggleReasoning(for messageID: UUID) {
    guard let idx = messages.firstIndex(where: { $0.id == messageID }) else { return }
    messages[idx].isReasoningExpanded.toggle()
  }

  private func collapseReasoning(for messageID: UUID) {
    guard let idx = messages.firstIndex(where: { $0.id == messageID }) else { return }
    messages[idx].isReasoningExpanded = false
  }

  private func isTransientSendStatus(_ content: String) -> Bool {
    switch content.trimmingCharacters(in: .whitespacesAndNewlines) {
    case "Sending…", "Thinking…", "Waiting for the gateway…", "Model is working…", "Still working…":
      return true
    default:
      return false
    }
  }

  // MARK: - Thread browsing helpers

  private func startNewChat() {
    streamingTask?.cancel()
    threadID = nil
    messages = []
    errorMessage = nil
    prompt = ""
  }

  private func loadThreads() async {
    guard let baseURL = model.gatewayBaseURL else { return }
    isLoadingThreads = true
    defer { isLoadingThreads = false }
    do {
      threads = try await model.chatClient.fetchThreads(
        baseURL: baseURL,
        token: model.gatewayToken,
        limit: 100
      )
      threadErrorMessage = nil
    } catch {
      threadErrorMessage = error.localizedDescription
    }
  }

  #if canImport(UniformTypeIdentifiers)
  private func handlePlanImportSelection(_ result: Result<[URL], Error>) {
    switch result {
    case let .success(urls):
      guard let first = urls.first else {
        errorMessage = "No document was selected."
        importStatusMessage = nil
        return
      }
      handlePlanImport(first)
    case let .failure(error):
      errorMessage = "Plan import canceled or failed: \(error.localizedDescription)"
      importStatusMessage = nil
    }
  }

  private func handlePlanImport(_ url: URL) {
    do {
      let importedText = try readImportedText(from: url)
      let importedName = url.deletingPathExtension().lastPathComponent
      if Self.looksLikeStructuredPlanDocument(importedText) {
        Task {
          do {
            guard let baseURL = model.gatewayBaseURL else {
              errorMessage = GatewayChatError.missingConfiguration.localizedDescription
              return
            }
            _ = try await model.chatClient.importPlanDocument(
              baseURL: baseURL,
              token: model.gatewayToken,
              title: importedName,
              text: importedText,
              source: importedName
            )
            NotificationCenter.default.post(name: .gatewayPlansPossiblyChanged, object: nil)
            importStatusMessage = "Imported \(url.lastPathComponent) into Plans."
            errorMessage = nil
          } catch {
            errorMessage = "Unable to import structured plan: \(error.localizedDescription)"
            importStatusMessage = nil
          }
        }
      } else {
        prompt = Self.makePlanImportPrompt(documentName: importedName, text: importedText)
        importStatusMessage = "Imported \(url.lastPathComponent). Review the prompt, then send it to ingest the plan."
        errorMessage = nil
        isPromptFocused = true
      }
    } catch {
      errorMessage = "Unable to import plan document: \(error.localizedDescription)"
      importStatusMessage = nil
    }
  }

  private func readImportedText(from url: URL) throws -> String {
    let startedAccess = url.startAccessingSecurityScopedResource()
    defer {
      if startedAccess {
        url.stopAccessingSecurityScopedResource()
      }
    }
    let text = try String(contentsOf: url, encoding: .utf8)
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty {
      throw GatewayChatError.invalidResponse
    }
    return trimmed
  }

  private static func makePlanImportPrompt(documentName: String, text: String) -> String {
    let safeName = documentName.trimmingCharacters(in: .whitespacesAndNewlines)
    let header: String
    if safeName.isEmpty {
      header = "Please ingest the following plan document into my durable plans using plan_ingest_text. Infer useful metadata like category, tags, data sources, review cadence, and metrics when the text supports it. Then briefly summarize what you stored and any important gaps."
    } else {
      header = "Please ingest the following plan document into my durable plans using plan_ingest_text. Use \(safeName) as the source label, infer useful metadata like category, tags, data sources, review cadence, and metrics when the text supports it, then briefly summarize what you stored and any important gaps."
    }
    return "\(header)\n\n<plan_document>\n\(text)\n</plan_document>"
  }

  private static func looksLikeStructuredPlanDocument(_ text: String) -> Bool {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.hasPrefix("{") {
      return true
    }
    return trimmed.range(of: #"(?im)^title\s*:"# , options: .regularExpression) != nil
  }
  #endif

  private func switchToThread(_ id: String) async {
    guard let baseURL = model.gatewayBaseURL else { return }
    streamingTask?.cancel()
    isLoadingThreadMessages = true
    defer { isLoadingThreadMessages = false }
    do {
      let history = try await model.chatClient.fetchThread(
        baseURL: baseURL,
        token: model.gatewayToken,
        threadID: id
      )
      threadID = id
      let recentHistory = Array(history.suffix(100))
      messages = recentHistory.map { msg in
        ChatMessageRow(
          role: msg.role == "assistant" ? .assistant : .user,
          content: msg.content
        )
      }
      resumableThreadID = nil
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func deleteThread(_ id: String) async {
    guard let baseURL = model.gatewayBaseURL else { return }
    do {
      try await model.chatClient.deleteThread(
        baseURL: baseURL,
        token: model.gatewayToken,
        threadID: id
      )
      threads.removeAll { $0.id == id }
      if threadID == id {
        startNewChat()
      }
    } catch {
      threadErrorMessage = error.localizedDescription
    }
  }
}

/// Sheet listing the user's previous chat threads so they can switch between
/// them.  Mirrors the web chat-ui sidebar so threads created on either client
/// are visible on the other.
struct ThreadListSheet: View {
  let threads: [GatewayThreadSummary]
  let activeThreadID: String?
  let isLoading: Bool
  let errorMessage: String?
  let onSelect: (GatewayThreadSummary) -> Void
  let onDelete: (GatewayThreadSummary) -> Void
  let onRefresh: () -> Void
  let onDismiss: () -> Void

  var body: some View {
    NavigationStack {
      Group {
        if isLoading && threads.isEmpty {
          ProgressView("Loading threads…")
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage, threads.isEmpty {
          VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
            Text(errorMessage)
              .multilineTextAlignment(.center)
              .foregroundStyle(.secondary)
            Button("Retry", action: onRefresh)
          }
          .padding()
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if threads.isEmpty {
          VStack(spacing: 8) {
            Image(systemName: "bubble.left.and.bubble.right")
              .font(.largeTitle)
              .foregroundStyle(.secondary)
            Text("No previous chats yet.")
              .foregroundStyle(.secondary)
          }
          .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
          List {
            ForEach(threads) { thread in
              Button {
                onSelect(thread)
              } label: {
                VStack(alignment: .leading, spacing: 4) {
                  HStack {
                    Text(thread.title)
                      .font(.headline)
                      .lineLimit(1)
                    Spacer()
                    if thread.id == activeThreadID {
                      Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(.tint)
                    }
                  }
                  if let snippet = thread.lastSnippet, !snippet.isEmpty {
                    Text(snippet)
                      .font(.subheadline)
                      .foregroundStyle(.secondary)
                      .lineLimit(2)
                  }
                  Text("\(thread.messageCount) messages")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
              }
              .buttonStyle(.plain)
              .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                Button(role: .destructive) {
                  onDelete(thread)
                } label: {
                  Label("Delete", systemImage: "trash")
                }
              }
            }
          }
          .listStyle(.plain)
        }
      }
      .navigationTitle("Threads")
      #if os(iOS)
      .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar {
        #if os(macOS)
        ToolbarItem(placement: .automatic) {
          Button("Refresh", action: onRefresh).disabled(isLoading)
        }
        ToolbarItem(placement: .automatic) {
          Button("Done", action: onDismiss)
        }
        #else
        ToolbarItem(placement: .topBarLeading) {
          Button("Refresh", action: onRefresh).disabled(isLoading)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button("Done", action: onDismiss)
        }
        #endif
      }
    }
  }
}

struct ChatMessageBubble: View {
  let message: ChatMessageRow
  var onToggleReasoning: (() -> Void)? = nil
  var onSpeak: ((String) -> Void)? = nil

  private var renderedContent: String {
    guard message.role == .user else { return message.content }
    let limit = 1_200
    guard message.content.count > limit else { return message.content }
    return String(message.content.prefix(limit))
      + "\n\n…\n\nLong message collapsed for mobile rendering. The full text was sent to the gateway."
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(message.role == .user ? "You" : "Assistant")
          .font(.caption)
          .foregroundStyle(.secondary)
        Spacer()
        if message.role == .assistant {
          if let onSpeak {
            Button {
              onSpeak(message.content)
            } label: {
              Label("Speak", systemImage: "speaker.wave.2")
                .labelStyle(.iconOnly)
            }
            .font(.caption)
            .buttonStyle(.borderless)
            .disabled(message.content.isEmpty)
          }
          Button("Copy") {
            copyToClipboard(message.content)
          }
          .font(.caption)
        }
      }

      Text(renderedContent)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(message.role == .user ? Color.blue.opacity(0.15) : Color.gray.opacity(0.12))
        .clipShape(RoundedRectangle(cornerRadius: 10))

      if message.role == .assistant,
         let reasoning = message.reasoning?.trimmingCharacters(in: .whitespacesAndNewlines),
         !reasoning.isEmpty {
        VStack(alignment: .leading, spacing: 4) {
          Button {
            onToggleReasoning?()
          } label: {
            HStack(spacing: 6) {
              Image(systemName: message.isReasoningExpanded ? "chevron.down" : "chevron.right")
                .font(.caption2.weight(.semibold))
              Text("Reasoning")
                .font(.caption.weight(.semibold))
              Spacer(minLength: 0)
            }
            .foregroundStyle(.indigo)
          }
          .buttonStyle(.plain)

          if message.isReasoningExpanded {
            Text(reasoning)
              .font(.caption)
              .foregroundStyle(.secondary)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
        }
        .padding(.leading, 8)
        .overlay(alignment: .leading) {
          Rectangle()
            .fill(Color.indigo.opacity(0.45))
            .frame(width: 1)
        }
      }

      if message.role == .assistant, let completionTokensPerSecond = message.completionTokensPerSecond {
        Text(String(format: "%.1f tok/s", completionTokensPerSecond))
          .font(.caption2)
          .foregroundStyle(.secondary)
      }
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
  var completionTokensPerSecond: Double?
  var reasoning: String?
  var isReasoningExpanded: Bool

  init(role: Role, content: String, id: UUID = UUID(), completionTokensPerSecond: Double? = nil, reasoning: String? = nil, isReasoningExpanded: Bool = false) {
    self.id = id
    self.role = role
    self.content = content
    self.completionTokensPerSecond = completionTokensPerSecond
    self.reasoning = reasoning
    self.isReasoningExpanded = isReasoningExpanded
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
  private enum Field: Hashable {
    case token
  }

  @ObservedObject var model: GatewayAppViewModel
  @State private var replacementToken = ""
  @State private var isRetesting = false
  @State private var revealToken = false
  @State private var profile: GatewayUserProfile?
  @State private var isLoadingProfile = false
  @State private var isSavingProfile = false
  @State private var profileMessage: String?
  @State private var profileError: String?
  @FocusState private var focusedField: Field?

  /// Bridges the optional `selectedVoiceID` into the picker and persists
  /// changes through the view model.
  private var voiceBinding: Binding<String?> {
    Binding(
      get: { model.selectedVoiceID },
      set: { model.setSelectedVoice($0) }
    )
  }

  var body: some View {
    NavigationStack {
      Form {
        Section("Connection") {
          Text("Gateway URL: \(model.baseURL)")
          Text("Device: \(model.deviceName)")
          Text("Identity: \(model.connectionIdentity ?? "Unknown")")
          ConnectionStatusText(status: model.connectionStatus)
          Button {
            isRetesting = true
            Task {
              await model.checkConnection()
              isRetesting = false
            }
          } label: {
            HStack(spacing: 6) {
              Text("Retest Connection")
              if isRetesting {
                ProgressView()
                  .controlSize(.small)
              }
            }
          }
          .disabled(isRetesting)
        }

        Section("Notifications") {
          Picker("Push alerts", selection: $model.notificationPreference) {
            ForEach(NotificationPreferenceLevel.allCases, id: \.self) { level in
              Text(level.displayLabel).tag(level)
            }
          }
          .onChange(of: model.notificationPreference) { _, newValue in
            model.saveNotificationPreference(newValue)
          }
        }

        if model.ttsEnabled {
          Section("Voice") {
            Picker("TTS voice", selection: voiceBinding) {
              Text("Server default").tag(String?.none)
              ForEach(model.availableVoices) { voice in
                Text(voice.name ?? voice.id).tag(Optional(voice.id))
              }
            }
            Button("Refresh voices") {
              Task { await model.loadVoices() }
            }
          }
        } else {
          Section("Voice") {
            Text("TTS is currently unavailable or disabled on this gateway.")
              .foregroundStyle(.secondary)
            Button("Refresh voices") {
              Task { await model.loadVoices() }
            }
          }
        }

        if let profile {
          ForEach(profile.sections) { profileSection in
            Section(profileSection.title) {
              ForEach(profileSection.fields) { field in
                TextField(
                  field.label,
                  text: Binding(
                    get: { profileFieldValue(sectionID: profileSection.id, fieldKey: field.key) },
                    set: { updateProfileField(sectionID: profileSection.id, fieldKey: field.key, value: $0) }
                  ),
                  axis: .vertical
                )
                .lineLimit(1...3)
              }
            }
          }

          Section("Profile") {
            if let profileMessage {
              Text(profileMessage)
                .foregroundStyle(.green)
            }
            if let profileError {
              Text(profileError)
                .foregroundStyle(.red)
            }
            Button {
              Task { await saveProfile() }
            } label: {
              HStack(spacing: 6) {
                Text("Save Profile")
                if isSavingProfile {
                  ProgressView()
                    .controlSize(.small)
                }
              }
            }
            .disabled(isSavingProfile)

            Button("Refresh Profile") {
              Task { await loadProfile() }
            }
            .disabled(isLoadingProfile || isSavingProfile)
          }
        } else {
          Section("Profile") {
            if isLoadingProfile {
              HStack(spacing: 8) {
                ProgressView()
                  .controlSize(.small)
                Text("Loading profile…")
              }
            } else if let profileError {
              Text(profileError)
                .foregroundStyle(.red)
              Button("Retry") {
                Task { await loadProfile() }
              }
            } else {
              Button("Load Profile") {
                Task { await loadProfile() }
              }
            }
          }
        }

        Section("Credentials") {
          RevealableTokenField(
            title: "API Token",
            text: $replacementToken,
            isRevealed: $revealToken
          )
          .focused($focusedField, equals: .token)

          Button("Save API Token") {
            model.replaceToken(replacementToken)
            focusedField = nil
          }
        }

        Section {
          Button("Clear Local Data", role: .destructive) {
            model.clearLocalData()
          }
        }
      }
      .scrollDismissesKeyboard(.interactively)
      .navigationTitle("Settings")
      .task {
        if replacementToken.isEmpty {
          replacementToken = model.gatewayToken ?? ""
        }
        await model.loadVoices()
        await loadProfile()
      }
    }
  }

  private func loadProfile() async {
    guard let baseURL = model.gatewayBaseURL else {
      profileError = GatewayChatError.missingConfiguration.localizedDescription
      return
    }
    isLoadingProfile = true
    defer { isLoadingProfile = false }
    do {
      profile = try await model.chatClient.fetchUserProfile(baseURL: baseURL, token: model.gatewayToken)
      profileError = nil
    } catch {
      profileError = error.localizedDescription
    }
  }

  private func saveProfile() async {
    guard let baseURL = model.gatewayBaseURL, let profile else { return }
    isSavingProfile = true
    defer { isSavingProfile = false }
    do {
      self.profile = try await model.chatClient.updateUserProfile(
        baseURL: baseURL,
        token: model.gatewayToken,
        profile: profile
      )
      profileError = nil
      profileMessage = "Saved"
    } catch {
      profileError = error.localizedDescription
      profileMessage = nil
    }
  }

  private func profileFieldValue(sectionID: String, fieldKey: String) -> String {
    guard let profile,
          let section = profile.sections.first(where: { $0.id == sectionID }),
          let field = section.fields.first(where: { $0.key == fieldKey })
    else { return "" }
    return field.value
  }

  private func updateProfileField(sectionID: String, fieldKey: String, value: String) {
    guard var profile else { return }
    for sectionIndex in profile.sections.indices where profile.sections[sectionIndex].id == sectionID {
      for fieldIndex in profile.sections[sectionIndex].fields.indices where profile.sections[sectionIndex].fields[fieldIndex].key == fieldKey {
        profile.sections[sectionIndex].fields[fieldIndex].value = value
      }
    }
    self.profile = profile
    profileMessage = nil
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

struct RevealableTokenField: View {
  let title: String
  @Binding var text: String
  @Binding var isRevealed: Bool

  var body: some View {
    HStack(spacing: 8) {
      Group {
        if isRevealed {
          TextField(title, text: $text)
        } else {
          SecureField(title, text: $text)
        }
      }
      .gatewayTextInputAutocapitalizationNever()
      .autocorrectionDisabled()

      Button {
        isRevealed.toggle()
      } label: {
        Image(systemName: isRevealed ? "eye.slash" : "eye")
          .foregroundStyle(.secondary)
      }
      .buttonStyle(.plain)
      .accessibilityLabel(isRevealed ? "Hide token" : "Show token")
    }
  }
}

private extension View {
  @ViewBuilder
  func gatewayTextInputAutocapitalizationNever() -> some View {
    #if os(iOS)
    textInputAutocapitalization(.never)
    #else
    self
    #endif
  }

  @ViewBuilder
  func gatewayTextInputAutocapitalizationSentences() -> some View {
    #if os(iOS)
    textInputAutocapitalization(.sentences)
    #else
    self
    #endif
  }

  @ViewBuilder
  func gatewayURLKeyboard() -> some View {
    #if os(iOS)
    keyboardType(.URL)
    #else
    self
    #endif
  }

  @ViewBuilder
  func gatewayInlineNavigationTitle() -> some View {
    #if os(iOS)
    navigationBarTitleDisplayMode(.inline)
    #else
    self
    #endif
  }
}
#endif
