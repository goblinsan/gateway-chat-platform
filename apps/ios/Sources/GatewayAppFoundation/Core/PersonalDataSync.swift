import Foundation

public enum GatewayPersonalDataValue: Codable, Equatable, Sendable {
  case string(String)
  case number(Double)
  case bool(Bool)
  case object([String: GatewayPersonalDataValue])
  case array([GatewayPersonalDataValue])
  case null

  public init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if container.decodeNil() {
      self = .null
    } else if let value = try? container.decode(Bool.self) {
      self = .bool(value)
    } else if let value = try? container.decode(Double.self) {
      self = .number(value)
    } else if let value = try? container.decode(String.self) {
      self = .string(value)
    } else if let value = try? container.decode([String: GatewayPersonalDataValue].self) {
      self = .object(value)
    } else if let value = try? container.decode([GatewayPersonalDataValue].self) {
      self = .array(value)
    } else {
      throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unsupported personal data JSON value")
    }
  }

  public func encode(to encoder: Encoder) throws {
    var container = encoder.singleValueContainer()
    switch self {
    case .string(let value):
      try container.encode(value)
    case .number(let value):
      try container.encode(value)
    case .bool(let value):
      try container.encode(value)
    case .object(let value):
      try container.encode(value)
    case .array(let value):
      try container.encode(value)
    case .null:
      try container.encodeNil()
    }
  }
}

public struct GatewayPersonalDataRecord: Codable, Equatable, Sendable {
  public let sourceRecordType: String
  public let sourceRecordSubtype: String?
  public let sourceRecordID: String?
  public let dedupeKey: String?
  public let startTime: String?
  public let endTime: String?
  public let observedAt: String?
  public let value: Double?
  public let unit: String?
  public let rawPayload: [String: GatewayPersonalDataValue]?
  public let normalizedPayload: [String: GatewayPersonalDataValue]?
  public let sourceMetadata: [String: GatewayPersonalDataValue]?
  public let trustLevel: String?

  enum CodingKeys: String, CodingKey {
    case sourceRecordType = "source_record_type"
    case sourceRecordSubtype = "source_record_subtype"
    case sourceRecordID = "source_record_id"
    case dedupeKey = "dedupe_key"
    case startTime = "start_time"
    case endTime = "end_time"
    case observedAt = "observed_at"
    case value
    case unit
    case rawPayload = "raw_payload_json"
    case normalizedPayload = "normalized_payload_json"
    case sourceMetadata = "source_metadata_json"
    case trustLevel = "trust_level"
  }

  public init(
    sourceRecordType: String,
    sourceRecordSubtype: String? = nil,
    sourceRecordID: String? = nil,
    dedupeKey: String? = nil,
    startTime: String? = nil,
    endTime: String? = nil,
    observedAt: String? = nil,
    value: Double? = nil,
    unit: String? = nil,
    rawPayload: [String: GatewayPersonalDataValue]? = nil,
    normalizedPayload: [String: GatewayPersonalDataValue]? = nil,
    sourceMetadata: [String: GatewayPersonalDataValue]? = nil,
    trustLevel: String? = nil
  ) {
    self.sourceRecordType = sourceRecordType
    self.sourceRecordSubtype = sourceRecordSubtype
    self.sourceRecordID = sourceRecordID
    self.dedupeKey = dedupeKey
    self.startTime = startTime
    self.endTime = endTime
    self.observedAt = observedAt
    self.value = value
    self.unit = unit
    self.rawPayload = rawPayload
    self.normalizedPayload = normalizedPayload
    self.sourceMetadata = sourceMetadata
    self.trustLevel = trustLevel
  }
}

public struct GatewayPersonalDataBatch: Codable, Equatable, Sendable {
  public let sourceSystem: String
  public let sourceDevice: String?
  public let sourceApp: String?
  public let syncStartedAt: String?
  public let syncCompletedAt: String?
  public let schemaVersion: String?
  public let normalizationVersion: String?
  public let metadata: [String: GatewayPersonalDataValue]?
  public let records: [GatewayPersonalDataRecord]

  enum CodingKeys: String, CodingKey {
    case sourceSystem = "source_system"
    case sourceDevice = "source_device"
    case sourceApp = "source_app"
    case syncStartedAt = "sync_started_at"
    case syncCompletedAt = "sync_completed_at"
    case schemaVersion = "schema_version"
    case normalizationVersion = "normalization_version"
    case metadata = "metadata_json"
    case records
  }

  public init(
    sourceSystem: String,
    sourceDevice: String? = nil,
    sourceApp: String? = nil,
    syncStartedAt: String? = nil,
    syncCompletedAt: String? = nil,
    schemaVersion: String? = nil,
    normalizationVersion: String? = nil,
    metadata: [String: GatewayPersonalDataValue]? = nil,
    records: [GatewayPersonalDataRecord]
  ) {
    self.sourceSystem = sourceSystem
    self.sourceDevice = sourceDevice
    self.sourceApp = sourceApp
    self.syncStartedAt = syncStartedAt
    self.syncCompletedAt = syncCompletedAt
    self.schemaVersion = schemaVersion
    self.normalizationVersion = normalizationVersion
    self.metadata = metadata
    self.records = records
  }
}

public struct GatewayPersonalDataBatchResult: Decodable, Equatable, Sendable {
  public let batchID: String
  public let status: String
  public let received: Int
  public let inserted: Int
  public let updated: Int
  public let rejected: Int
  public let processingStatus: String

  public init(
    batchID: String,
    status: String,
    received: Int,
    inserted: Int,
    updated: Int,
    rejected: Int,
    processingStatus: String
  ) {
    self.batchID = batchID
    self.status = status
    self.received = received
    self.inserted = inserted
    self.updated = updated
    self.rejected = rejected
    self.processingStatus = processingStatus
  }

  enum CodingKeys: String, CodingKey {
    case batchID = "batch_id"
    case status
    case received
    case inserted
    case updated
    case rejected
    case processingStatus = "processing_status"
  }
}
