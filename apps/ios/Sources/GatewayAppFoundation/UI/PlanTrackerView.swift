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
  @State private var value = ""

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

private struct PlanSectionEditContext: Identifiable {
  let id = UUID()
  let title: String
  let initialValue: String
  let onSave: (String) -> Void
}

private struct PlanSectionEditSheet: View {
  let context: PlanSectionEditContext
  @Environment(\.dismiss) private var dismiss
  @State private var value = ""

  var body: some View {
    NavigationStack {
      TextEditor(text: $value)
        .font(.body)
        .padding()
        .navigationTitle(context.title)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) {
            Button("Cancel") { dismiss() }
          }
          ToolbarItem(placement: .confirmationAction) {
            Button("Save") {
              context.onSave(value)
              dismiss()
            }
          }
        }
    }
    .onAppear { value = context.initialValue }
  }
}

private enum PlannerHorizon: String, CaseIterable, Identifiable {
  case nextDays
  case week
  case month
  case year

  var id: String { rawValue }

  var title: String {
    switch self {
    case .nextDays: return "Next Days"
    case .week: return "Week"
    case .month: return "Month"
    case .year: return "Year"
    }
  }

  var systemImage: String {
    switch self {
    case .nextDays: return "calendar.badge.clock"
    case .week: return "calendar"
    case .month: return "calendar.circle"
    case .year: return "chart.bar.xaxis"
    }
  }
}

private struct PlannerTaskContext: Identifiable {
  let plan: GatewayPlanGoal
  let milestone: GatewayPlanMilestone
  let task: GatewayPlanTask

  var id: String { "\(plan.id):\(milestone.id):\(task.id)" }
}

private struct PlanStatusChip: View {
  let status: GatewayPlanStatus

  private var color: Color {
    switch status {
    case .onTrack: return .green
    case .atRisk: return .orange
    case .blocked: return .red
    case .complete: return .blue
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

private struct TaskStatusChip: View {
  let status: GatewayPlanTaskStatus

  private var color: Color {
    switch status {
    case .todo: return .secondary
    case .inProgress: return .blue
    case .complete: return .green
    case .onHold: return .orange
    case .blocked: return .red
    }
  }

  var body: some View {
    Text(status.label)
      .font(.caption2)
      .padding(.horizontal, 8)
      .padding(.vertical, 4)
      .background(color.opacity(0.14))
      .foregroundStyle(color)
      .clipShape(Capsule())
  }
}

private struct TaskStatusMenu: View {
  let status: GatewayPlanTaskStatus
  let onChange: (GatewayPlanTaskStatus) -> Void

  var body: some View {
    Menu {
      ForEach(GatewayPlanTaskStatus.allCases, id: \.self) { candidate in
        Button {
          onChange(candidate)
        } label: {
          if candidate == status {
            Label(candidate.label, systemImage: "checkmark")
          } else {
            Text(candidate.label)
          }
        }
      }
    } label: {
      TaskStatusChip(status: status)
    }
    .buttonStyle(.plain)
  }
}

private struct PlannerTaskRow: View {
  let context: PlannerTaskContext
  let onStatusChange: (GatewayPlanTaskStatus) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top, spacing: 8) {
        Text(context.task.title)
          .font(.subheadline.weight(.semibold))
        Spacer(minLength: 8)
        TaskStatusMenu(status: context.task.status, onChange: onStatusChange)
      }
      Text(context.milestone.title)
        .font(.caption)
        .foregroundStyle(.secondary)
      Text(context.plan.title)
        .font(.caption2)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
  }
}

struct LivePlanTrackerView: View {
  @ObservedObject var model: GatewayAppViewModel
  @State private var plans: [GatewayPlanGoal] = []
  @State private var isLoading = false
  @State private var isSyncingHealth = false
  @State private var errorMessage: String?
  @State private var textEntryContext: TextEntryContext?

  private var allTaskContexts: [PlannerTaskContext] {
    plans.flatMap { plan in
      plan.milestones.flatMap { milestone in
        milestone.tasks.map { task in
          PlannerTaskContext(plan: plan, milestone: milestone, task: task)
        }
      }
    }
    .sorted { lhs, rhs in
      let leftStatus = statusOrder(lhs.task.status)
      let rightStatus = statusOrder(rhs.task.status)
      if leftStatus != rightStatus { return leftStatus < rightStatus }
      if lhs.plan.title != rhs.plan.title { return lhs.plan.title < rhs.plan.title }
      if lhs.milestone.orderIndex != rhs.milestone.orderIndex { return lhs.milestone.orderIndex < rhs.milestone.orderIndex }
      return lhs.task.orderIndex < rhs.task.orderIndex
    }
  }

  private var todayTasks: [PlannerTaskContext] {
    allTaskContexts.filter { $0.task.status != .complete && $0.task.status != .onHold }
  }

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
            Section("Today") {
              if todayTasks.isEmpty {
                Text("No active tasks for today.")
                  .foregroundStyle(.secondary)
              } else {
                ForEach(todayTasks) { context in
                  NavigationLink {
                    PlanTaskDetailView(
                      model: model,
                      context: context,
                      onReload: { Task { await loadPlans() } },
                      onStatusChange: { status in updateTask(context, status: status) }
                    )
                  } label: {
                    PlannerTaskRow(context: context) { status in
                      updateTask(context, status: status)
                    }
                  }
                }
              }
            }

            Section("Views") {
              ForEach(PlannerHorizon.allCases) { horizon in
                NavigationLink {
                  PlannerHorizonView(
                    model: model,
                    horizon: horizon,
                    plans: plans,
                    tasks: tasks(for: horizon),
                    onReload: { Task { await loadPlans() } },
                    onStatusChange: updateTask
                  )
                } label: {
                  Label(horizon.title, systemImage: horizon.systemImage)
                }
              }
            }

            Section("Goals & Projects") {
              ForEach(plans) { plan in
                NavigationLink {
                  PlanGoalDetailView(
                    model: model,
                    plan: plan,
                    onReload: { Task { await loadPlans() } },
                    onUpdatePlan: updatePlanDetails,
                    onStatusChange: updateTask
                  )
                } label: {
                  PlanSummaryRow(plan: plan)
                }
              }
            }
          }
        }
      }
      .navigationTitle("Planning")
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
          Task { await handleTextEntry(context, value: value) }
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

  private func tasks(for horizon: PlannerHorizon) -> [PlannerTaskContext] {
    switch horizon {
    case .nextDays:
      return allTaskContexts.filter { $0.task.status != .complete }
    case .week:
      return allTaskContexts.filter { $0.task.status != .complete }
    case .month:
      return allTaskContexts
    case .year:
      return allTaskContexts
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
      plans = try await model.chatClient.fetchPlans(baseURL: baseURL, token: model.gatewayToken)
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

  private func handleTextEntry(_ context: TextEntryContext, value: String) async {
    await withMutation {
      switch context.kind {
      case .createGoal:
        _ = try await model.chatClient.createPlan(baseURL: try baseURL(), token: model.gatewayToken, title: value, vision: nil)
      case let .editGoal(planID):
        _ = try await model.chatClient.updatePlan(baseURL: try baseURL(), token: model.gatewayToken, planID: planID, title: value, status: nil)
      case let .createMilestone(planID):
        try await model.chatClient.createMilestone(baseURL: try baseURL(), token: model.gatewayToken, planID: planID, title: value)
      case let .createTask(planID, milestoneID):
        try await model.chatClient.createTask(baseURL: try baseURL(), token: model.gatewayToken, planID: planID, milestoneID: milestoneID, title: value)
      }
    }
  }

  private func updateTask(_ context: PlannerTaskContext, status: GatewayPlanTaskStatus) {
    Task {
      await withMutation {
        try await model.chatClient.updateTask(
          baseURL: try baseURL(),
          token: model.gatewayToken,
          planID: context.plan.id,
          milestoneID: context.milestone.id,
          taskID: context.task.id,
          status: status
        )
      }
    }
  }

  private func updatePlanDetails(planID: String, update: GatewayPlanDetailsUpdate) {
    Task {
      await withMutation {
        _ = try await model.chatClient.updatePlanDetails(
          baseURL: try baseURL(),
          token: model.gatewayToken,
          planID: planID,
          update: update
        )
      }
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

private struct PlannerHorizonView: View {
  let model: GatewayAppViewModel
  let horizon: PlannerHorizon
  let plans: [GatewayPlanGoal]
  let tasks: [PlannerTaskContext]
  let onReload: () -> Void
  let onStatusChange: (PlannerTaskContext, GatewayPlanTaskStatus) -> Void

  var body: some View {
    List {
      switch horizon {
      case .nextDays:
        taskListSection(title: "Next Days", tasks: tasks)
      case .week:
        ForEach(GatewayPlanTaskStatus.allCases, id: \.self) { status in
          let matching = tasks.filter { $0.task.status == status }
          if !matching.isEmpty {
            taskListSection(title: status.label, tasks: matching)
          }
        }
      case .month:
        ForEach(plans) { plan in
          Section(plan.title) {
            ForEach(plan.milestones) { milestone in
              NavigationLink {
                PlanMilestoneDetailView(
                  model: model,
                  plan: plan,
                  milestone: milestone,
                  onReload: onReload,
                  onStatusChange: onStatusChange
                )
              } label: {
                MilestoneSummaryRow(milestone: milestone)
              }
            }
          }
        }
      case .year:
        ForEach(plans) { plan in
          NavigationLink {
            PlanGoalDetailView(
              model: model,
              plan: plan,
              onReload: onReload,
              onUpdatePlan: { _, _ in },
              onStatusChange: onStatusChange
            )
          } label: {
            PlanSummaryRow(plan: plan)
          }
        }
      }
    }
    .navigationTitle(horizon.title)
  }

  @ViewBuilder
  private func taskListSection(title: String, tasks: [PlannerTaskContext]) -> some View {
    Section(title) {
      if tasks.isEmpty {
        Text("No tasks")
          .foregroundStyle(.secondary)
      } else {
        ForEach(tasks) { context in
          NavigationLink {
            PlanTaskDetailView(
              model: model,
              context: context,
              onReload: onReload,
              onStatusChange: { status in onStatusChange(context, status) }
            )
          } label: {
            PlannerTaskRow(context: context) { status in
              onStatusChange(context, status)
            }
          }
        }
      }
    }
  }
}

private struct PlanSummaryRow: View {
  let plan: GatewayPlanGoal

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack(alignment: .top) {
        Text(plan.title)
          .font(.subheadline.weight(.semibold))
        Spacer(minLength: 8)
        PlanStatusChip(status: plan.status)
      }
      ProgressView(value: Double(plan.progressPercent), total: 100)
      Text("\(plan.progressPercent)% complete")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
  }
}

private struct MilestoneSummaryRow: View {
  let milestone: GatewayPlanMilestone

  var body: some View {
    VStack(alignment: .leading, spacing: 6) {
      HStack {
        Text(milestone.title)
          .font(.subheadline.weight(.medium))
        Spacer()
        PlanStatusChip(status: milestone.status)
      }
      ProgressView(value: Double(milestone.progressPercent), total: 100)
      Text("\(milestone.tasks.count) tasks")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .padding(.vertical, 4)
  }
}

private struct PlanTaskDetailView: View {
  let model: GatewayAppViewModel
  let context: PlannerTaskContext
  let onReload: () -> Void
  let onStatusChange: (GatewayPlanTaskStatus) -> Void

  var body: some View {
    List {
      Section("Task") {
        Text(context.task.title)
          .font(.headline)
        TaskStatusMenu(status: context.task.status, onChange: onStatusChange)
        if let notes = context.task.notes, !notes.isEmpty {
          Text(notes)
        }
      }

      Section("Milestone") {
        NavigationLink {
          PlanMilestoneDetailView(
            model: model,
            plan: context.plan,
            milestone: context.milestone,
            onReload: onReload,
            onStatusChange: { taskContext, status in
              if taskContext.task.id == context.task.id {
                onStatusChange(status)
              }
            }
          )
        } label: {
          MilestoneSummaryRow(milestone: context.milestone)
        }
      }

      Section("Goal") {
        NavigationLink {
          PlanGoalDetailView(
            model: model,
            plan: context.plan,
            onReload: onReload,
            onUpdatePlan: { _, _ in },
            onStatusChange: { taskContext, status in
              if taskContext.task.id == context.task.id {
                onStatusChange(status)
              }
            }
          )
        } label: {
          PlanSummaryRow(plan: context.plan)
        }
      }
    }
    .navigationTitle("Task")
  }
}

private struct PlanMilestoneDetailView: View {
  let model: GatewayAppViewModel
  let plan: GatewayPlanGoal
  let milestone: GatewayPlanMilestone
  let onReload: () -> Void
  let onStatusChange: (PlannerTaskContext, GatewayPlanTaskStatus) -> Void

  var body: some View {
    List {
      Section("Milestone") {
        Text(milestone.title)
          .font(.headline)
        PlanStatusChip(status: milestone.status)
        if let notes = milestone.notes, !notes.isEmpty {
          Text(notes)
        }
        ProgressView(value: Double(milestone.progressPercent), total: 100)
      }

      Section("Tasks") {
        ForEach(milestone.tasks.map { PlannerTaskContext(plan: plan, milestone: milestone, task: $0) }) { context in
          NavigationLink {
            PlanTaskDetailView(
              model: model,
              context: context,
              onReload: onReload,
              onStatusChange: { status in onStatusChange(context, status) }
            )
          } label: {
            PlannerTaskRow(context: context) { status in
              onStatusChange(context, status)
            }
          }
        }
      }

      Section("Goal") {
        NavigationLink {
          PlanGoalDetailView(
            model: model,
            plan: plan,
            onReload: onReload,
            onUpdatePlan: { _, _ in },
            onStatusChange: onStatusChange
          )
        } label: {
          PlanSummaryRow(plan: plan)
        }
      }
    }
    .navigationTitle("Milestone")
  }
}

private struct PlanGoalDetailView: View {
  let model: GatewayAppViewModel
  let plan: GatewayPlanGoal
  let onReload: () -> Void
  let onUpdatePlan: (String, GatewayPlanDetailsUpdate) -> Void
  let onStatusChange: (PlannerTaskContext, GatewayPlanTaskStatus) -> Void

  @State private var editContext: PlanSectionEditContext?

  var body: some View {
    List {
      Section("Goal") {
        PlanSummaryRow(plan: plan)
        if let category = plan.category, !category.isEmpty {
          Text(category)
            .foregroundStyle(.secondary)
        }
      }

      EditablePlanSection(title: "Vision", text: plan.vision ?? "") {
        editContext = PlanSectionEditContext(title: "Vision", initialValue: plan.vision ?? "") { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(vision: cleanOptional(value)))
        }
      }
      EditablePlanSection(title: "Objectives", text: joinedLines(plan.objectives)) {
        editContext = PlanSectionEditContext(title: "Objectives", initialValue: joinedLines(plan.objectives)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(objectives: lines(value)))
        }
      }
      EditablePlanSection(title: "Principles", text: joinedLines(plan.principles)) {
        editContext = PlanSectionEditContext(title: "Principles", initialValue: joinedLines(plan.principles)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(principles: lines(value)))
        }
      }
      EditablePlanSection(title: "Baseline", text: factsText(plan.baselineFacts)) {
        editContext = PlanSectionEditContext(title: "Baseline", initialValue: factsText(plan.baselineFacts)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(baselineFacts: facts(value)))
        }
      }
      EditablePlanSection(title: "Metrics", text: metricsText(plan.metrics)) {
        editContext = PlanSectionEditContext(title: "Metrics", initialValue: metricsText(plan.metrics)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(metrics: metrics(value)))
        }
      }
      EditablePlanSection(title: "Success Criteria", text: joinedLines(plan.successCriteria)) {
        editContext = PlanSectionEditContext(title: "Success Criteria", initialValue: joinedLines(plan.successCriteria)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(successCriteria: lines(value)))
        }
      }
      EditablePlanSection(title: "Cadence", text: cadenceText(plan.cadence)) {
        editContext = PlanSectionEditContext(title: "Cadence", initialValue: cadenceText(plan.cadence)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(cadence: cadence(value)))
        }
      }
      EditablePlanSection(title: "Tags", text: joinedLines(plan.tags)) {
        editContext = PlanSectionEditContext(title: "Tags", initialValue: joinedLines(plan.tags)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(tags: lines(value)))
        }
      }
      EditablePlanSection(title: "Sources", text: joinedLines(plan.sourceSystems)) {
        editContext = PlanSectionEditContext(title: "Sources", initialValue: joinedLines(plan.sourceSystems)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(sourceSystems: lines(value)))
        }
      }
      EditablePlanSection(title: "Supporting Material", text: supportingText(plan.supportingSections)) {
        editContext = PlanSectionEditContext(title: "Supporting Material", initialValue: supportingText(plan.supportingSections)) { value in
          onUpdatePlan(plan.id, GatewayPlanDetailsUpdate(supportingSections: supportingSections(value)))
        }
      }

      Section("Milestones") {
        ForEach(plan.milestones) { milestone in
          NavigationLink {
            PlanMilestoneDetailView(
              model: model,
              plan: plan,
              milestone: milestone,
              onReload: onReload,
              onStatusChange: onStatusChange
            )
          } label: {
            MilestoneSummaryRow(milestone: milestone)
          }
        }
      }
    }
    .navigationTitle("Details")
    .sheet(item: $editContext) { context in
      PlanSectionEditSheet(context: context)
    }
  }
}

private struct EditablePlanSection: View {
  let title: String
  let text: String
  let onEdit: () -> Void
  @State private var isExpanded = false

  var body: some View {
    Section {
      DisclosureGroup(isExpanded: $isExpanded) {
        VStack(alignment: .leading, spacing: 8) {
          if text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text("Empty")
              .foregroundStyle(.secondary)
          } else {
            Text(text)
              .font(.body)
          }
          Button("Edit", action: onEdit)
        }
        .padding(.vertical, 4)
      } label: {
        Text(title)
          .font(.subheadline.weight(.semibold))
      }
    }
  }
}

private func statusOrder(_ status: GatewayPlanTaskStatus) -> Int {
  switch status {
  case .todo: return 0
  case .inProgress: return 1
  case .complete: return 2
  case .onHold: return 3
  case .blocked: return 4
  }
}

private func cleanOptional(_ value: String) -> String? {
  let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
  return trimmed.isEmpty ? nil : trimmed
}

private func lines(_ text: String) -> [String] {
  text.components(separatedBy: .newlines)
    .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
    .filter { !$0.isEmpty }
}

private func joinedLines(_ values: [String]) -> String {
  values.joined(separator: "\n")
}

private func factsText(_ values: [GatewayPlanFact]) -> String {
  values.map { "\($0.label): \($0.value)" }.joined(separator: "\n")
}

private func facts(_ text: String) -> [GatewayPlanFact] {
  keyValueLines(text).map { GatewayPlanFact(label: $0.0, value: $0.1) }
}

private func metricsText(_ values: [GatewayPlanMetric]) -> String {
  values.map { "\($0.label): \($0.value)" }.joined(separator: "\n")
}

private func metrics(_ text: String) -> [GatewayPlanMetric] {
  keyValueLines(text).map { GatewayPlanMetric(label: $0.0, value: $0.1) }
}

private func cadenceText(_ values: [GatewayPlanCadenceEntry]) -> String {
  values.map { entry in
    let label = entry.day ?? entry.label ?? "Session"
    if let notes = entry.notes, !notes.isEmpty {
      return "\(label): \(entry.activity) (\(notes))"
    }
    return "\(label): \(entry.activity)"
  }.joined(separator: "\n")
}

private func cadence(_ text: String) -> [GatewayPlanCadenceEntry] {
  keyValueLines(text).map { GatewayPlanCadenceEntry(label: $0.0, day: nil, activity: $0.1, notes: nil) }
}

private func supportingText(_ values: [GatewayPlanSupportingSection]) -> String {
  values.map { section in
    if let summary = section.summary, !summary.isEmpty {
      return "\(section.title): \(summary)"
    }
    let items = section.items.compactMap { $0.content ?? $0.uri }.joined(separator: " ")
    return items.isEmpty ? section.title : "\(section.title): \(items)"
  }.joined(separator: "\n")
}

private func supportingSections(_ text: String) -> [GatewayPlanSupportingSection] {
  keyValueLines(text).map {
    GatewayPlanSupportingSection(
      title: $0.0,
      kind: nil,
      summary: $0.1,
      items: []
    )
  }
}

private func keyValueLines(_ text: String) -> [(String, String)] {
  lines(text).compactMap { line in
    guard let separator = line.firstIndex(of: ":") else { return (line, "") }
    let key = String(line[..<separator]).trimmingCharacters(in: .whitespacesAndNewlines)
    let value = String(line[line.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
    return key.isEmpty ? nil : (key, value)
  }
}

#endif