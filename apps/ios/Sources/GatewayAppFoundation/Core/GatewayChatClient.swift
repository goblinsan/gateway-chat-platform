import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct GatewayAgentSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String
  public let icon: String?
  public let enabled: Bool?
  public let ttsVoiceId: String?

  public init(id: String, name: String, icon: String?, enabled: Bool?, ttsVoiceId: String? = nil) {
    self.id = id
    self.name = name
    self.icon = icon
    self.enabled = enabled
    self.ttsVoiceId = ttsVoiceId
  }
}

// MARK: - Thread (cross-device chat sync) models

/// Compact summary of a server-persisted chat thread, used to render the
/// in-app thread list / sidebar that lets the user switch between previous
/// conversations.  Backed by agent-service sessions/runs and proxied through
/// chat-api's `/api/threads` route.
public struct GatewayThreadSummary: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let createdAt: String
  public let updatedAt: String
  public let messageCount: Int
  public let lastSnippet: String?
  public let lastAgentId: String?

  enum CodingKeys: String, CodingKey {
    case id
    case title
    case createdAt = "created_at"
    case updatedAt = "updated_at"
    case messageCount = "message_count"
    case lastSnippet = "last_snippet"
    case lastAgentId = "last_agent_id"
  }

  public init(
    id: String,
    title: String,
    createdAt: String,
    updatedAt: String,
    messageCount: Int,
    lastSnippet: String?,
    lastAgentId: String?
  ) {
    self.id = id
    self.title = title
    self.createdAt = createdAt
    self.updatedAt = updatedAt
    self.messageCount = messageCount
    self.lastSnippet = lastSnippet
    self.lastAgentId = lastAgentId
  }
}

/// A single user/assistant message reconstructed from a run row when loading
/// a thread back into the app's chat view.
public struct GatewayThreadMessage: Decodable, Equatable, Sendable {
  public let role: String
  public let content: String
  public let createdAt: String
  public let runId: String?
  public let agentId: String?

  enum CodingKeys: String, CodingKey {
    case role
    case content
    case createdAt = "created_at"
    case runId = "run_id"
    case agentId = "agent_id"
  }

  public init(
    role: String,
    content: String,
    createdAt: String,
    runId: String?,
    agentId: String?
  ) {
    self.role = role
    self.content = content
    self.createdAt = createdAt
    self.runId = runId
    self.agentId = agentId
  }
}

// MARK: - TTS models

/// A TTS voice option returned by the gateway, used to populate the voice
/// picker in Settings.
public struct GatewayVoice: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let name: String?

  public init(id: String, name: String?) {
    self.id = id
    self.name = name
  }
}

public struct GatewayVoicesResult: Decodable, Equatable, Sendable {
  public let enabled: Bool
  public let voices: [GatewayVoice]

  public init(enabled: Bool, voices: [GatewayVoice]) {
    self.enabled = enabled
    self.voices = voices
  }
}

/// Raw audio response from the synthesize endpoint, including the server's
/// reported content type so the caller can hand it to AVAudioPlayer.
public struct GatewaySynthesizedSpeech: Equatable, Sendable {
  public let audio: Data
  public let contentType: String
}

// MARK: - Alert models

/// Severity level for a gateway alert.
public enum GatewayAlertSeverity: String, Decodable, Equatable, CaseIterable, Sendable {
  case critical
  case high
  case medium
  case low
  case info
}

/// Status of a gateway alert.
public enum GatewayAlertStatus: String, Decodable, Equatable, CaseIterable, Sendable {
  case open
  case acknowledged
  case resolved
}

/// Summary fields returned by the alert list endpoint.
public struct GatewayAlertSummary: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let severity: String
  public let source: String
  public let sourceNode: String?
  public let sourceService: String?
  public let status: String
  public let createdAt: String
  public let acknowledgedAt: String?
  public let resolvedAt: String?

  public var severityLevel: GatewayAlertSeverity {
    GatewayAlertSeverity(rawValue: severity) ?? .info
  }

  public var statusLevel: GatewayAlertStatus {
    GatewayAlertStatus(rawValue: status) ?? .open
  }
}

/// Full alert detail returned by the single-alert endpoint.
public struct GatewayAlertDetail: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public let body: String?
  public let severity: String
  public let source: String
  public let sourceNode: String?
  public let sourceService: String?
  public let status: String
  public let relatedThreadId: String?
  public let relatedActionId: String?
  public let metadataJson: String?
  public let createdAt: String
  public let acknowledgedAt: String?
  public let resolvedAt: String?

  public var severityLevel: GatewayAlertSeverity {
    GatewayAlertSeverity(rawValue: severity) ?? .info
  }

  public var statusLevel: GatewayAlertStatus {
    GatewayAlertStatus(rawValue: status) ?? .open
  }

  public init(
    id: String,
    title: String,
    body: String?,
    severity: String,
    source: String,
    sourceNode: String?,
    sourceService: String?,
    status: String,
    relatedThreadId: String?,
    relatedActionId: String?,
    metadataJson: String?,
    createdAt: String,
    acknowledgedAt: String?,
    resolvedAt: String?
  ) {
    self.id = id
    self.title = title
    self.body = body
    self.severity = severity
    self.source = source
    self.sourceNode = sourceNode
    self.sourceService = sourceService
    self.status = status
    self.relatedThreadId = relatedThreadId
    self.relatedActionId = relatedActionId
    self.metadataJson = metadataJson
    self.createdAt = createdAt
    self.acknowledgedAt = acknowledgedAt
    self.resolvedAt = resolvedAt
  }
}

// MARK: - Notification inbox models

public struct GatewayNotificationSummary: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let userID: String
  public let kind: String
  public let title: String
  public let body: String?
  public let threadID: String?
  public let sourceRunID: String?
  public let payload: [String: String]?
  public let readAt: String?
  public let dismissedAt: String?
  public let createdAt: String

  enum CodingKeys: String, CodingKey {
    case id
    case userID = "user_id"
    case kind
    case title
    case body
    case threadID = "thread_id"
    case sourceRunID = "source_run_id"
    case payload
    case readAt = "read_at"
    case dismissedAt = "dismissed_at"
    case createdAt = "created_at"
  }

  public var isRead: Bool {
    readAt != nil
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    userID = try container.decode(String.self, forKey: .userID)
    kind = try container.decode(String.self, forKey: .kind)
    title = try container.decode(String.self, forKey: .title)
    body = try container.decodeIfPresent(String.self, forKey: .body)
    threadID = try container.decodeIfPresent(String.self, forKey: .threadID)
    sourceRunID = try container.decodeIfPresent(String.self, forKey: .sourceRunID)
    payload = try Self.decodePayload(from: container, forKey: .payload)
    readAt = try container.decodeIfPresent(String.self, forKey: .readAt)
    dismissedAt = try container.decodeIfPresent(String.self, forKey: .dismissedAt)
    createdAt = try container.decode(String.self, forKey: .createdAt)
  }

  public init(
    id: String,
    userID: String,
    kind: String,
    title: String,
    body: String?,
    threadID: String?,
    sourceRunID: String?,
    payload: [String: String]?,
    readAt: String?,
    dismissedAt: String?,
    createdAt: String
  ) {
    self.id = id
    self.userID = userID
    self.kind = kind
    self.title = title
    self.body = body
    self.threadID = threadID
    self.sourceRunID = sourceRunID
    self.payload = payload
    self.readAt = readAt
    self.dismissedAt = dismissedAt
    self.createdAt = createdAt
  }

  init?(raw input: [String: Any]) {
    guard
      let id = Self.stringValue(input["id"] ?? input["ID"]),
      let userID = Self.stringValue(input["user_id"] ?? input["UserID"]),
      let kind = Self.stringValue(input["kind"] ?? input["Kind"]),
      let title = Self.stringValue(input["title"] ?? input["Title"]),
      let createdAt = Self.stringValue(input["created_at"] ?? input["CreatedAt"])
    else {
      return nil
    }

    self.id = id
    self.userID = userID
    self.kind = kind
    self.title = title
    self.body = Self.stringValue(input["body"] ?? input["Body"])
    self.threadID = Self.stringValue(input["thread_id"] ?? input["ThreadID"])
    self.sourceRunID = Self.stringValue(input["source_run_id"] ?? input["SourceRunID"])
    self.payload = Self.dictionaryStringValues(input["payload"] ?? input["Payload"])
    self.readAt = Self.stringValue(input["read_at"] ?? input["ReadAt"])
    self.dismissedAt = Self.stringValue(input["dismissed_at"] ?? input["DismissedAt"])
    self.createdAt = createdAt
  }

  private static func decodePayload(
    from container: KeyedDecodingContainer<CodingKeys>,
    forKey key: CodingKeys
  ) throws -> [String: String]? {
    guard let rawPayload = try container.decodeIfPresent([String: String].self, forKey: key) else {
      guard let jsonObject = try container.decodeIfPresent([String: JSONValue].self, forKey: key) else {
        return nil
      }
      return jsonObject.reduce(into: [String: String]()) { partialResult, entry in
        partialResult[entry.key] = entry.value.stringValue
      }
    }
    return rawPayload
  }

  private static func stringValue(_ raw: Any?) -> String? {
    switch raw {
    case let value as String:
      return value
    case let value as NSString:
      return value as String
    case let value as NSNumber:
      if CFGetTypeID(value) == CFBooleanGetTypeID() {
        return value.boolValue ? "true" : "false"
      }
      return value.stringValue
    case nil, is NSNull:
      return nil
    default:
      return String(describing: raw!)
    }
  }

  private static func dictionaryStringValues(_ raw: Any?) -> [String: String]? {
    guard let dictionary = raw as? [String: Any] else { return nil }
    return dictionary.reduce(into: [String: String]()) { partialResult, entry in
      partialResult[entry.key] = stringValue(entry.value) ?? "null"
    }
  }
}

// MARK: - User profile models

public struct GatewayUserProfileField: Codable, Equatable, Identifiable, Sendable {
  public let key: String
  public let label: String
  public var value: String
  public let updatedAt: String?

  public var id: String { key }

  enum CodingKeys: String, CodingKey {
    case key
    case label
    case value
    case updatedAt = "updated_at"
  }
}

public struct GatewayUserProfileSection: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let title: String
  public var fields: [GatewayUserProfileField]
}

public struct GatewayUserProfile: Codable, Equatable, Sendable {
  public let userID: String
  public var sections: [GatewayUserProfileSection]
  public let updatedAt: String?

  enum CodingKeys: String, CodingKey {
    case userID = "user_id"
    case sections
    case updatedAt = "updated_at"
  }
}

private enum JSONValue: Decodable, Equatable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case null
  case array([JSONValue])
  case object([String: JSONValue])

  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode([String: JSONValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([JSONValue].self) {
      self = .array(value)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported JSON payload value")
    }
  }

  var stringValue: String {
    switch self {
    case let .string(value):
      return value
    case let .number(value):
      return String(value)
    case let .bool(value):
      return value ? "true" : "false"
    case .null:
      return "null"
    case let .array(value):
      return value.map(\.stringValue).joined(separator: ", ")
    case let .object(value):
      return value.map { "\($0.key)=\($0.value.stringValue)" }.sorted().joined(separator: ", ")
    }
  }
}

// MARK: - Action Approval models

/// Risk level for an action approval request.
public enum GatewayApprovalRiskLevel: String, Decodable, Equatable, CaseIterable, Sendable {
  case critical
  case high
  case medium
  case low
}

/// Status of an action approval request.
public enum GatewayApprovalStatus: String, Decodable, Equatable, CaseIterable, Sendable {
  case pending
  case approved
  case denied
  case expired
}

/// An action approval record returned by the approvals API.
public struct GatewayActionApproval: Decodable, Equatable, Identifiable, Sendable {
  public let id: String
  public let userId: String
  public let title: String
  public let description: String?
  public let riskLevel: String
  public let actionType: String
  public let targetNode: String?
  public let targetService: String?
  public let proposedByAgentId: String?
  public let status: String
  public let expiresAt: String?
  public let createdAt: String
  public let decidedAt: String?
  public let decidedBy: String?
  public let metadataJson: String?

  public var riskLevelValue: GatewayApprovalRiskLevel {
    GatewayApprovalRiskLevel(rawValue: riskLevel) ?? .medium
  }

  public var statusValue: GatewayApprovalStatus {
    GatewayApprovalStatus(rawValue: status) ?? .pending
  }

  public init(
    id: String,
    userId: String,
    title: String,
    description: String?,
    riskLevel: String,
    actionType: String,
    targetNode: String?,
    targetService: String?,
    proposedByAgentId: String?,
    status: String,
    expiresAt: String?,
    createdAt: String,
    decidedAt: String?,
    decidedBy: String?,
    metadataJson: String?
  ) {
    self.id = id
    self.userId = userId
    self.title = title
    self.description = description
    self.riskLevel = riskLevel
    self.actionType = actionType
    self.targetNode = targetNode
    self.targetService = targetService
    self.proposedByAgentId = proposedByAgentId
    self.status = status
    self.expiresAt = expiresAt
    self.createdAt = createdAt
    self.decidedAt = decidedAt
    self.decidedBy = decidedBy
    self.metadataJson = metadataJson
  }
}

// MARK: - Plan tracker models

public enum GatewayPlanStatus: String, Codable, Equatable, CaseIterable, Sendable {
  case onTrack = "on_track"
  case atRisk = "at_risk"
  case blocked
  case complete

  public var label: String {
    switch self {
    case .onTrack:
      return "On track"
    case .atRisk:
      return "At risk"
    case .blocked:
      return "Blocked"
    case .complete:
      return "Complete"
    }
  }
}

public enum GatewayPlanTaskStatus: String, Codable, Equatable, CaseIterable, Sendable {
  case todo
  case inProgress = "in_progress"
  case complete
  case onHold = "on_hold"
  case blocked

  public var label: String {
    switch self {
    case .todo:
      return "To do"
    case .inProgress:
      return "In progress"
    case .complete:
      return "Complete"
    case .onHold:
      return "On hold"
    case .blocked:
      return "Blocked"
    }
  }
}

public struct GatewayPlanMetric: Codable, Equatable, Sendable {
  public let label: String
  public let value: String
}

public struct GatewayPlanFact: Codable, Equatable, Sendable {
  public let label: String
  public let value: String
}

public struct GatewayPlanTrackedMetric: Codable, Equatable, Sendable {
  public let name: String
  public let notes: String?
  public let source: String?
  public let cadence: String?
  public let baseline: String?
  public let target: String?
}

public struct GatewayPlanCadenceEntry: Codable, Equatable, Sendable {
  public let label: String?
  public let day: String?
  public let activity: String
  public let notes: String?
}

public struct GatewayPlanSupportingItem: Codable, Equatable, Sendable {
  public let label: String?
  public let kind: String?
  public let content: String?
  public let uri: String?
}

public struct GatewayPlanSupportingSection: Codable, Equatable, Sendable {
  public let title: String
  public let kind: String?
  public let summary: String?
  public let items: [GatewayPlanSupportingItem]
}

public struct GatewayPlanTask: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let milestoneId: String
  public let title: String
  public let notes: String?
  public let status: GatewayPlanTaskStatus
  public let progressPercent: Int
  public let orderIndex: Int
  public let createdAt: String
  public let updatedAt: String
}

public struct GatewayPlanMilestone: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let planId: String
  public let title: String
  public let notes: String?
  public let status: GatewayPlanStatus
  public let progressPercent: Int
  public let orderIndex: Int
  public let createdAt: String
  public let updatedAt: String
  public let tasks: [GatewayPlanTask]
}

public struct GatewayPlanGoal: Codable, Equatable, Identifiable, Sendable {
  public let id: String
  public let userId: String
  public let title: String
  public let vision: String?
  public let status: GatewayPlanStatus
  public let progressPercent: Int
  public let category: String?
  public let objectives: [String]
  public let principles: [String]
  public let reviewCadence: String?
  public let nextReviewAt: String?
  public let tags: [String]
  public let sourceSystems: [String]
  public let metrics: [GatewayPlanMetric]
  public let trackedMetrics: [GatewayPlanTrackedMetric]
  public let baselineFacts: [GatewayPlanFact]
  public let successCriteria: [String]
  public let cadence: [GatewayPlanCadenceEntry]
  public let supportingSections: [GatewayPlanSupportingSection]
  public let createdAt: String
  public let updatedAt: String
  public let milestones: [GatewayPlanMilestone]

  enum CodingKeys: String, CodingKey {
    case id
    case userId
    case title
    case vision
    case status
    case progressPercent
    case category
    case objectives
    case principles
    case reviewCadence
    case nextReviewAt
    case tags
    case sourceSystems
    case metrics
    case trackedMetrics
    case baselineFacts
    case successCriteria
    case cadence
    case supportingSections
    case createdAt
    case updatedAt
    case milestones
  }

  public init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    userId = try container.decode(String.self, forKey: .userId)
    title = try container.decode(String.self, forKey: .title)
    vision = try container.decodeIfPresent(String.self, forKey: .vision)
    status = try container.decode(GatewayPlanStatus.self, forKey: .status)
    progressPercent = try container.decode(Int.self, forKey: .progressPercent)
    category = try container.decodeIfPresent(String.self, forKey: .category)
    objectives = try container.decodeIfPresent([String].self, forKey: .objectives) ?? []
    principles = try container.decodeIfPresent([String].self, forKey: .principles) ?? []
    reviewCadence = try container.decodeIfPresent(String.self, forKey: .reviewCadence)
    nextReviewAt = try container.decodeIfPresent(String.self, forKey: .nextReviewAt)
    tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
    sourceSystems = try container.decodeIfPresent([String].self, forKey: .sourceSystems) ?? []
    metrics = try container.decodeIfPresent([GatewayPlanMetric].self, forKey: .metrics) ?? []
    trackedMetrics = try container.decodeIfPresent([GatewayPlanTrackedMetric].self, forKey: .trackedMetrics) ?? []
    baselineFacts = try container.decodeIfPresent([GatewayPlanFact].self, forKey: .baselineFacts) ?? []
    successCriteria = try container.decodeIfPresent([String].self, forKey: .successCriteria) ?? []
    cadence = try container.decodeIfPresent([GatewayPlanCadenceEntry].self, forKey: .cadence) ?? []
    supportingSections = try container.decodeIfPresent([GatewayPlanSupportingSection].self, forKey: .supportingSections) ?? []
    createdAt = try container.decode(String.self, forKey: .createdAt)
    updatedAt = try container.decode(String.self, forKey: .updatedAt)
    milestones = try container.decodeIfPresent([GatewayPlanMilestone].self, forKey: .milestones) ?? []
  }
}

public struct GatewayPlanDetailsUpdate: Encodable, Sendable {
  public var title: String?
  public var vision: String?
  public var category: String?
  public var objectives: [String]?
  public var principles: [String]?
  public var reviewCadence: String?
  public var tags: [String]?
  public var sourceSystems: [String]?
  public var metrics: [GatewayPlanMetric]?
  public var trackedMetrics: [GatewayPlanTrackedMetric]?
  public var baselineFacts: [GatewayPlanFact]?
  public var successCriteria: [String]?
  public var cadence: [GatewayPlanCadenceEntry]?
  public var supportingSections: [GatewayPlanSupportingSection]?

  public init(
    title: String? = nil,
    vision: String? = nil,
    category: String? = nil,
    objectives: [String]? = nil,
    principles: [String]? = nil,
    reviewCadence: String? = nil,
    tags: [String]? = nil,
    sourceSystems: [String]? = nil,
    metrics: [GatewayPlanMetric]? = nil,
    trackedMetrics: [GatewayPlanTrackedMetric]? = nil,
    baselineFacts: [GatewayPlanFact]? = nil,
    successCriteria: [String]? = nil,
    cadence: [GatewayPlanCadenceEntry]? = nil,
    supportingSections: [GatewayPlanSupportingSection]? = nil
  ) {
    self.title = title
    self.vision = vision
    self.category = category
    self.objectives = objectives
    self.principles = principles
    self.reviewCadence = reviewCadence
    self.tags = tags
    self.sourceSystems = sourceSystems
    self.metrics = metrics
    self.trackedMetrics = trackedMetrics
    self.baselineFacts = baselineFacts
    self.successCriteria = successCriteria
    self.cadence = cadence
    self.supportingSections = supportingSections
  }
}

/// A single event emitted by the `/api/chat/stream` SSE endpoint.
public enum GatewayStreamEvent: Equatable, Sendable {
  /// A text token from the assistant response.
  case token(String)
  /// Provider-exposed reasoning text streamed separately from answer tokens.
  case reasoning(String)
  /// A lightweight activity update from the agent runtime.
  case status(String)
  /// Stream finished normally. Carries the resolved agent and thread IDs.
  case done(agentID: String, threadID: String?, completionTokensPerSecond: Double?)
  /// The orchestrated agent requires human approval before proceeding.
  case approvalRequest
  /// An alert was created during the agent run.
  case alertCreated
  /// A tool invocation has started.
  case toolStarted
  /// A tool invocation returned a result.
  case toolResult
  /// The server reported a streaming error.
  case error(String)
}

public struct GatewayConversationMessage: Equatable, Encodable, Sendable {
  public let role: String
  public let content: String

  public init(role: String, content: String) {
    self.role = role
    self.content = content
  }
}

public struct GatewayTypedPrompt: Equatable, Sendable {
  public let text: String
  public let agentID: String?

  public init(text: String, agentID: String?) {
    self.text = text
    self.agentID = agentID
  }
}

public struct GatewayChatResult: Equatable, Sendable {
  public let agentID: String
  public let content: String
  public let threadID: String?

  public init(agentID: String, content: String, threadID: String?) {
    self.agentID = agentID
    self.content = content
    self.threadID = threadID
  }
}

public protocol GatewayChatServing: Sendable {
  func fetchAgents(baseURL: URL, token: String?) async throws -> [GatewayAgentSummary]

  func registerAPNsDevice(
    baseURL: URL,
    token: String?,
    apnsToken: String,
    deviceName: String?,
    appVersion: String?,
    notificationMinSeverity: NotificationPreferenceLevel
  ) async throws
  func sendPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> GatewayChatResult
  /// Open a streaming request to `/api/chat/stream` and emit SSE events via
  /// the returned `AsyncThrowingStream`. Pre-flight errors (empty prompt, missing
  /// agent, bad URL) are thrown before the stream is returned.  Iterating the
  /// stream yields events until a `.done` event or an error is encountered.
  /// Cancelling the consuming `Task` closes the connection gracefully.
  func streamPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> AsyncThrowingStream<GatewayStreamEvent, Error>

  /// Fetch a page of alerts for the authenticated user.
  func fetchAlerts(
    baseURL: URL,
    token: String?,
    status: GatewayAlertStatus,
    limit: Int,
    before: String?
  ) async throws -> [GatewayAlertSummary]

  /// Fetch the full detail for a single alert.
  func fetchAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  /// Acknowledge an alert (mark it as read/actioned).
  func acknowledgeAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  /// Resolve an alert.
  func resolveAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail

  // MARK: - Notification inbox

  /// Fetch notification inbox items for the authenticated user.
  func fetchNotifications(
    baseURL: URL,
    token: String?,
    unreadOnly: Bool,
    limit: Int
  ) async throws -> [GatewayNotificationSummary]

  /// Mark a notification as read.
  func markNotificationRead(
    baseURL: URL,
    token: String?,
    notificationID: String
  ) async throws

  /// Delete a notification from the inbox.
  func deleteNotification(
    baseURL: URL,
    token: String?,
    notificationID: String
  ) async throws

  // MARK: - User profile

  func fetchUserProfile(baseURL: URL, token: String?) async throws -> GatewayUserProfile
  func updateUserProfile(baseURL: URL, token: String?, profile: GatewayUserProfile) async throws -> GatewayUserProfile

  // MARK: - Action Approval

  /// Fetch pending action approvals for the authenticated user.
  func fetchPendingApprovals(
    baseURL: URL,
    token: String?
  ) async throws -> [GatewayActionApproval]

  /// Fetch the full detail for a single action approval.
  func fetchApproval(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval

  /// Approve a pending action.
  func approveAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval

  /// Deny a pending action.
  func denyAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval

  // MARK: - Plan tracker

  func syncPersonalDataBatch(baseURL: URL, token: String?, batch: GatewayPersonalDataBatch) async throws -> GatewayPersonalDataBatchResult
  func syncAppleHealthSummary(baseURL: URL, token: String?, summary: GatewayAppleHealthSummary) async throws -> GatewayAppleHealthSyncResult
  func fetchPlans(baseURL: URL, token: String?) async throws -> [GatewayPlanGoal]
  func importPlanDocument(baseURL: URL, token: String?, title: String?, text: String, source: String?) async throws -> GatewayPlanGoal
  func createPlan(baseURL: URL, token: String?, title: String, vision: String?) async throws -> GatewayPlanGoal
  func updatePlan(baseURL: URL, token: String?, planID: String, title: String?, status: GatewayPlanStatus?) async throws -> GatewayPlanGoal
  func updatePlanDetails(baseURL: URL, token: String?, planID: String, update: GatewayPlanDetailsUpdate) async throws -> GatewayPlanGoal
  func deletePlan(baseURL: URL, token: String?, planID: String) async throws
  func createMilestone(baseURL: URL, token: String?, planID: String, title: String) async throws
  func updateMilestone(baseURL: URL, token: String?, planID: String, milestoneID: String, status: GatewayPlanStatus) async throws
  func deleteMilestone(baseURL: URL, token: String?, planID: String, milestoneID: String) async throws
  func createTask(baseURL: URL, token: String?, planID: String, milestoneID: String, title: String) async throws
  func updateTask(baseURL: URL, token: String?, planID: String, milestoneID: String, taskID: String, status: GatewayPlanTaskStatus) async throws
  func deleteTask(baseURL: URL, token: String?, planID: String, milestoneID: String, taskID: String) async throws

  // MARK: - Threads (chat sync across devices)

  /// Fetch the list of chat threads owned by the current user, newest activity
  /// first.  Backed by `/api/threads`.
  func fetchThreads(
    baseURL: URL,
    token: String?,
    limit: Int?
  ) async throws -> [GatewayThreadSummary]

  /// Fetch the full message history for a single thread.
  func fetchThread(
    baseURL: URL,
    token: String?,
    threadID: String
  ) async throws -> [GatewayThreadMessage]

  /// Rename a thread (updates the title shown in the sidebar).
  func renameThread(
    baseURL: URL,
    token: String?,
    threadID: String,
    title: String
  ) async throws

  /// Delete a thread and its message history.
  func deleteThread(
    baseURL: URL,
    token: String?,
    threadID: String
  ) async throws

  // MARK: - TTS

  /// Fetch the list of available TTS voices.  Returns `enabled: false` when
  /// the gateway has TTS disabled, in which case callers should hide the
  /// voice picker and Speak buttons.
  func fetchVoices(
    baseURL: URL,
    token: String?
  ) async throws -> GatewayVoicesResult

  /// Synthesize speech for `text`, optionally with a specific voice id.
  /// Returns the raw audio buffer plus its server-reported content type so
  /// the caller can hand it to a player (e.g. AVAudioPlayer).
  func synthesizeSpeech(
    baseURL: URL,
    token: String?,
    text: String,
    voice: String?
  ) async throws -> GatewaySynthesizedSpeech
}

public enum GatewayChatError: LocalizedError, Equatable, Sendable {
  case missingConfiguration
  case invalidAPNsToken
  case emptyPrompt
  case missingAgent
  case invalidResponse
  case httpError(Int, String?)
  case transport(String)

  public var errorDescription: String? {
    switch self {
    case .missingConfiguration:
      return "Complete setup before using chat."
    case .invalidAPNsToken:
      return "Provide a valid APNs token."
    case .emptyPrompt:
      return "Enter a prompt before sending."
    case .missingAgent:
      return "Select an agent before sending your message."
    case .invalidResponse:
      return "Gateway returned an invalid chat response."
    case let .httpError(statusCode, message):
      if let message, !message.isEmpty {
        return message
      }
      return "Gateway chat request failed with HTTP \(statusCode)."
    case let .transport(message):
      return "Unable to reach the gateway. \(message)"
    }
  }
}

public final class GatewayChatClient: GatewayChatServing, Sendable {
  private static let apnsTokenPattern = "^[a-f0-9]{32,512}$"
  private let session: URLSession
  /// Timeout for regular (non-streaming) API requests in seconds. Default: 30.
  private let requestTimeout: TimeInterval
  /// Timeout for streaming API requests in seconds. Default: 90.
  private let streamTimeout: TimeInterval

  public init(
    session: URLSession = .shared,
    requestTimeout: TimeInterval = 30,
    streamTimeout: TimeInterval = 90
  ) {
    self.session = session
    self.requestTimeout = requestTimeout
    self.streamTimeout = streamTimeout
  }

  public func fetchAgents(baseURL: URL, token: String?) async throws -> [GatewayAgentSummary] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/agents") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AgentsResponse.self, from: data)
    return decoded.agents
  }

  public func registerAPNsDevice(
    baseURL: URL,
    token: String?,
    apnsToken: String,
    deviceName: String?,
    appVersion: String? = nil,
    notificationMinSeverity: NotificationPreferenceLevel = .highAndAbove
  ) async throws {
    let normalizedToken = apnsToken
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .replacingOccurrences(of: "<", with: "")
      .replacingOccurrences(of: ">", with: "")
      .replacingOccurrences(of: "\\s+", with: "", options: .regularExpression)
      .lowercased()
    guard normalizedToken.range(of: Self.apnsTokenPattern, options: .regularExpression) != nil else {
      throw GatewayChatError.invalidAPNsToken
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/session/mobile-devices/apns") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName, appVersion: appVersion)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(RegisterAPNsDevicePayload(
      apnsToken: normalizedToken,
      notificationMinSeverity: notificationMinSeverity.rawValue
    ))

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func sendPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> GatewayChatResult {
    let trimmedPrompt = prompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else { throw GatewayChatError.emptyPrompt }

    guard let agentID = prompt.agentID?.trimmingCharacters(in: .whitespacesAndNewlines), !agentID.isEmpty else {
      throw GatewayChatError.missingAgent
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/chat") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    let payload = ChatRequestPayload(
      agentID: agentID,
      threadID: threadID,
      messages: messages.map { .init(role: $0.role, content: $0.content) }
    )
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ChatResponsePayload.self, from: data)
    let assistantContent = decoded.message.content.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !assistantContent.isEmpty else { throw GatewayChatError.invalidResponse }
    let normalizedAgentID = decoded.agentID.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !normalizedAgentID.isEmpty else { throw GatewayChatError.invalidResponse }
    let normalizedThreadID = decoded.threadID?.trimmingCharacters(in: .whitespacesAndNewlines)

    return GatewayChatResult(
      agentID: normalizedAgentID,
      content: assistantContent,
      threadID: (normalizedThreadID?.isEmpty == false) ? normalizedThreadID : nil
    )
  }

  /// Performs a request, retrying once on transient network errors
  /// (connection lost, not connected, or timed out).
  private func performWithRetry(_ request: URLRequest) async throws -> (Data, URLResponse) {
    do {
      return try await perform(request)
    } catch let chatError as GatewayChatError {
      // Only retry on transport-layer errors that may be transient.
      if case let .transport(msg) = chatError, isTransientError(msg) {
        // Brief pause before retry.
        try await Task.sleep(nanoseconds: 500_000_000)
        return try await perform(request)
      }
      throw chatError
    }
  }

  private func isTransientError(_ message: String) -> Bool {
    let lower = message.lowercased()
    return lower.contains("network connection was lost")
      || lower.contains("not connected to the internet")
      || lower.contains("timed out")
      || lower.contains("the request timed out")
  }

  private func perform(_ request: URLRequest) async throws -> (Data, URLResponse) {
    do {
      return try await session.data(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }
  }

  public func streamPrompt(
    baseURL: URL,
    token: String?,
    prompt: GatewayTypedPrompt,
    messages: [GatewayConversationMessage],
    threadID: String?,
    deviceName: String?
  ) async throws -> AsyncThrowingStream<GatewayStreamEvent, Error> {
    let trimmedPrompt = prompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedPrompt.isEmpty else { throw GatewayChatError.emptyPrompt }

    guard let agentID = prompt.agentID?.trimmingCharacters(in: .whitespacesAndNewlines), !agentID.isEmpty else {
      throw GatewayChatError.missingAgent
    }

    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/chat/stream") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: streamTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: deviceName)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

    let payload = ChatRequestPayload(
      agentID: agentID,
      threadID: threadID,
      messages: messages.map { .init(role: $0.role, content: $0.content) }
    )
    request.httpBody = try JSONEncoder().encode(payload)

    #if canImport(FoundationNetworking)
    // FoundationNetworking (Linux) does not expose URLSession.bytes(for:).
    // Load the full response body and replay SSE events synchronously.
    let (data, response): (Data, URLResponse)
    do {
      (data, response) = try await session.data(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let sseText = String(data: data, encoding: .utf8) ?? ""
    let events = sseText.components(separatedBy: "\n").compactMap {
      Self.parseSseLine($0, fallbackAgentID: agentID)
    }
    return AsyncThrowingStream { continuation in
      for event in events {
        continuation.yield(event)
      }
      continuation.finish()
    }
    #else
    // On Apple platforms use the native streaming API so tokens arrive
    // incrementally as they are produced by the server.
    let (bytes, response): (URLSession.AsyncBytes, URLResponse)
    do {
      (bytes, response) = try await session.bytes(for: request)
    } catch {
      throw GatewayChatError.transport(error.localizedDescription)
    }

    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      var errorData = Data()
      for try await byte in bytes {
        errorData.append(byte)
      }
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: errorData))
    }

    return AsyncThrowingStream { continuation in
      let feedTask = Task {
        do {
          for try await line in bytes.lines {
            if Task.isCancelled { break }
            if let event = Self.parseSseLine(line, fallbackAgentID: agentID) {
              continuation.yield(event)
            }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in feedTask.cancel() }
    }
    #endif
  }

  /// Parse a single SSE `data:` line into a `GatewayStreamEvent`.
  /// Returns `nil` for lines that are not SSE data lines or contain unknown types.
  private static func parseSseLine(_ line: String, fallbackAgentID: String) -> GatewayStreamEvent? {
    guard line.hasPrefix("data: ") else { return nil }
    let jsonStr = String(line.dropFirst(6))
    guard
      let data = jsonStr.data(using: .utf8),
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let type = json["type"] as? String
    else { return nil }

    switch type {
    case "token":
      guard let tok = json["token"] as? String else { return nil }
      return .token(tok)
    case "reasoning":
      guard let text = json["text"] as? String else { return nil }
      return .reasoning(text)
    case "status":
      guard let message = json["message"] as? String else { return nil }
      return .status(message)
    case "done":
      let aid = (json["agentId"] as? String) ?? fallbackAgentID
      let rawTID = json["threadId"] as? String
      let tid = (rawTID?.isEmpty == false) ? rawTID : nil
      let tps = json["completionTokensPerSecond"] as? Double
      return .done(agentID: aid, threadID: tid, completionTokensPerSecond: tps)
    case "approval_request":
      return .approvalRequest
    case "alert_created":
      return .alertCreated
    case "tool_started":
      return .toolStarted
    case "tool_result":
      return .toolResult
    case "error":
      let msg = json["error"] as? String ?? "Unknown streaming error"
      return .error(msg)
    default:
      return nil
    }
  }

  // MARK: - Alert endpoints

  public func fetchAlerts(
    baseURL: URL,
    token: String?,
    status: GatewayAlertStatus = .open,
    limit: Int = 20,
    before: String? = nil
  ) async throws -> [GatewayAlertSummary] {
    var components = URLComponents()
    components.queryItems = [
      URLQueryItem(name: "status", value: status.rawValue),
      URLQueryItem(name: "limit", value: String(limit)),
    ]
    if let before {
      components.queryItems?.append(URLQueryItem(name: "before", value: before))
    }
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts") else {
      throw GatewayChatError.missingConfiguration
    }
    var urlWithQuery = url
    if let query = components.percentEncodedQuery {
      urlWithQuery = URL(string: url.absoluteString + "?" + query) ?? url
    }

    var request = URLRequest(url: urlWithQuery, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertsListResponse.self, from: data)
    return decoded.alerts
  }

  public func fetchAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  public func acknowledgeAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)/ack") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  public func resolveAlert(
    baseURL: URL,
    token: String?,
    alertID: String
  ) async throws -> GatewayAlertDetail {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/alerts/\(alertID)/resolve") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(AlertDetailResponse.self, from: data)
    return decoded.alert
  }

  // MARK: - Notification inbox endpoints

  public func fetchNotifications(
    baseURL: URL,
    token: String?,
    unreadOnly: Bool = false,
    limit: Int = 50
  ) async throws -> [GatewayNotificationSummary] {
    var components = URLComponents()
    components.queryItems = [
      URLQueryItem(name: "unreadOnly", value: unreadOnly ? "true" : "false"),
      URLQueryItem(name: "limit", value: String(limit)),
    ]
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/notifications") else {
      throw GatewayChatError.missingConfiguration
    }
    var urlWithQuery = url
    if let query = components.percentEncodedQuery {
      urlWithQuery = URL(string: url.absoluteString + "?" + query) ?? url
    }

    var request = URLRequest(url: urlWithQuery, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    return try decodeNotificationsList(from: data).filter { $0.dismissedAt == nil }
  }

  public func markNotificationRead(
    baseURL: URL,
    token: String?,
    notificationID: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/notifications/\(notificationID)/read") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func deleteNotification(
    baseURL: URL,
    token: String?,
    notificationID: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/notifications/\(notificationID)") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "DELETE"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  // MARK: - User profile endpoints

  public func fetchUserProfile(baseURL: URL, token: String?) async throws -> GatewayUserProfile {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/profile") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(UserProfileResponse.self, from: data)
    return decoded.profile
  }

  public func updateUserProfile(
    baseURL: URL,
    token: String?,
    profile: GatewayUserProfile
  ) async throws -> GatewayUserProfile {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/profile") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(UserProfileUpdatePayload(profile: profile))

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(UserProfileResponse.self, from: data)
    return decoded.profile
  }

  // MARK: - Action Approval endpoints

  public func fetchPendingApprovals(
    baseURL: URL,
    token: String?
  ) async throws -> [GatewayActionApproval] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/pending") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalsListResponse.self, from: data)
    return decoded.approvals
  }

  public func fetchApproval(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  public func approveAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)/approve") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  public func denyAction(
    baseURL: URL,
    token: String?,
    approvalID: String
  ) async throws -> GatewayActionApproval {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/mobile/actions/\(approvalID)/deny") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    let decoded = try JSONDecoder().decode(ApprovalDetailResponse.self, from: data)
    return decoded.approval
  }

  // MARK: - Plan tracker endpoints

  public func fetchPlans(baseURL: URL, token: String?) async throws -> [GatewayPlanGoal] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(PlansListResponse.self, from: data)
    return decoded.plans
  }

  public func importPlanDocument(
    baseURL: URL,
    token: String?,
    title: String?,
    text: String,
    source: String?
  ) async throws -> GatewayPlanGoal {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/import") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let payload: [String: String] = [
      "title": title?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
      "text": text,
      "source": source?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "",
    ]
    request.httpBody = try JSONEncoder().encode(payload)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(PlanResponse.self, from: data)
    return decoded.plan
  }

  public func syncAppleHealthSummary(
    baseURL: URL,
    token: String?,
    summary: GatewayAppleHealthSummary
  ) async throws -> GatewayAppleHealthSyncResult {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/health/apple/summary") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(summary)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    return try JSONDecoder().decode(GatewayAppleHealthSyncResult.self, from: data)
  }

  public func syncPersonalDataBatch(
    baseURL: URL,
    token: String?,
    batch: GatewayPersonalDataBatch
  ) async throws -> GatewayPersonalDataBatchResult {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/personal-data/batches") else {
      throw GatewayChatError.missingConfiguration
    }

    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(batch)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }

    return try JSONDecoder().decode(GatewayPersonalDataBatchResult.self, from: data)
  }

  public func createPlan(
    baseURL: URL,
    token: String?,
    title: String,
    vision: String?
  ) async throws -> GatewayPlanGoal {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    let payload: [String: String?] = [
      "title": title,
      "vision": vision,
    ]
    request.httpBody = try JSONEncoder().encode(payload)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(PlanResponse.self, from: data)
    return decoded.plan
  }

  public func updatePlan(
    baseURL: URL,
    token: String?,
    planID: String,
    title: String?,
    status: GatewayPlanStatus?
  ) async throws -> GatewayPlanGoal {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var payload: [String: String] = [:]
    if let title { payload["title"] = title }
    if let status { payload["status"] = status.rawValue }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(payload)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(PlanResponse.self, from: data)
    return decoded.plan
  }

  public func updatePlanDetails(
    baseURL: URL,
    token: String?,
    planID: String,
    update: GatewayPlanDetailsUpdate
  ) async throws -> GatewayPlanGoal {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(update)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(PlanResponse.self, from: data)
    return decoded.plan
  }

  public func deletePlan(baseURL: URL, token: String?, planID: String) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "DELETE"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func createMilestone(baseURL: URL, token: String?, planID: String, title: String) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["title": title])
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func updateMilestone(
    baseURL: URL,
    token: String?,
    planID: String,
    milestoneID: String,
    status: GatewayPlanStatus
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones/\(milestoneID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["status": status.rawValue])
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func deleteMilestone(
    baseURL: URL,
    token: String?,
    planID: String,
    milestoneID: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones/\(milestoneID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "DELETE"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func createTask(
    baseURL: URL,
    token: String?,
    planID: String,
    milestoneID: String,
    title: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones/\(milestoneID)/tasks") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["title": title])
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func updateTask(
    baseURL: URL,
    token: String?,
    planID: String,
    milestoneID: String,
    taskID: String,
    status: GatewayPlanTaskStatus
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones/\(milestoneID)/tasks/\(taskID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PUT"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["status": status.rawValue])
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func deleteTask(
    baseURL: URL,
    token: String?,
    planID: String,
    milestoneID: String,
    taskID: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/plans/\(planID)/milestones/\(milestoneID)/tasks/\(taskID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "DELETE"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  // MARK: - Thread endpoints

  public func fetchThreads(
    baseURL: URL,
    token: String?,
    limit: Int? = nil
  ) async throws -> [GatewayThreadSummary] {
    guard let base = endpointURL(baseURL: baseURL, endpointPath: "/api/threads") else {
      throw GatewayChatError.missingConfiguration
    }
    var url = base
    if let limit, limit > 0 {
      url = URL(string: base.absoluteString + "?limit=\(limit)") ?? base
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(ThreadsListResponse.self, from: data)
    return decoded.threads
  }

  public func fetchThread(
    baseURL: URL,
    token: String?,
    threadID: String
  ) async throws -> [GatewayThreadMessage] {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/threads/\(threadID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let decoded = try JSONDecoder().decode(ThreadDetailResponse.self, from: data)
    return decoded.messages
  }

  public func renameThread(
    baseURL: URL,
    token: String?,
    threadID: String,
    title: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/threads/\(threadID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "PATCH"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(["title": title])

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  public func deleteThread(
    baseURL: URL,
    token: String?,
    threadID: String
  ) async throws {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/threads/\(threadID)") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "DELETE"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
  }

  // MARK: - TTS endpoints

  public func fetchVoices(
    baseURL: URL,
    token: String?
  ) async throws -> GatewayVoicesResult {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/tts/voices") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "GET"
    addCommonHeaders(request: &request, token: token, deviceName: nil)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    if httpResponse.statusCode == 409 {
      // TTS disabled on this gateway.
      return GatewayVoicesResult(enabled: false, voices: [])
    }
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    return try JSONDecoder().decode(GatewayVoicesResult.self, from: data)
  }

  public func synthesizeSpeech(
    baseURL: URL,
    token: String?,
    text: String,
    voice: String?
  ) async throws -> GatewaySynthesizedSpeech {
    guard let url = endpointURL(baseURL: baseURL, endpointPath: "/api/tts") else {
      throw GatewayChatError.missingConfiguration
    }
    var request = URLRequest(url: url, timeoutInterval: requestTimeout)
    request.httpMethod = "POST"
    addCommonHeaders(request: &request, token: token, deviceName: nil)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")

    var payload: [String: String] = ["text": text]
    if let voice, !voice.isEmpty { payload["voice"] = voice }
    request.httpBody = try JSONEncoder().encode(payload)

    let (data, response) = try await performWithRetry(request)
    let httpResponse = try validateHTTPResponse(response)
    guard (200..<300).contains(httpResponse.statusCode) else {
      throw GatewayChatError.httpError(httpResponse.statusCode, parseErrorMessage(from: data))
    }
    let contentType = httpResponse.value(forHTTPHeaderField: "Content-Type") ?? "audio/mpeg"
    return GatewaySynthesizedSpeech(audio: data, contentType: contentType)
  }

  private func validateHTTPResponse(_ response: URLResponse) throws -> HTTPURLResponse {
    guard let httpResponse = response as? HTTPURLResponse else {
      throw GatewayChatError.invalidResponse
    }
    return httpResponse
  }

  private func parseErrorMessage(from data: Data) -> String? {
    guard !data.isEmpty else { return nil }
    guard let decoded = try? JSONDecoder().decode(APIErrorPayload.self, from: data) else { return nil }
    return decoded.message ?? decoded.error
  }

  private func addCommonHeaders(
    request: inout URLRequest,
    token: String?,
    deviceName: String?,
    appVersion: String? = nil
  ) {
    if let token, !token.isEmpty {
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    }
    request.setValue("ios", forHTTPHeaderField: "X-Gateway-Client-Platform")
    if let deviceName, !deviceName.isEmpty {
      request.setValue(deviceName, forHTTPHeaderField: "X-Gateway-Device-Name")
    }
    if let appVersion, !appVersion.isEmpty {
      request.setValue(appVersion, forHTTPHeaderField: "X-Gateway-App-Version")
    }
  }

  private func endpointURL(baseURL: URL, endpointPath: String) -> URL? {
    let endpoint = endpointPath.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    guard !endpoint.isEmpty else { return baseURL }
    return baseURL.appendingPathComponent(endpoint)
  }
}

private struct AgentsResponse: Decodable {
  let agents: [GatewayAgentSummary]
}

private struct ChatRequestPayload: Encodable {
  let agentID: String
  let threadID: String?
  let messages: [Message]

  enum CodingKeys: String, CodingKey {
    case agentID = "agentId"
    case threadID = "threadId"
    case messages
  }

  struct Message: Encodable {
    let role: String
    let content: String
  }
}

private func decodeNotificationsList(from data: Data) throws -> [GatewayNotificationSummary] {
  let jsonObject = try JSONSerialization.jsonObject(with: data)
  guard
    let body = jsonObject as? [String: Any],
    let records = body["notifications"] as? [Any]
  else {
    throw GatewayChatError.invalidResponse
  }

  return records.compactMap { entry in
    guard let record = entry as? [String: Any] else { return nil }
    return GatewayNotificationSummary(raw: record)
  }
}

private struct RegisterAPNsDevicePayload: Encodable {
  let apnsToken: String
  /// Minimum alert severity that should trigger a push notification.
  let notificationMinSeverity: String
}

private struct ChatResponsePayload: Decodable {
  let agentID: String
  let message: AssistantMessage
  let threadID: String?

  enum CodingKeys: String, CodingKey {
    case agentID = "agentId"
    case message
    case threadID = "threadId"
  }

  struct AssistantMessage: Decodable {
    let content: String
  }
}

private struct APIErrorPayload: Decodable {
  let error: String?
  let message: String?
}

private struct AlertsListResponse: Decodable {
  let alerts: [GatewayAlertSummary]
}

private struct AlertDetailResponse: Decodable {
  let alert: GatewayAlertDetail
}

private struct NotificationsListResponse: Decodable {
  let notifications: [GatewayNotificationSummary]
}

private struct UserProfileResponse: Decodable {
  let profile: GatewayUserProfile
}

private struct UserProfileUpdatePayload: Encodable {
  let profile: GatewayUserProfile
}

private struct ApprovalsListResponse: Decodable {
  let approvals: [GatewayActionApproval]
}

private struct ApprovalDetailResponse: Decodable {
  let approval: GatewayActionApproval
}

private struct ThreadsListResponse: Decodable {
  let threads: [GatewayThreadSummary]
}

private struct ThreadDetailResponse: Decodable {
  let messages: [GatewayThreadMessage]
}

private struct PlansListResponse: Decodable {
  let plans: [GatewayPlanGoal]
}

private struct PlanResponse: Decodable {
  let plan: GatewayPlanGoal
}
