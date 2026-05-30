#if canImport(SwiftUI)
import SwiftUI

extension Notification.Name {
  static let gatewayPlansPossiblyChanged = Notification.Name("gatewayPlansPossiblyChanged")
}

private struct TextEntryContext: Identifiable {
  enum Kind {
    case createGoal
    case editGoal(planID: String)
    case createMilestone(planID: String)
    case createTask(planID: String, milestoneID: String)
  }

  let id = UUID()
  let title: String
  let placeholder: String
  let initialValue: String
  let kind: Kind
}

private struct TextEntrySheet: View {
  let title: String
  let placeholder: String
  let initialValue: String
  let onSave: (String) -> Void
  @Environment(\.dismiss) private var dismiss
  @State private var value: String = ""

  var body: some View {
    NavigationStack {
      Form {
        TextField(placeholder, text: $value)
      }
      .navigationTitle(title)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") { dismiss() }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button("Save") {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return }
            onSave(trimmed)
            dismiss()
          }
        }
      }
    }
    .onAppear { value = initialValue }
  }
}

private struct PlanStatusChip: View {
  let status: GatewayPlanStatus

  private var color: Color {
    switch status {
    case .onTrack:
      return .green
    case .atRisk:
      return .orange
    case .blocked:
      return .red
    case .complete:
      return .blue
    }
  }

  var body: some View {
    Text(status.label)
      .font(.caption2)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(color.opacity(0.15))
      .foregroundStyle(color)
      .clipShape(Capsule())
  }
}

private func nextPlanStatus(_ current: GatewayPlanStatus) -> GatewayPlanStatus {
  let all = GatewayPlanStatus.allCases
  guard let index = all.firstIndex(of: current) else { return .onTrack }
  return all[(index + 1) % all.count]
}

struct LivePlanTrackerView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var plans: [GatewayPlanGoal] = []
  @State private var isLoading = false
  @State private var isSyncingHealth = false
  @State private var errorMessage: String?
  @State private var textEntryContext: TextEntryContext?

  var body: some View {
    NavigationStack {
      Group {
        if isLoading && plans.isEmpty {
          ProgressView("Loading plans…")
        } else if plans.isEmpty {
          ContentUnavailableView(
            "No goals yet",
            systemImage: "target",
            description: Text("Create a goal to start tracking milestones and tasks outside chat.")
          )
        } else {
          List {
            ForEach(plans) { plan in
              Section {
                VStack(alignment: .leading, spacing: 8) {
                  HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                      Text(plan.title)
                        .font(.subheadline.weight(.semibold))
                      if let vision = plan.vision, !vision.isEmpty {
                        Text(vision)
                          .font(.caption)
                          .foregroundStyle(.secondary)
                      }
                    }
                    Spacer(minLength: 12)
                    PlanStatusChip(status: plan.status)
                  }
                  ProgressView(value: Double(plan.progressPercent), total: 100)
                    .tint(.blue)
                  HStack {
                    Text("\(plan.progressPercent)% complete")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                    Spacer()
                    Text(plan.reviewCadence ?? "Review cadence unset")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.sourceSystems.isEmpty {
                    Text("Sources: \(plan.sourceSystems.joined(separator: " · "))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.metrics.isEmpty {
                    Text(plan.metrics.map { "\($0.label): \($0.value)" }.joined(separator: " · "))
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.objectives.isEmpty {
                    Text("Objectives: \(plan.objectives.joined(separator: " · "))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.principles.isEmpty {
                    Text("Principles: \(plan.principles.joined(separator: " · "))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.baselineFacts.isEmpty {
                    Text("Baseline: \(plan.baselineFacts.map { "\($0.label): \($0.value)" }.joined(separator: " · "))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.trackedMetrics.isEmpty {
                    Text("Track: " + plan.trackedMetrics.map { metric in
                      if let notes = metric.notes, !notes.isEmpty {
                        return "\(metric.name) (\(notes))"
                      }
                      return metric.name
                    }.joined(separator: " · "))
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.successCriteria.isEmpty {
                    Text("Success: \(plan.successCriteria.joined(separator: " · "))")
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.cadence.isEmpty {
                    Text("Cadence: " + plan.cadence.map { entry in
                      let prefix = entry.day ?? entry.label ?? "Session"
                      return "\(prefix): \(entry.activity)"
                    }.joined(separator: " · "))
                      .font(.caption)
                      .foregroundStyle(.secondary)
                  }
                  if !plan.supportingSections.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                      Text("Supporting material")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                      ForEach(plan.supportingSections, id: \.title) { section in
                        Text("\(section.title)\(section.summary.map { " — \($0)" } ?? "")")
                          .font(.caption2)
                          .foregroundStyle(.secondary)
                      }
                    }
                  }
                  HStack {
                    Button("Edit title") {
                      textEntryContext = TextEntryContext(
                        title: "Edit Goal",
                        placeholder: "Goal title",
                        initialValue: plan.title,
                        kind: .editGoal(planID: plan.id)
                      )
                    }
                    .buttonStyle(.borderless)
                    Button("Next status") {
                      Task {
                        await withMutation {
                          _ = try await model.chatClient.updatePlan(
                            baseURL: try baseURL(),
                            token: model.gatewayToken,
                            planID: plan.id,
                            title: nil,
                            status: nextPlanStatus(plan.status)
                          )
                        }
                      }
                    }
                    .buttonStyle(.borderless)
                  }
                  .font(.caption)
                }
              } header: {
                HStack {
                  Text("Goal")
                  Spacer()
                  Button(role: .destructive) {
                    Task {
                      await withMutation {
                        try await model.chatClient.deletePlan(
                          baseURL: try baseURL(),
                          token: model.gatewayToken,
                          planID: plan.id
                        )
                      }
                    }
                  } label: {
                    Image(systemName: "trash")
                  }
                  .buttonStyle(.plain)
                }
              }

              Section("Milestones") {
                ForEach(plan.milestones) { milestone in
                  VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .top) {
                      Text(milestone.title)
                        .font(.subheadline.weight(.medium))
                      Spacer(minLength: 12)
                      Button {
                        Task {
                          await withMutation {
                            try await model.chatClient.updateMilestone(
                              baseURL: try baseURL(),
                              token: model.gatewayToken,
                              planID: plan.id,
                              milestoneID: milestone.id,
                              status: nextPlanStatus(milestone.status)
                            )
                          }
                        }
                      } label: {
                        PlanStatusChip(status: milestone.status)
                      }
                      .buttonStyle(.plain)
                    }
                    ProgressView(value: Double(milestone.progressPercent), total: 100)
                      .tint(.blue)
                    HStack {
                      Text("\(milestone.progressPercent)% complete")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                      Spacer()
                      Button(role: .destructive) {
                        Task {
                          await withMutation {
                            try await model.chatClient.deleteMilestone(
                              baseURL: try baseURL(),
                              token: model.gatewayToken,
                              planID: plan.id,
                              milestoneID: milestone.id
                            )
                          }
                        }
                      } label: {
                        Label("Delete", systemImage: "trash")
                      }
                      .buttonStyle(.borderless)
                      .font(.caption)
                    }
                    ForEach(milestone.tasks) { task in
                      HStack(alignment: .top, spacing: 8) {
                        Text(task.title)
                          .font(.footnote)
                        Spacer(minLength: 8)
                        Button {
                          Task {
                            await withMutation {
                              try await model.chatClient.updateTask(
                                baseURL: try baseURL(),
                                token: model.gatewayToken,
                                planID: plan.id,
                                milestoneID: milestone.id,
                                taskID: task.id,
                                status: nextPlanStatus(task.status)
                              )
                            }
                          }
                        } label: {
                          PlanStatusChip(status: task.status)
                        }
                        .buttonStyle(.plain)
                        Button(role: .destructive) {
                          Task {
                            await withMutation {
                              try await model.chatClient.deleteTask(
                                baseURL: try baseURL(),
                                token: model.gatewayToken,
                                planID: plan.id,
                                milestoneID: milestone.id,
                                taskID: task.id
                              )
                            }
                          }
                        } label: {
                          Image(systemName: "trash")
                        }
                        .buttonStyle(.plain)
                      }
                    }
                    HStack {
                      Button("Add task") {
                        textEntryContext = TextEntryContext(
                          title: "New Task",
                          placeholder: "Task title",
                          initialValue: "",
                          kind: .createTask(planID: plan.id, milestoneID: milestone.id)
                        )
                      }
                      .buttonStyle(.borderless)
                    }
                    .font(.caption)
                  }
                  .padding(.vertical, 4)
                }
                Button("Add milestone") {
                  textEntryContext = TextEntryContext(
                    title: "New Milestone",
                    placeholder: "Milestone title",
                    initialValue: "",
                    kind: .createMilestone(planID: plan.id)
                  )
                }
              }
            }
          }
        }
      }
      .navigationTitle("Plan Tracker")
      .toolbar {
        #if os(macOS)
        ToolbarItem(placement: .automatic) {
          Button {
            textEntryContext = TextEntryContext(
              title: "New Goal",
              placeholder: "Goal title",
              initialValue: "",
              kind: .createGoal
            )
          } label: {
            Label("New Goal", systemImage: "plus")
          }
        }
        ToolbarItem(placement: .automatic) {
          Button {
            Task { await syncAppleHealth() }
          } label: {
            Label("Sync Health", systemImage: "heart.text.square")
          }
          .disabled(isSyncingHealth)
        }
        ToolbarItem(placement: .automatic) {
          Button {
            Task { await loadPlans() }
          } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
          }
          .disabled(isLoading)
        }
        #else
        ToolbarItem(placement: .topBarLeading) {
          Button {
            textEntryContext = TextEntryContext(
              title: "New Goal",
              placeholder: "Goal title",
              initialValue: "",
              kind: .createGoal
            )
          } label: {
            Label("New Goal", systemImage: "plus")
          }
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            Task { await syncAppleHealth() }
          } label: {
            Label("Sync Health", systemImage: "heart.text.square")
          }
          .disabled(isSyncingHealth)
        }
        ToolbarItem(placement: .topBarTrailing) {
          Button {
            Task { await loadPlans() }
          } label: {
            Label("Refresh", systemImage: "arrow.clockwise")
          }
          .disabled(isLoading)
        }
        #endif
      }
      .refreshable {
        await loadPlans()
      }
      .task {
        await loadPlans()
      }
      .onReceive(NotificationCenter.default.publisher(for: .gatewayPlansPossiblyChanged)) { _ in
        Task { await loadPlans() }
      }
      .sheet(item: $textEntryContext) { context in
        TextEntrySheet(
          title: context.title,
          placeholder: context.placeholder,
          initialValue: context.initialValue
        ) { value in
          Task {
            await withMutation {
              switch context.kind {
              case .createGoal:
                _ = try await model.chatClient.createPlan(
                  baseURL: try baseURL(),
                  token: model.gatewayToken,
                  title: value,
                  vision: nil
                )
              case let .editGoal(planID):
                _ = try await model.chatClient.updatePlan(
                  baseURL: try baseURL(),
                  token: model.gatewayToken,
                  planID: planID,
                  title: value,
                  status: nil
                )
              case let .createMilestone(planID):
                try await model.chatClient.createMilestone(
                  baseURL: try baseURL(),
                  token: model.gatewayToken,
                  planID: planID,
                  title: value
                )
              case let .createTask(planID, milestoneID):
                try await model.chatClient.createTask(
                  baseURL: try baseURL(),
                  token: model.gatewayToken,
                  planID: planID,
                  milestoneID: milestoneID,
                  title: value
                )
              }
            }
          }
        }
      }
      .alert("Plan tracker error", isPresented: Binding(
        get: { errorMessage != nil },
        set: { if !$0 { errorMessage = nil } }
      )) {
        Button("OK", role: .cancel) {}
      } message: {
        Text(errorMessage ?? "")
      }
    }
  }

  private func baseURL() throws -> URL {
    guard let baseURL = model.gatewayBaseURL else {
      throw GatewayChatError.missingConfiguration
    }
    return baseURL
  }

  private func loadPlans() async {
    guard let baseURL = model.gatewayBaseURL else { return }
    isLoading = true
    defer { isLoading = false }
    do {
      plans = try await model.chatClient.fetchPlans(
        baseURL: baseURL,
        token: model.gatewayToken
      )
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func syncAppleHealth() async {
    guard let baseURL = model.gatewayBaseURL else { return }
    isSyncingHealth = true
    defer { isSyncingHealth = false }
    do {
      let summary = try await AppleHealthSummaryProvider().dailySummary()
      _ = try await model.chatClient.syncPersonalDataBatch(
        baseURL: baseURL,
        token: model.gatewayToken,
        batch: summary.personalDataBatch()
      )
      _ = try await model.chatClient.syncAppleHealthSummary(
        baseURL: baseURL,
        token: model.gatewayToken,
        summary: summary
      )
      await loadPlans()
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
    }
  }

  private func withMutation(_ action: () async throws -> Void) async {
    do {
      try await action()
      await loadPlans()
      errorMessage = nil
    } catch {
      errorMessage = error.localizedDescription
      await loadPlans()
    }
  }
}
#endif
