import Foundation

public struct GatewayAppleHealthSummary: Codable, Equatable, Sendable {
  public let date: String
  public let timezone: String
  public let activity: [String: Double]
  public let nutrition: [String: Double]

  public init(date: String, timezone: String, activity: [String: Double], nutrition: [String: Double]) {
    self.date = date
    self.timezone = timezone
    self.activity = activity
    self.nutrition = nutrition
  }

  public func personalDataBatch(sourceDevice: String? = nil, sourceApp: String = "Apple Health") -> GatewayPersonalDataBatch {
    let bounds = Self.dayBounds(date: date, timezone: timezone)
    var records: [GatewayPersonalDataRecord] = []
    for key in activity.keys.sorted() {
      guard let value = activity[key] else { continue }
      records.append(Self.metricRecord(
        date: date,
        timezone: timezone,
        recordType: "health.activity",
        metric: key,
        value: value,
        startTime: bounds.start,
        endTime: bounds.end
      ))
    }
    for key in nutrition.keys.sorted() {
      guard let value = nutrition[key] else { continue }
      records.append(Self.metricRecord(
        date: date,
        timezone: timezone,
        recordType: "health.nutrition",
        metric: key,
        value: value,
        startTime: bounds.start,
        endTime: bounds.end
      ))
    }
    return GatewayPersonalDataBatch(
      sourceSystem: "apple_healthkit",
      sourceDevice: sourceDevice,
      sourceApp: sourceApp,
      schemaVersion: "apple-health-summary.v1",
      normalizationVersion: "gateway-ios.healthkit-summary.v1",
      metadata: [
        "date": .string(date),
        "timezone": .string(timezone),
        "summary_kind": .string("daily"),
      ],
      records: records
    )
  }

  private static func metricRecord(
    date: String,
    timezone: String,
    recordType: String,
    metric: String,
    value: Double,
    startTime: String?,
    endTime: String?
  ) -> GatewayPersonalDataRecord {
    let sourceRecordID = "apple_healthkit:\(date):\(recordType):\(metric)"
    return GatewayPersonalDataRecord(
      sourceRecordType: recordType,
      sourceRecordSubtype: metric,
      sourceRecordID: sourceRecordID,
      dedupeKey: sourceRecordID,
      startTime: startTime,
      endTime: endTime,
      value: value,
      unit: metricUnit(metric),
      normalizedPayload: [
        "date": .string(date),
        "metric": .string(metric),
        "timezone": .string(timezone),
        "unit": .string(metricUnit(metric)),
        "value": .number(value),
      ],
      sourceMetadata: ["source": .string("Apple Health")],
      trustLevel: "app_reported"
    )
  }

  private static func dayBounds(date: String, timezone: String) -> (start: String?, end: String?) {
    let zone = TimeZone(identifier: timezone) ?? .current
    let inputFormatter = DateFormatter()
    inputFormatter.calendar = Calendar(identifier: .gregorian)
    inputFormatter.locale = Locale(identifier: "en_US_POSIX")
    inputFormatter.timeZone = zone
    inputFormatter.dateFormat = "yyyy-MM-dd"
    guard let start = inputFormatter.date(from: date) else {
      return (nil, nil)
    }
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = zone
    guard let end = calendar.date(byAdding: .day, value: 1, to: start) else {
      return (nil, nil)
    }
    let outputFormatter = DateFormatter()
    outputFormatter.calendar = Calendar(identifier: .gregorian)
    outputFormatter.locale = Locale(identifier: "en_US_POSIX")
    outputFormatter.timeZone = zone
    outputFormatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ssXXXXX"
    return (outputFormatter.string(from: start), outputFormatter.string(from: end))
  }

  private static func metricUnit(_ key: String) -> String {
    if key.contains("minutes") { return "min" }
    if key.contains("kcal") { return "kcal" }
    if key.contains("miles") { return "mile" }
    if key.contains("grams") { return "g" }
    if key.contains("ounces") { return "fl_oz" }
    if key.contains("weight_lb") { return "lb" }
    if key.contains("heart_rate") || key.contains("bpm") { return "bpm" }
    return "count"
  }
}

public struct GatewayAppleHealthSyncResult: Decodable, Equatable, Sendable {
  public let status: String

  public init(status: String) {
    self.status = status
  }
}

public enum GatewayAppleHealthError: LocalizedError, Equatable, Sendable {
  case unavailable
  case authorizationDenied
  case unsupportedPlatform

  public var errorDescription: String? {
    switch self {
    case .unavailable:
      return "Apple Health data is not available on this device."
    case .authorizationDenied:
      return "Apple Health permission was not granted."
    case .unsupportedPlatform:
      return "Apple Health sync is only available on supported iOS devices."
    }
  }
}

#if canImport(HealthKit)
import HealthKit

@MainActor
public final class AppleHealthSummaryProvider {
  private let store: HKHealthStore

  public init(store: HKHealthStore = HKHealthStore()) {
    self.store = store
  }

  public func dailySummary(for date: Date = Date(), calendar: Calendar = .current) async throws -> GatewayAppleHealthSummary {
    guard HKHealthStore.isHealthDataAvailable() else {
      throw GatewayAppleHealthError.unavailable
    }

    try await requestAuthorization()

    let start = calendar.startOfDay(for: date)
    guard let end = calendar.date(byAdding: .day, value: 1, to: start) else {
      throw GatewayAppleHealthError.unavailable
    }

    var activity: [String: Double] = [:]
    activity["steps"] = try await cumulativeQuantity(.stepCount, unit: .count(), start: start, end: end)
    activity["exercise_minutes"] = try await cumulativeQuantity(.appleExerciseTime, unit: .minute(), start: start, end: end)
    activity["active_energy_kcal"] = try await cumulativeQuantity(.activeEnergyBurned, unit: .kilocalorie(), start: start, end: end)
    let walkingRunningMiles = try await cumulativeQuantity(.distanceWalkingRunning, unit: .mile(), start: start, end: end)
    let cyclingMiles = try await cumulativeQuantity(.distanceCycling, unit: .mile(), start: start, end: end)
    activity["distance_miles"] = walkingRunningMiles + cyclingMiles
    activity["walking_running_distance_miles"] = walkingRunningMiles
    activity["cycling_distance_miles"] = cyclingMiles
    if let restingHeartRate = try await averageQuantity(.restingHeartRate, unit: HKUnit.count().unitDivided(by: .minute()), start: start, end: end) {
      activity["resting_heart_rate_bpm"] = restingHeartRate
    }
    if let weight = try await mostRecentQuantity(.bodyMass, unit: .pound(), start: start, end: end) {
      activity["weight_lb"] = weight
    }
    let workoutSummary = try await workouts(start: start, end: end)
    activity["workouts"] = Double(workoutSummary.count)
    activity["workout_minutes"] = workoutSummary.minutes

    var nutrition: [String: Double] = [:]
    nutrition["dietary_energy_kcal"] = try await cumulativeQuantity(.dietaryEnergyConsumed, unit: .kilocalorie(), start: start, end: end)
    nutrition["protein_grams"] = try await cumulativeQuantity(.dietaryProtein, unit: .gram(), start: start, end: end)
    nutrition["carbs_grams"] = try await cumulativeQuantity(.dietaryCarbohydrates, unit: .gram(), start: start, end: end)
    nutrition["fat_grams"] = try await cumulativeQuantity(.dietaryFatTotal, unit: .gram(), start: start, end: end)
    nutrition["water_ounces"] = try await cumulativeQuantity(.dietaryWater, unit: .fluidOunceUS(), start: start, end: end)

    activity = activity.filter { $0.value > 0 }
    nutrition = nutrition.filter { $0.value > 0 }

    return GatewayAppleHealthSummary(
      date: Self.dateFormatter.string(from: start),
      timezone: TimeZone.current.identifier,
      activity: activity,
      nutrition: nutrition
    )
  }

  private func requestAuthorization() async throws {
    let types = readTypes()
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      store.requestAuthorization(toShare: [], read: types) { success, error in
        if let error {
          continuation.resume(throwing: error)
        } else if success {
          continuation.resume()
        } else {
          continuation.resume(throwing: GatewayAppleHealthError.authorizationDenied)
        }
      }
    }
  }

  private func readTypes() -> Set<HKObjectType> {
    var types = Set<HKObjectType>()
    for identifier in quantityIdentifiers {
      if let type = HKObjectType.quantityType(forIdentifier: identifier) {
        types.insert(type)
      }
    }
    types.insert(HKObjectType.workoutType())
    return types
  }

  private var quantityIdentifiers: [HKQuantityTypeIdentifier] {
    [
      .stepCount,
      .appleExerciseTime,
      .activeEnergyBurned,
      .distanceWalkingRunning,
      .distanceCycling,
      .restingHeartRate,
      .bodyMass,
      .dietaryEnergyConsumed,
      .dietaryProtein,
      .dietaryCarbohydrates,
      .dietaryFatTotal,
      .dietaryWater,
    ]
  }

  private func cumulativeQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> Double {
    guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return 0 }
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])
    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, statistics, error in
        if isHealthKitNoDataError(error) {
          continuation.resume(returning: 0)
        } else if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: statistics?.sumQuantity()?.doubleValue(for: unit) ?? 0)
        }
      }
      store.execute(query)
    }
  }

  private func averageQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> Double? {
    guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])
    return try await withCheckedThrowingContinuation { continuation in
      let query = HKStatisticsQuery(quantityType: type, quantitySamplePredicate: predicate, options: .discreteAverage) { _, statistics, error in
        if isHealthKitNoDataError(error) {
          continuation.resume(returning: nil)
        } else if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: statistics?.averageQuantity()?.doubleValue(for: unit))
        }
      }
      store.execute(query)
    }
  }

  private func mostRecentQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, start: Date, end: Date) async throws -> Double? {
    guard let type = HKObjectType.quantityType(forIdentifier: identifier) else { return nil }
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])
    let sort = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
    return try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(sampleType: type, predicate: predicate, limit: 1, sortDescriptors: [sort]) { _, samples, error in
        if isHealthKitNoDataError(error) {
          continuation.resume(returning: nil)
        } else if let error {
          continuation.resume(throwing: error)
        } else if let sample = samples?.first as? HKQuantitySample {
          continuation.resume(returning: sample.quantity.doubleValue(for: unit))
        } else {
          continuation.resume(returning: nil)
        }
      }
      store.execute(query)
    }
  }

  private func workouts(start: Date, end: Date) async throws -> (count: Int, minutes: Double) {
    let predicate = HKQuery.predicateForSamples(withStart: start, end: end, options: [.strictStartDate])
    return try await withCheckedThrowingContinuation { continuation in
      let query = HKSampleQuery(sampleType: HKObjectType.workoutType(), predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: nil) { _, samples, error in
        if isHealthKitNoDataError(error) {
          continuation.resume(returning: (0, 0))
        } else if let error {
          continuation.resume(throwing: error)
          return
        }
        let workouts = (samples ?? []).compactMap { $0 as? HKWorkout }
        let minutes = workouts.reduce(0) { $0 + ($1.duration / 60.0) }
        continuation.resume(returning: (workouts.count, minutes))
      }
      store.execute(query)
    }
  }

  private static let dateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.calendar = Calendar(identifier: .gregorian)
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyy-MM-dd"
    return formatter
  }()
}

private func isHealthKitNoDataError(_ error: Error?) -> Bool {
  guard let error else { return false }
  if let healthError = error as? HKError, healthError.code == .errorNoData {
    return true
  }
  return error.localizedDescription.localizedCaseInsensitiveContains("No data available")
}
#else

public final class AppleHealthSummaryProvider {
  public init() {}

  public func dailySummary(for date: Date = Date(), calendar: Calendar = .current) async throws -> GatewayAppleHealthSummary {
    throw GatewayAppleHealthError.unsupportedPlatform
  }
}
#endif
