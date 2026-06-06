import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type {
  ImportPlanRequest,
  PlanCadenceEntry,
  PlanFact,
  PlanGoal,
  PlanMilestone,
  PlanMetric,
  PlanStatus,
  PlanSupportingSection,
  PlanTask,
  PlanTaskStatus,
  PlanTrackedMetric,
} from '@gateway/shared'
import PlanCalendarView from '../components/PlanCalendarView'
import { usePlans } from '../hooks/usePlans'

type PlanningTab = 'overview' | 'tasks' | 'timeline'

const PLAN_STATUS_LABEL: Record<PlanStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
}

const PLAN_STATUS_CLASS: Record<PlanStatus, string> = {
  on_track: 'border-emerald-700/50 bg-emerald-950/50 text-emerald-200',
  at_risk: 'border-amber-700/50 bg-amber-950/50 text-amber-200',
  blocked: 'border-rose-700/50 bg-rose-950/50 text-rose-200',
  complete: 'border-sky-700/50 bg-sky-950/50 text-sky-200',
}

const TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  complete: 'Complete',
  on_hold: "Won't do",
  blocked: 'Blocked',
}

const TASK_STATUS_CLASS: Record<PlanTaskStatus, string> = {
  todo: 'border-gray-700 bg-gray-800/80 text-gray-200',
  in_progress: 'border-blue-700/50 bg-blue-950/50 text-blue-200',
  complete: 'border-emerald-700/50 bg-emerald-950/50 text-emerald-200',
  on_hold: 'border-amber-700/50 bg-amber-950/50 text-amber-200',
  blocked: 'border-rose-700/50 bg-rose-950/50 text-rose-200',
}

interface TaskEntry {
  milestone: PlanMilestone
  task: PlanTask
}

function pct(value: number): string {
  const bounded = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0))
  return `${bounded}%`
}

function progressBar(value: number): string {
  return `${Math.max(0, Math.min(100, value))}%`
}

function metricSummary(metrics: PlanMetric[]): string {
  if (metrics.length === 0) return 'No plan-level metrics'
  return metrics.slice(0, 2).map((metric) => `${metric.label}: ${metric.value}`).join(' · ')
}

function flattenTasks(plan: PlanGoal): TaskEntry[] {
  return plan.milestones.flatMap((milestone) => milestone.tasks.map((task) => ({ milestone, task })))
}

function counts(plan: PlanGoal) {
  const tasks = flattenTasks(plan)
  const complete = tasks.filter(({ task }) => task.status === 'complete').length
  const blocked = tasks.filter(({ task }) => task.status === 'blocked').length
  const wontDo = tasks.filter(({ task }) => task.status === 'on_hold').length
  return {
    tasks: tasks.length,
    complete,
    blocked,
    wontDo,
    milestones: plan.milestones.length,
  }
}

function dateSummary(milestone: PlanMilestone, task?: PlanTask): string | null {
  if (task) {
    return task.dueAt ?? task.targetAt ?? task.startAt ?? task.scheduledAt ?? null
  }
  return milestone.targetDate ?? milestone.endDate ?? milestone.startDate ?? milestone.scheduledDate ?? null
}

function renderStringList(title: string, items: string[]) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <ul className="mt-3 space-y-2 text-sm text-gray-300">
        {items.map((item) => (
          <li key={item} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
            {item}
          </li>
        ))}
      </ul>
    </section>
  )
}

function renderFacts(title: string, items: PlanFact[]) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <div key={`${item.label}-${item.value}`} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">{item.label}</p>
            <p className="mt-1 text-sm text-gray-200">{item.value}</p>
          </div>
        ))}
      </div>
    </section>
  )
}

function renderTrackedMetrics(items: PlanTrackedMetric[]) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <h3 className="text-sm font-semibold text-white">Metrics to Track</h3>
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {items.map((metric) => (
          <div key={metric.name} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-gray-100">{metric.name}</p>
                {metric.notes && <p className="mt-1 text-sm text-gray-400">{metric.notes}</p>}
              </div>
              {metric.cadence && (
                <span className="rounded-full border border-gray-700 px-2 py-1 text-[11px] uppercase tracking-wide text-gray-400">
                  {metric.cadence}
                </span>
              )}
            </div>
            {(metric.baseline || metric.target || metric.source) && (
              <div className="mt-3 grid gap-2 text-xs text-gray-400 sm:grid-cols-3">
                {metric.baseline && <div><span className="text-gray-500">Baseline:</span> {metric.baseline}</div>}
                {metric.target && <div><span className="text-gray-500">Target:</span> {metric.target}</div>}
                {metric.source && <div><span className="text-gray-500">Source:</span> {metric.source}</div>}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

function renderCadence(items: PlanCadenceEntry[]) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <h3 className="text-sm font-semibold text-white">Cadence</h3>
      <div className="mt-3 grid gap-2 lg:grid-cols-2">
        {items.map((entry, index) => (
          <div key={`${entry.day ?? entry.label ?? entry.activity}-${index}`} className="rounded-xl border border-gray-800 bg-gray-950/60 px-3 py-2">
            <p className="text-xs uppercase tracking-wide text-gray-500">{entry.day ?? entry.label ?? 'Session'}</p>
            <p className="mt-1 text-sm text-gray-200">{entry.activity}</p>
            {entry.notes && <p className="mt-1 text-xs text-gray-400">{entry.notes}</p>}
          </div>
        ))}
      </div>
    </section>
  )
}

function renderSupportingSections(items: PlanSupportingSection[]) {
  if (items.length === 0) return null
  return (
    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
      <h3 className="text-sm font-semibold text-white">Supporting Material</h3>
      <div className="mt-3 space-y-3">
        {items.map((section) => (
          <div key={section.title} className="rounded-xl border border-gray-800 bg-gray-950/60 p-3">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-100">{section.title}</h4>
              {section.kind && (
                <span className="rounded-full border border-gray-700 px-2 py-0.5 text-[11px] uppercase tracking-wide text-gray-400">
                  {section.kind}
                </span>
              )}
            </div>
            {section.summary && <p className="mt-2 text-sm text-gray-400">{section.summary}</p>}
            {section.items.length > 0 && (
              <div className="mt-3 space-y-2">
                {section.items.map((item, index) => (
                  <div key={`${section.title}-${item.label ?? item.uri ?? index}`} className="rounded-lg border border-gray-800 bg-black/20 px-3 py-2 text-sm text-gray-300">
                    <p className="text-xs uppercase tracking-wide text-gray-500">{item.label ?? item.kind ?? 'Reference'}</p>
                    {item.uri ? (
                      <a className="mt-1 inline-block text-blue-300 underline hover:text-blue-200" href={item.uri} target="_blank" rel="noreferrer">
                        {item.uri}
                      </a>
                    ) : (
                      <p className="mt-1">{item.content}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function PlanningPage() {
  const plans = usePlans()
  const importInputRef = useRef<HTMLInputElement>(null)
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<PlanningTab>('overview')
  const [importTargetPlanId, setImportTargetPlanId] = useState<string | null>(null)

  useEffect(() => {
    void plans.refresh()
  }, [plans.refresh])

  useEffect(() => {
    if (plans.plans.length === 0) {
      setSelectedPlanId(null)
      return
    }
    if (!selectedPlanId || !plans.plans.some((plan) => plan.id === selectedPlanId)) {
      setSelectedPlanId(plans.plans[0].id)
    }
  }, [plans.plans, selectedPlanId])

  const selectedPlan = useMemo(
    () => plans.plans.find((plan) => plan.id === selectedPlanId) ?? null,
    [plans.plans, selectedPlanId],
  )

  const selectedCounts = selectedPlan ? counts(selectedPlan) : null
  const selectedTasks = useMemo(() => (selectedPlan ? flattenTasks(selectedPlan) : []), [selectedPlan])

  const handleCreatePlan = async () => {
    const title = window.prompt('New plan title')
    if (!title?.trim()) return
    const vision = window.prompt('Vision / target (optional)') ?? undefined
    await plans.create({ title: title.trim(), vision: vision?.trim() || undefined })
  }

  const handleImportFile = async (file: File | null) => {
    if (!file) return
    try {
      const text = (await file.text()).trim()
      if (!text) return
      const targetPlan = importTargetPlanId ? plans.plans.find((plan) => plan.id === importTargetPlanId) : undefined
      const fallbackTitle = targetPlan?.title ?? file.name.replace(/\.[^.]+$/, '').trim()
      const fallbackSource = file.name.trim()
      const payload: ImportPlanRequest = {
        planId: importTargetPlanId ?? undefined,
        title: fallbackTitle || undefined,
        source: fallbackSource || undefined,
        text,
      }
      await plans.importDocument(payload)
    } finally {
      setImportTargetPlanId(null)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const handleExport = async (planId: string) => {
    const exported = await plans.exportDocument(planId)
    const blob = new Blob([exported.document], { type: exported.contentType })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = exported.filename
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  const handleEditPlan = async (plan: PlanGoal) => {
    const title = window.prompt('Plan title', plan.title)
    if (!title?.trim()) return
    const vision = window.prompt('Vision / target', plan.vision ?? '') ?? ''
    await plans.patchPlan(plan.id, { title: title.trim(), vision: vision.trim() || undefined })
  }

  const dashboardEmpty = !plans.loading && plans.plans.length === 0

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <input
        ref={importInputRef}
        type="file"
        accept=".json,.yaml,.yml,.txt,.md,.markdown,application/json,application/yaml,text/yaml,text/plain,text/markdown"
        className="hidden"
        onChange={(event) => {
          void handleImportFile(event.target.files?.[0] ?? null)
        }}
      />

      <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="rounded-3xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 px-6 py-6 shadow-2xl shadow-black/30">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-3xl">
              <p className="text-xs uppercase tracking-[0.3em] text-blue-300/80">Planning Workspace</p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Project dashboard for durable goals, milestones, and work sequencing.</h1>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-400">
                This screen is the planning surface, not a chat sidebar clone. Use it to review plan structure, work task lists, import or update plan documents, and keep durable state aligned with agent-service.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void plans.refresh()}
                className="rounded-full border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={handleCreatePlan}
                className="rounded-full border border-blue-700 bg-blue-500/10 px-4 py-2 text-sm text-blue-200 transition hover:border-blue-500 hover:bg-blue-500/20"
              >
                New plan
              </button>
              <button
                type="button"
                onClick={() => {
                  setImportTargetPlanId(null)
                  importInputRef.current?.click()
                }}
                className="rounded-full border border-emerald-700 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-500/20"
              >
                Import plan
              </button>
              <Link
                to="/"
                className="rounded-full border border-gray-700 px-4 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
              >
                Back to chat
              </Link>
            </div>
          </div>
        </header>

        <div className="mt-6 grid flex-1 gap-6 xl:grid-cols-[320px,minmax(0,1fr)]">
          <aside className="rounded-3xl border border-gray-800 bg-gray-900/80 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-white">Plans</h2>
                <p className="text-xs text-gray-500">{plans.plans.length} active</p>
              </div>
            </div>

            {plans.loading && <p className="text-sm text-gray-500">Loading plans…</p>}
            {plans.error && <p className="mb-3 rounded-2xl border border-rose-800/60 bg-rose-950/30 px-3 py-2 text-sm text-rose-300">{plans.error}</p>}
            {dashboardEmpty && (
              <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-6 text-sm text-gray-400">
                No plans yet. Import a structured plan or create one directly from this workspace.
              </div>
            )}

            <div className="space-y-3">
              {plans.plans.map((plan) => {
                const summary = counts(plan)
                const selected = plan.id === selectedPlanId
                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlanId(plan.id)}
                    className={`w-full rounded-2xl border p-4 text-left transition ${
                      selected
                        ? 'border-blue-600 bg-blue-500/10 shadow-lg shadow-blue-950/20'
                        : 'border-gray-800 bg-gray-950/50 hover:border-gray-700 hover:bg-gray-900'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{plan.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs text-gray-400">{plan.vision || 'No target written yet'}</p>
                      </div>
                      <span className={`rounded-full border px-2 py-1 text-[11px] ${PLAN_STATUS_CLASS[plan.status]}`}>
                        {PLAN_STATUS_LABEL[plan.status]}
                      </span>
                    </div>
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full rounded-full bg-blue-500" style={{ width: progressBar(plan.progressPercent) }} />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-400">
                      <div>{summary.milestones} milestone(s)</div>
                      <div>{summary.tasks} task(s)</div>
                      <div>{summary.complete} complete</div>
                      <div>{summary.blocked} blocked</div>
                    </div>
                    <p className="mt-3 text-[11px] text-gray-500">{metricSummary(plan.metrics)}</p>
                  </button>
                )
              })}
            </div>
          </aside>

          <main className="min-w-0 rounded-3xl border border-gray-800 bg-gray-900/80 p-5">
            {!selectedPlan ? (
              <div className="flex h-full min-h-[420px] items-center justify-center rounded-3xl border border-dashed border-gray-700 text-center">
                <div className="max-w-md px-6">
                  <h2 className="text-lg font-semibold text-white">Select a plan</h2>
                  <p className="mt-2 text-sm text-gray-400">
                    The main workspace shows one plan at a time so you can actually work it instead of skimming a pile of collapsed cards.
                  </p>
                </div>
              </div>
            ) : (
              <>
                <section className="rounded-3xl border border-gray-800 bg-gradient-to-br from-gray-900 via-gray-900 to-gray-950 p-5">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2.5 py-1 text-xs ${PLAN_STATUS_CLASS[selectedPlan.status]}`}>
                          {PLAN_STATUS_LABEL[selectedPlan.status]}
                        </span>
                        {selectedPlan.category && (
                          <span className="rounded-full border border-gray-700 px-2.5 py-1 text-xs uppercase tracking-wide text-gray-400">
                            {selectedPlan.category}
                          </span>
                        )}
                        {selectedPlan.reviewCadence && (
                          <span className="rounded-full border border-gray-700 px-2.5 py-1 text-xs text-gray-400">
                            Review: {selectedPlan.reviewCadence}
                          </span>
                        )}
                      </div>
                      <h2 className="mt-4 text-2xl font-semibold text-white">{selectedPlan.title}</h2>
                      <p className="mt-2 max-w-4xl text-sm leading-6 text-gray-400">{selectedPlan.vision || 'No target written yet.'}</p>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:max-w-sm lg:justify-end">
                      <button
                        type="button"
                        onClick={() => void handleEditPlan(selectedPlan)}
                        className="rounded-full border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                      >
                        Edit plan
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleExport(selectedPlan.id)}
                        className="rounded-full border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                      >
                        Export
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setImportTargetPlanId(selectedPlan.id)
                          importInputRef.current?.click()
                        }}
                        className="rounded-full border border-emerald-700 px-3 py-2 text-sm text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-500/10"
                      >
                        Import update
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!window.confirm(`Delete "${selectedPlan.title}" and all of its milestones and tasks?`)) return
                          void plans.remove(selectedPlan.id)
                        }}
                        className="rounded-full border border-rose-700 px-3 py-2 text-sm text-rose-200 transition hover:border-rose-500 hover:bg-rose-500/10"
                      >
                        Delete plan
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                    <div className="rounded-2xl border border-gray-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Progress</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{pct(selectedPlan.progressPercent)}</p>
                      <div className="mt-3 h-2 overflow-hidden rounded-full bg-gray-800">
                        <div className="h-full rounded-full bg-blue-500" style={{ width: progressBar(selectedPlan.progressPercent) }} />
                      </div>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Milestones</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{selectedCounts?.milestones ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Tasks</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{selectedCounts?.tasks ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Complete</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{selectedCounts?.complete ?? 0}</p>
                    </div>
                    <div className="rounded-2xl border border-gray-800 bg-black/20 p-4">
                      <p className="text-xs uppercase tracking-wide text-gray-500">Needs attention</p>
                      <p className="mt-2 text-2xl font-semibold text-white">{(selectedCounts?.blocked ?? 0) + (selectedCounts?.wontDo ?? 0)}</p>
                    </div>
                  </div>
                </section>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex rounded-full border border-gray-800 bg-gray-950/70 p-1">
                    {(['overview', 'tasks', 'timeline'] as PlanningTab[]).map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setActiveTab(tab)}
                        className={`rounded-full px-4 py-2 text-sm capitalize transition ${
                          activeTab === tab ? 'bg-blue-500 text-white' : 'text-gray-300 hover:text-white'
                        }`}
                      >
                        {tab}
                      </button>
                    ))}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const title = window.prompt('New milestone title')
                        if (!title?.trim()) return
                        void plans.addMilestone({ planId: selectedPlan.id, title: title.trim() })
                      }}
                      className="rounded-full border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                    >
                      Add milestone
                    </button>
                    {selectedPlan.milestones[0] && (
                      <button
                        type="button"
                        onClick={() => {
                          const title = window.prompt('New task title')
                          if (!title?.trim()) return
                          void plans.addTask({
                            planId: selectedPlan.id,
                            milestoneId: selectedPlan.milestones[0].id,
                            title: title.trim(),
                          })
                        }}
                        className="rounded-full border border-gray-700 px-3 py-2 text-sm text-gray-200 transition hover:border-gray-500 hover:text-white"
                      >
                        Quick add task
                      </button>
                    )}
                  </div>
                </div>

                {activeTab === 'overview' && (
                  <div className="mt-6 space-y-6">
                    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr),minmax(0,0.8fr)]">
                      <div className="space-y-6">
                        {renderStringList('Objectives', selectedPlan.objectives)}
                        {renderStringList('Core Principles', selectedPlan.principles)}
                        {renderStringList('Success Criteria', selectedPlan.successCriteria)}
                        {renderTrackedMetrics(selectedPlan.trackedMetrics)}
                      </div>
                      <div className="space-y-6">
                        {renderFacts('Starting Metrics', selectedPlan.baselineFacts)}
                        {renderCadence(selectedPlan.cadence)}
                        {renderSupportingSections(selectedPlan.supportingSections)}
                      </div>
                    </section>

                    <section className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-white">Milestones</h3>
                          <p className="text-sm text-gray-500">This plan’s sequenced work. Click in and operate at the milestone or task layer.</p>
                        </div>
                      </div>
                      <div className="mt-4 space-y-4">
                        {selectedPlan.milestones.map((milestone) => (
                          <article key={milestone.id} className="rounded-2xl border border-gray-800 bg-gray-950/60 p-4">
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                              <div>
                                <div className="flex items-center gap-2">
                                  <h4 className="text-base font-medium text-white">{milestone.title}</h4>
                                  <span className={`rounded-full border px-2 py-1 text-[11px] ${PLAN_STATUS_CLASS[milestone.status]}`}>
                                    {PLAN_STATUS_LABEL[milestone.status]}
                                  </span>
                                </div>
                                {milestone.notes && <p className="mt-2 text-sm text-gray-400">{milestone.notes}</p>}
                                <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                                  <span>{milestone.tasks.length} task(s)</span>
                                  <span>{milestone.progressPercent}% complete</span>
                                  {dateSummary(milestone) && <span>{dateSummary(milestone)}</span>}
                                </div>
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white"
                                  onClick={() => {
                                    const title = window.prompt('New task title')
                                    if (!title?.trim()) return
                                    void plans.addTask({ planId: selectedPlan.id, milestoneId: milestone.id, title: title.trim() })
                                  }}
                                >
                                  Add task
                                </button>
                                <button
                                  type="button"
                                  className="rounded-full border border-rose-700 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-500 hover:bg-rose-500/10"
                                  onClick={() => {
                                    if (!window.confirm(`Delete milestone "${milestone.title}"?`)) return
                                    void plans.removeMilestone(selectedPlan.id, milestone.id)
                                  }}
                                >
                                  Delete milestone
                                </button>
                              </div>
                            </div>

                            {milestone.tasks.length > 0 ? (
                              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                                {milestone.tasks.map((task) => (
                                  <div key={task.id} className="rounded-xl border border-gray-800 bg-black/20 p-3">
                                    <div className="flex items-start justify-between gap-3">
                                      <div>
                                        <p className="text-sm font-medium text-gray-100">{task.title}</p>
                                        {task.notes && <p className="mt-1 text-sm text-gray-400">{task.notes}</p>}
                                      </div>
                                      <span className={`rounded-full border px-2 py-1 text-[11px] ${TASK_STATUS_CLASS[task.status]}`}>
                                        {TASK_STATUS_LABEL[task.status]}
                                      </span>
                                    </div>
                                    <div className="mt-3 flex flex-wrap gap-2">
                                      {task.status !== 'complete' && (
                                        <button
                                          type="button"
                                          className="rounded-full border border-emerald-700 px-2.5 py-1 text-xs text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-500/10"
                                          onClick={() => void plans.updateTaskStatus(selectedPlan.id, milestone.id, task.id, 'complete')}
                                        >
                                          Mark done
                                        </button>
                                      )}
                                      {task.status !== 'on_hold' && (
                                        <button
                                          type="button"
                                          className="rounded-full border border-amber-700 px-2.5 py-1 text-xs text-amber-200 transition hover:border-amber-500 hover:bg-amber-500/10"
                                          onClick={() => void plans.updateTaskStatus(selectedPlan.id, milestone.id, task.id, 'on_hold')}
                                        >
                                          Won't do
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="rounded-full border border-gray-700 px-2.5 py-1 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white"
                                        onClick={() => {
                                          const title = window.prompt('Edit task title', task.title)
                                          if (!title?.trim()) return
                                          const notes = window.prompt('Edit task notes', task.notes ?? '') ?? ''
                                          void plans.patchTask(selectedPlan.id, milestone.id, task.id, {
                                            title: title.trim(),
                                            notes: notes.trim() || undefined,
                                          })
                                        }}
                                      >
                                        Edit
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="mt-4 rounded-xl border border-dashed border-gray-800 px-4 py-3 text-sm text-gray-500">
                                No tasks under this milestone yet.
                              </p>
                            )}
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {activeTab === 'tasks' && (
                  <div className="mt-6 space-y-4">
                    {selectedTasks.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-gray-700 px-4 py-8 text-sm text-gray-400">
                        No tasks exist on this plan yet.
                      </div>
                    ) : (
                      selectedPlan.milestones.map((milestone) => (
                        <section key={milestone.id} className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <h3 className="text-sm font-semibold text-white">{milestone.title}</h3>
                              <p className="text-sm text-gray-500">{milestone.tasks.length} task(s)</p>
                            </div>
                            <button
                              type="button"
                              className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white"
                              onClick={() => {
                                const title = window.prompt('New task title')
                                if (!title?.trim()) return
                                void plans.addTask({ planId: selectedPlan.id, milestoneId: milestone.id, title: title.trim() })
                              }}
                            >
                              Add task
                            </button>
                          </div>
                          <div className="mt-4 space-y-3">
                            {milestone.tasks.map((task) => (
                              <div key={task.id} className="rounded-xl border border-gray-800 bg-gray-950/60 p-4">
                                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <h4 className="text-sm font-medium text-white">{task.title}</h4>
                                      <span className={`rounded-full border px-2 py-1 text-[11px] ${TASK_STATUS_CLASS[task.status]}`}>
                                        {TASK_STATUS_LABEL[task.status]}
                                      </span>
                                    </div>
                                    {task.notes && <p className="mt-2 text-sm text-gray-400">{task.notes}</p>}
                                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-500">
                                      <span>{milestone.title}</span>
                                      {dateSummary(milestone, task) && <span>{dateSummary(milestone, task)}</span>}
                                      <span>{task.progressPercent}% complete</span>
                                    </div>
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    <button
                                      type="button"
                                      className="rounded-full border border-gray-700 px-3 py-1.5 text-xs text-gray-200 transition hover:border-gray-500 hover:text-white"
                                      onClick={() => {
                                        const title = window.prompt('Edit task title', task.title)
                                        if (!title?.trim()) return
                                        const notes = window.prompt('Edit task notes', task.notes ?? '') ?? ''
                                        void plans.patchTask(selectedPlan.id, milestone.id, task.id, {
                                          title: title.trim(),
                                          notes: notes.trim() || undefined,
                                        })
                                      }}
                                    >
                                      Edit
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-emerald-700 px-3 py-1.5 text-xs text-emerald-200 transition hover:border-emerald-500 hover:bg-emerald-500/10"
                                      onClick={() => void plans.updateTaskStatus(selectedPlan.id, milestone.id, task.id, 'complete')}
                                    >
                                      Mark done
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-amber-700 px-3 py-1.5 text-xs text-amber-200 transition hover:border-amber-500 hover:bg-amber-500/10"
                                      onClick={() => void plans.updateTaskStatus(selectedPlan.id, milestone.id, task.id, 'on_hold')}
                                    >
                                      Won't do
                                    </button>
                                    <button
                                      type="button"
                                      className="rounded-full border border-rose-700 px-3 py-1.5 text-xs text-rose-200 transition hover:border-rose-500 hover:bg-rose-500/10"
                                      onClick={() => {
                                        if (!window.confirm(`Delete task "${task.title}"?`)) return
                                        void plans.removeTask(selectedPlan.id, milestone.id, task.id)
                                      }}
                                    >
                                      Delete
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </section>
                      ))
                    )}
                  </div>
                )}

                {activeTab === 'timeline' && (
                  <div className="mt-6">
                    <PlanCalendarView plans={[selectedPlan]} />
                  </div>
                )}
              </>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
