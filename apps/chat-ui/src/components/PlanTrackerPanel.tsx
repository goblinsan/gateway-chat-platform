import { useEffect, useRef, useState } from 'react'
import type {
  ExportPlanResponse,
  ImportPlanRequest,
  PlanGoal,
  PlanMetric,
  PlanStatus,
  PlanTaskStatus,
  UpdatePlanRequest,
} from '@gateway/shared'
import PlanCalendarView from './PlanCalendarView'

interface PlanTrackerPanelProps {
  isOpen: boolean
  plans: PlanGoal[]
  loading: boolean
  error: string | null
  variant?: 'panel' | 'workspace'
  title?: string
  subtitle?: string
  closeLabel?: string
  onRefresh: () => Promise<void>
  onClose: () => void
  onCreatePlan: (input: { title: string; vision?: string }) => Promise<void>
  onImportPlan: (input: ImportPlanRequest) => Promise<void>
  onExportPlan: (planId: string) => Promise<ExportPlanResponse>
  onPatchPlan: (planId: string, patch: UpdatePlanRequest) => Promise<void>
  onDeletePlan: (planId: string) => Promise<void>
  onAddMilestone: (input: { planId: string; title: string }) => Promise<void>
  onUpdateMilestoneStatus: (planId: string, milestoneId: string, status: PlanStatus) => Promise<void>
  onDeleteMilestone: (planId: string, milestoneId: string) => Promise<void>
  onAddTask: (input: { planId: string; milestoneId: string; title: string }) => Promise<void>
  onUpdateTaskStatus: (planId: string, milestoneId: string, taskId: string, status: PlanTaskStatus) => Promise<void>
  onPatchTask: (planId: string, milestoneId: string, taskId: string, patch: { title?: string; notes?: string; status?: PlanTaskStatus }) => Promise<void>
  onDeleteTask: (planId: string, milestoneId: string, taskId: string) => Promise<void>
}

const STATUS_LABEL: Record<PlanStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
}

const STATUS_CLASS: Record<PlanStatus, string> = {
  on_track: 'bg-green-900/40 text-green-300 border-green-700/50',
  at_risk: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  blocked: 'bg-red-900/40 text-red-300 border-red-700/50',
  complete: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
}

const TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  complete: 'Complete',
  on_hold: 'Won’t do',
  blocked: 'Blocked',
}

const TASK_STATUS_CLASS: Record<PlanTaskStatus, string> = {
  todo: 'bg-gray-800/70 text-gray-300 border-gray-700/60',
  in_progress: 'bg-blue-900/40 text-blue-300 border-blue-700/50',
  complete: 'bg-green-900/40 text-green-300 border-green-700/50',
  on_hold: 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50',
  blocked: 'bg-red-900/40 text-red-300 border-red-700/50',
}

const STATUS_VALUES: PlanStatus[] = ['on_track', 'at_risk', 'blocked', 'complete']
const TASK_STATUS_VALUES: PlanTaskStatus[] = ['todo', 'in_progress', 'complete', 'on_hold', 'blocked']

type PlanViewMode = 'list' | 'timeline' | 'calendar'

interface PlanDraft {
  title: string
  vision: string
  status: PlanStatus
  category: string
  reviewCadence: string
  tags: string
  sourceSystems: string
  metrics: string
}

function nextStatus(current: PlanStatus): PlanStatus {
  const index = STATUS_VALUES.indexOf(current)
  return STATUS_VALUES[(index + 1) % STATUS_VALUES.length]
}

function nextTaskStatus(current: PlanTaskStatus): PlanTaskStatus {
  const index = TASK_STATUS_VALUES.indexOf(current)
  return TASK_STATUS_VALUES[(index + 1) % TASK_STATUS_VALUES.length]
}

function splitLines(value: string): string[] {
  return value
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function metricsToEditorValue(metrics: PlanMetric[]): string {
  return metrics.map((metric) => `${metric.label}: ${metric.value}`).join('\n')
}

function editorValueToMetrics(value: string): PlanMetric[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.indexOf(':')
      if (separator < 0) return null
      const label = line.slice(0, separator).trim()
      const metricValue = line.slice(separator + 1).trim()
      if (!label || !metricValue) return null
      return { label, value: metricValue }
    })
    .filter((metric): metric is PlanMetric => metric !== null)
}

function createDraft(plan: PlanGoal): PlanDraft {
  return {
    title: plan.title,
    vision: plan.vision ?? '',
    status: plan.status,
    category: plan.category ?? '',
    reviewCadence: plan.reviewCadence ?? '',
    tags: plan.tags.join('\n'),
    sourceSystems: plan.sourceSystems.join('\n'),
    metrics: metricsToEditorValue(plan.metrics),
  }
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
      <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export default function PlanTrackerPanel({
  isOpen,
  plans,
  loading,
  error,
  variant = 'panel',
  title = 'Plans',
  subtitle = 'Project dashboard backed by durable agent-service plan state',
  closeLabel = 'Close',
  onRefresh,
  onClose,
  onCreatePlan,
  onImportPlan,
  onExportPlan,
  onPatchPlan,
  onDeletePlan,
  onAddMilestone,
  onUpdateMilestoneStatus,
  onDeleteMilestone,
  onAddTask,
  onUpdateTaskStatus,
  onPatchTask,
  onDeleteTask,
}: PlanTrackerPanelProps) {
  const importInputRef = useRef<HTMLInputElement>(null)
  const [viewMode, setViewMode] = useState<PlanViewMode>('list')
  const [editingPlanId, setEditingPlanId] = useState<string | null>(null)
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null)
  const [importTargetPlanId, setImportTargetPlanId] = useState<string | null>(null)

  useEffect(() => {
    if (!editingPlanId) return
    const plan = plans.find((item) => item.id === editingPlanId)
    if (!plan) {
      setEditingPlanId(null)
      setPlanDraft(null)
      return
    }
    setPlanDraft(createDraft(plan))
  }, [editingPlanId, plans])

  if (!isOpen) return null

  const containerClassName = variant === 'workspace'
    ? 'mx-auto flex h-full w-full max-w-6xl min-w-0 flex-1 flex-col overflow-hidden border-x border-gray-800 bg-gray-900/80'
    : 'flex w-full flex-col border-l border-gray-800 bg-gray-900/95 backdrop-blur-sm md:w-[34rem]'

  const handleCreatePlan = async () => {
    const title = window.prompt('Goal title')
    if (!title?.trim()) return
    const vision = window.prompt('Goal vision (optional)') ?? undefined
    await onCreatePlan({ title: title.trim(), vision: vision?.trim() || undefined })
  }

  const handleImportFile = async (file: File | null) => {
    if (!file) return
    try {
      const text = (await file.text()).trim()
      if (!text) return
      const source = file.name.trim() || undefined
      const fallbackTitle = file.name.replace(/\.[^.]+$/, '').trim() || undefined
      const targetPlan = importTargetPlanId
        ? plans.find((plan) => plan.id === importTargetPlanId)
        : undefined
      await onImportPlan({
        planId: importTargetPlanId ?? undefined,
        title: targetPlan?.title ?? fallbackTitle,
        source,
        text,
      })
    } finally {
      setImportTargetPlanId(null)
      if (importInputRef.current) {
        importInputRef.current.value = ''
      }
    }
  }

  const handleExport = async (planId: string) => {
    const exported = await onExportPlan(planId)
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

  const renderMetadata = (plan: PlanGoal) => {
    const hasMetadata =
      plan.objectives.length > 0 ||
      plan.principles.length > 0 ||
      plan.baselineFacts.length > 0 ||
      plan.trackedMetrics.length > 0 ||
      plan.successCriteria.length > 0 ||
      plan.cadence.length > 0 ||
      plan.supportingSections.length > 0

    if (!hasMetadata) return null

    return (
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        {plan.objectives.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Objectives</p>
            <ul className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.objectives.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </section>
        )}
        {plan.principles.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Core Principles</p>
            <ul className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.principles.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </section>
        )}
        {plan.baselineFacts.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Starting Metrics</p>
            <div className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.baselineFacts.map((fact) => (
                <p key={fact.label}>
                  <span className="text-gray-500">{fact.label}:</span> {fact.value}
                </p>
              ))}
            </div>
          </section>
        )}
        {plan.trackedMetrics.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Metrics To Track</p>
            <div className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.trackedMetrics.map((metric) => (
                <p key={metric.name}>
                  <span className="text-gray-300">{metric.name}</span>
                  {metric.notes ? ` — ${metric.notes}` : ''}
                  {metric.cadence ? ` [${metric.cadence}]` : ''}
                </p>
              ))}
            </div>
          </section>
        )}
        {plan.successCriteria.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Success Criteria</p>
            <ul className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.successCriteria.map((item) => <li key={item}>• {item}</li>)}
            </ul>
          </section>
        )}
        {plan.cadence.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <p className="text-[11px] font-medium text-gray-300">Weekly Structure</p>
            <div className="mt-1 space-y-1 text-[11px] text-gray-400">
              {plan.cadence.map((entry, idx) => (
                <p key={`${entry.day}-${entry.activity}-${idx}`}>
                  <span className="text-gray-500">{entry.day ?? entry.label ?? 'Session'}:</span> {entry.activity}
                </p>
              ))}
            </div>
          </section>
        )}
        {plan.supportingSections.length > 0 && (
          <section className="rounded border border-gray-700 bg-gray-900/40 p-2 md:col-span-2">
            <p className="text-[11px] font-medium text-gray-300">Supporting Material</p>
            <div className="mt-2 space-y-2 text-[11px] text-gray-400">
              {plan.supportingSections.map((section) => (
                <div key={section.title} className="rounded border border-gray-800 bg-gray-950/60 p-2">
                  <div className="flex items-center gap-2">
                    <p className="text-gray-300">{section.title}</p>
                    {section.kind && (
                      <span className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-gray-500">
                        {section.kind}
                      </span>
                    )}
                  </div>
                  {section.summary && <p className="mt-1">{section.summary}</p>}
                  {section.items.length > 0 && (
                    <ul className="mt-1 space-y-1">
                      {section.items.map((item, idx) => (
                        <li key={`${section.title}-${item.label ?? item.uri ?? idx}`}>
                          <span className="text-gray-500">{item.label ?? item.kind ?? 'Item'}:</span>{' '}
                          {item.uri ? (
                            <a className="text-blue-300 hover:text-blue-200 underline" href={item.uri} target="_blank" rel="noreferrer">
                              {item.uri}
                            </a>
                          ) : (
                            item.content ?? ''
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    )
  }

  const renderTimeline = (plan: PlanGoal) => (
    <div className="mt-3 space-y-3">
      {plan.milestones.map((milestone, idx) => (
        <div key={milestone.id} className="relative pl-8">
          <div className="absolute bottom-0 left-2 top-0 w-px bg-gray-700" />
          <div className="absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-500 text-[10px] font-medium text-white">
            {idx + 1}
          </div>
          <div className="rounded border border-gray-700 bg-gray-900/40 p-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-gray-200">{milestone.title}</p>
                {milestone.notes && <p className="mt-1 text-[11px] text-gray-500">{milestone.notes}</p>}
              </div>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[milestone.status]}`}>
                {STATUS_LABEL[milestone.status]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-gray-500">{milestone.tasks.length} task(s)</p>
            {milestone.tasks.length > 0 && (
              <ul className="mt-2 space-y-1 text-[11px] text-gray-400">
                {milestone.tasks.map((task) => (
                  <li key={task.id}>
                    <span className={`mr-2 inline-block rounded border px-1.5 py-0.5 ${TASK_STATUS_CLASS[task.status]}`}>{TASK_STATUS_LABEL[task.status]}</span>
                    {task.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <section className={containerClassName}>
      <div className="flex items-center justify-between gap-3 border-b border-gray-800 px-4 py-4">
        <div>
          <p className="text-sm font-semibold text-gray-100">{title}</p>
          <p className="text-xs text-gray-500">{subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => { void onRefresh() }}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={handleCreatePlan}
            className="px-3 py-1.5 text-xs border border-blue-700 text-blue-300 hover:border-blue-600 hover:text-blue-200 transition-colors"
          >
            New plan
          </button>
          <div className="flex overflow-hidden rounded border border-gray-700">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              className={`px-2 py-1.5 text-xs transition-colors ${viewMode === 'list' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
            >
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode('timeline')}
              className={`px-2 py-1.5 text-xs transition-colors ${viewMode === 'timeline' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
            >
              Timeline
            </button>
            <button
              type="button"
              onClick={() => setViewMode('calendar')}
              className={`px-2 py-1.5 text-xs transition-colors ${viewMode === 'calendar' ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
            >
              Calendar
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json,.yaml,.yml,.txt,.md,.markdown,application/json,application/yaml,text/yaml,text/plain,text/markdown"
            className="hidden"
            onChange={(event) => {
              void handleImportFile(event.target.files?.[0] ?? null)
            }}
          />
          <button
            type="button"
            onClick={() => {
              setImportTargetPlanId(null)
              importInputRef.current?.click()
            }}
            className="px-3 py-1.5 text-xs border border-emerald-700 text-emerald-300 hover:border-emerald-600 hover:text-emerald-200 transition-colors"
          >
            Import plan
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
          >
            {closeLabel}
          </button>
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {loading && <p className="animate-pulse text-center text-xs text-gray-500">Loading plans…</p>}
        {error && <p className="text-center text-xs text-red-400">{error}</p>}
        {!loading && plans.length === 0 && (
          <div className="rounded-lg border border-gray-800 p-4 text-center">
            <p className="text-sm text-gray-300">No plans yet.</p>
            <p className="mt-1 text-xs text-gray-500">Create or import a plan to start tracking milestones, tasks, and supporting material.</p>
          </div>
        )}
        {viewMode === 'calendar' && plans.length > 0 && (
          <PlanCalendarView plans={plans} />
        )}
        {viewMode !== 'calendar' && plans.map((plan) => {
          const isEditing = editingPlanId === plan.id && planDraft !== null
          const totalTasks = plan.milestones.reduce((count, milestone) => count + milestone.tasks.length, 0)
          const completedTasks = plan.milestones.reduce(
            (count, milestone) => count + milestone.tasks.filter((task) => task.status === 'complete').length,
            0,
          )

          return (
            <div key={plan.id} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-100">{plan.title}</p>
                  {plan.vision && <p className="mt-1 text-xs text-gray-400">{plan.vision}</p>}
                </div>
                <span className={`rounded border px-2 py-0.5 text-[11px] ${STATUS_CLASS[plan.status]}`}>
                  {STATUS_LABEL[plan.status]}
                </span>
              </div>

              <div className="mt-2">
                <ProgressBar value={plan.progressPercent} />
                <div className="mt-1 flex items-center justify-between text-[11px] text-gray-500">
                  <span>{plan.progressPercent}% complete · {completedTasks}/{totalTasks || 0} tasks done</span>
                  <span>{plan.reviewCadence ? `Review: ${plan.reviewCadence}` : 'Review cadence unset'}</span>
                </div>
                {(plan.category || plan.tags.length > 0 || plan.sourceSystems.length > 0 || plan.metrics.length > 0) && (
                  <div className="mt-2 space-y-1 text-[11px] text-gray-500">
                    {plan.category && <p>Category: {plan.category}</p>}
                    {plan.tags.length > 0 && <p>Tags: {plan.tags.join(' · ')}</p>}
                    {plan.sourceSystems.length > 0 && <p>Sources: {plan.sourceSystems.join(' · ')}</p>}
                    {plan.metrics.length > 0 && (
                      <p>Metrics: {plan.metrics.map((metric) => `${metric.label}: ${metric.value}`).join(' · ')}</p>
                    )}
                  </div>
                )}
                {renderMetadata(plan)}
              </div>

              {isEditing && planDraft && (
                <div className="mt-3 grid gap-3 rounded border border-gray-700 bg-gray-950/60 p-3 md:grid-cols-2">
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Title</span>
                    <input
                      type="text"
                      value={planDraft.title}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, title: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Status</span>
                    <select
                      value={planDraft.status}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, status: event.target.value as PlanStatus } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    >
                      {STATUS_VALUES.map((status) => (
                        <option key={status} value={status}>{STATUS_LABEL[status]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="text-[11px] text-gray-400 md:col-span-2">
                    <span className="mb-1 block text-gray-500">Vision</span>
                    <textarea
                      rows={3}
                      value={planDraft.vision}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, vision: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Category</span>
                    <input
                      type="text"
                      value={planDraft.category}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, category: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Review cadence</span>
                    <input
                      type="text"
                      value={planDraft.reviewCadence}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, reviewCadence: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Tags (one per line)</span>
                    <textarea
                      rows={3}
                      value={planDraft.tags}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, tags: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400">
                    <span className="mb-1 block text-gray-500">Source systems (one per line)</span>
                    <textarea
                      rows={3}
                      value={planDraft.sourceSystems}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, sourceSystems: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                  <label className="text-[11px] text-gray-400 md:col-span-2">
                    <span className="mb-1 block text-gray-500">Dashboard metrics (one per line: label: value)</span>
                    <textarea
                      rows={4}
                      value={planDraft.metrics}
                      onChange={(event) => setPlanDraft((draft) => draft ? { ...draft, metrics: event.target.value } : draft)}
                      className="w-full rounded border border-gray-700 bg-gray-900 px-2 py-1.5 text-xs text-gray-100"
                    />
                  </label>
                </div>
              )}

              <div className="mt-3 flex flex-wrap gap-2">
                {isEditing ? (
                  <>
                    <button
                      type="button"
                      className="rounded border border-blue-700 px-2 py-1 text-[11px] text-blue-300 hover:text-blue-200"
                      onClick={() => {
                        if (!planDraft?.title.trim()) return
                        void onPatchPlan(plan.id, {
                          title: planDraft.title.trim(),
                          vision: planDraft.vision.trim() || undefined,
                          status: planDraft.status,
                          category: planDraft.category.trim() || undefined,
                          reviewCadence: planDraft.reviewCadence.trim() || undefined,
                          tags: splitLines(planDraft.tags),
                          sourceSystems: splitLines(planDraft.sourceSystems),
                          metrics: editorValueToMetrics(planDraft.metrics),
                        }).then(() => {
                          setEditingPlanId(null)
                          setPlanDraft(null)
                        })
                      }}
                    >
                      Save changes
                    </button>
                    <button
                      type="button"
                      className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                      onClick={() => {
                        setEditingPlanId(null)
                        setPlanDraft(null)
                      }}
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                    onClick={() => {
                      setEditingPlanId(plan.id)
                      setPlanDraft(createDraft(plan))
                    }}
                  >
                    Edit dashboard
                  </button>
                )}
                <button
                  type="button"
                  className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                  onClick={() => { void onPatchPlan(plan.id, { status: nextStatus(plan.status) }) }}
                >
                  Next status
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                  onClick={() => { void handleExport(plan.id) }}
                >
                  Export plan
                </button>
                <button
                  type="button"
                  className="rounded border border-emerald-700 px-2 py-1 text-[11px] text-emerald-300 hover:text-emerald-200"
                  onClick={() => {
                    setImportTargetPlanId(plan.id)
                    importInputRef.current?.click()
                  }}
                >
                  Import update
                </button>
                <button
                  type="button"
                  className="rounded border border-gray-700 px-2 py-1 text-[11px] text-gray-300 hover:text-white"
                  onClick={() => {
                    const title = window.prompt('New milestone title')
                    if (!title?.trim()) return
                    void onAddMilestone({ planId: plan.id, title: title.trim() })
                  }}
                >
                  Add milestone
                </button>
                <button
                  type="button"
                  className="rounded border border-red-700 px-2 py-1 text-[11px] text-red-300 hover:text-red-200"
                  onClick={() => {
                    if (!window.confirm(`Delete "${plan.title}" and all of its tasks?`)) return
                    void onDeletePlan(plan.id)
                  }}
                >
                  Delete plan
                </button>
              </div>

              {viewMode === 'timeline' ? renderTimeline(plan) : (
                <div className="mt-3 space-y-2">
                  {plan.milestones.map((milestone) => (
                    <div key={milestone.id} className="rounded border border-gray-700 bg-gray-900/40 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-gray-200">{milestone.title}</p>
                          {milestone.notes && <p className="mt-1 text-[11px] text-gray-500">{milestone.notes}</p>}
                        </div>
                        <button
                          type="button"
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_CLASS[milestone.status]}`}
                          onClick={() => { void onUpdateMilestoneStatus(plan.id, milestone.id, nextStatus(milestone.status)) }}
                        >
                          {STATUS_LABEL[milestone.status]}
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">{milestone.progressPercent}% complete</p>
                      <ProgressBar value={milestone.progressPercent} />

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300"
                          onClick={() => {
                            const title = window.prompt('New task title')
                            if (!title?.trim()) return
                            void onAddTask({ planId: plan.id, milestoneId: milestone.id, title: title.trim() })
                          }}
                        >
                          Add task
                        </button>
                        <button
                          type="button"
                          className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300"
                          onClick={() => {
                            if (!window.confirm(`Delete milestone "${milestone.title}" and its tasks?`)) return
                            void onDeleteMilestone(plan.id, milestone.id)
                          }}
                        >
                          Delete milestone
                        </button>
                      </div>

                      <ul className="mt-2 space-y-2">
                        {milestone.tasks.map((task) => (
                          <li key={task.id} className="rounded border border-gray-800 bg-gray-950/60 p-2 text-[11px]">
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-gray-200">{task.title}</p>
                                {task.notes && <p className="mt-1 text-gray-500">{task.notes}</p>}
                              </div>
                              <button
                                type="button"
                                className={`rounded border px-1.5 py-0.5 ${TASK_STATUS_CLASS[task.status]}`}
                                onClick={() => { void onUpdateTaskStatus(plan.id, milestone.id, task.id, nextTaskStatus(task.status)) }}
                              >
                                {TASK_STATUS_LABEL[task.status]}
                              </button>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {task.status !== 'complete' && (
                                <button
                                  type="button"
                                  className="rounded border border-green-700 px-1.5 py-0.5 text-[10px] text-green-300"
                                  onClick={() => { void onUpdateTaskStatus(plan.id, milestone.id, task.id, 'complete') }}
                                >
                                  Mark done
                                </button>
                              )}
                              {task.status !== 'on_hold' && (
                                <button
                                  type="button"
                                  className="rounded border border-yellow-700 px-1.5 py-0.5 text-[10px] text-yellow-300"
                                  onClick={() => { void onUpdateTaskStatus(plan.id, milestone.id, task.id, 'on_hold') }}
                                >
                                  Mark won’t do
                                </button>
                              )}
                              <button
                                type="button"
                                className="rounded border border-gray-700 px-1.5 py-0.5 text-[10px] text-gray-300"
                                onClick={() => {
                                  const title = window.prompt('Edit task title', task.title)
                                  if (title === null) return
                                  const notes = window.prompt('Edit task notes', task.notes ?? '')
                                  if (notes === null) return
                                  const trimmedTitle = title.trim()
                                  if (!trimmedTitle) return
                                  void onPatchTask(plan.id, milestone.id, task.id, {
                                    title: trimmedTitle,
                                    notes: notes.trim() || undefined,
                                  })
                                }}
                              >
                                Edit task
                              </button>
                              <button
                                type="button"
                                className="rounded border border-red-700 px-1.5 py-0.5 text-[10px] text-red-300"
                                onClick={() => {
                                  if (!window.confirm(`Delete task "${task.title}"?`)) return
                                  void onDeleteTask(plan.id, milestone.id, task.id)
                                }}
                              >
                                Delete task
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
