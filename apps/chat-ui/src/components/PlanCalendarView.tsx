import { useState } from 'react'
import type { PlanGoal, PlanMilestone, PlanStatus, PlanTask, PlanTaskStatus } from '@gateway/shared'

type PlannerHorizon = 'day' | 'week' | 'month' | 'year'

const HORIZON_LABELS: Record<PlannerHorizon, string> = {
  day: 'Today',
  week: 'Week',
  month: 'Month',
  year: 'Year',
}

const MILESTONE_STATUS_LABEL: Record<PlanStatus, string> = {
  on_track: 'On track',
  at_risk: 'At risk',
  blocked: 'Blocked',
  complete: 'Complete',
}

const TASK_STATUS_LABEL: Record<PlanTaskStatus, string> = {
  todo: 'To do',
  in_progress: 'In progress',
  complete: 'Complete',
  on_hold: "Won't do",
  blocked: 'Blocked',
}

function milestoneStatusClass(status: PlanStatus): string {
  switch (status) {
    case 'on_track': return 'bg-green-900/40 text-green-300 border-green-700/50'
    case 'at_risk': return 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
    case 'blocked': return 'bg-red-900/40 text-red-300 border-red-700/50'
    case 'complete': return 'bg-blue-900/40 text-blue-300 border-blue-700/50'
  }
}

function taskStatusClass(status: PlanTaskStatus): string {
  switch (status) {
    case 'todo': return 'bg-gray-800/70 text-gray-300 border-gray-700/60'
    case 'in_progress': return 'bg-blue-900/40 text-blue-300 border-blue-700/50'
    case 'complete': return 'bg-green-900/40 text-green-300 border-green-700/50'
    case 'on_hold': return 'bg-yellow-900/40 text-yellow-300 border-yellow-700/50'
    case 'blocked': return 'bg-red-900/40 text-red-300 border-red-700/50'
  }
}

function getHorizonRange(horizon: PlannerHorizon, refDate: Date): [Date, Date] {
  const d = new Date(refDate)
  d.setHours(0, 0, 0, 0)
  switch (horizon) {
    case 'day': {
      const end = new Date(d)
      end.setHours(23, 59, 59, 999)
      return [d, end]
    }
    case 'week': {
      const dow = d.getDay()
      const start = new Date(d)
      start.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(start.getDate() + 6)
      end.setHours(23, 59, 59, 999)
      return [start, end]
    }
    case 'month': {
      const start = new Date(d.getFullYear(), d.getMonth(), 1)
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999)
      return [start, end]
    }
    case 'year': {
      const start = new Date(d.getFullYear(), 0, 1)
      const end = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999)
      return [start, end]
    }
  }
}

function formatHorizonLabel(horizon: PlannerHorizon, start: Date, end: Date): string {
  const fmt = (d: Date) => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  switch (horizon) {
    case 'day': return start.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    case 'week': return `${fmt(start)} – ${fmt(end)}`
    case 'month': return start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    case 'year': return String(start.getFullYear())
  }
}

function shiftDate(date: Date, horizon: PlannerHorizon, delta: number): Date {
  const d = new Date(date)
  switch (horizon) {
    case 'day': d.setDate(d.getDate() + delta); break
    case 'week': d.setDate(d.getDate() + 7 * delta); break
    case 'month': d.setMonth(d.getMonth() + delta); break
    case 'year': d.setFullYear(d.getFullYear() + delta); break
  }
  return d
}

function parseScheduleDate(dateStr: string): Date | null {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? null : d
}

function withinRange(dateStr: string, start: Date, end: Date): boolean {
  const d = parseScheduleDate(dateStr)
  if (!d) return false
  return d >= start && d <= end
}

function isOverdue(dateStr: string, now: Date): boolean {
  const d = parseScheduleDate(dateStr)
  if (!d) return false
  const today = new Date(now)
  today.setHours(0, 0, 0, 0)
  return d < today
}

function isTaskComplete(task: PlanTask): boolean {
  return task.status === 'complete' || Boolean(task.completedAt)
}

function isMilestoneComplete(milestone: PlanMilestone): boolean {
  if (milestone.status === 'complete') return true
  return milestone.tasks.length > 0 && milestone.tasks.every(isTaskComplete)
}

function todayAnchor(): Date {
  const d = new Date()
  d.setHours(12, 0, 0, 0)
  return d
}

interface ScheduledMilestoneEntry {
  kind: 'milestone'
  plan: PlanGoal
  milestone: PlanMilestone
  date: Date
}

interface ScheduledTaskEntry {
  kind: 'task'
  plan: PlanGoal
  milestone: PlanMilestone
  task: PlanTask
  date: Date
}

interface UnscheduledMilestoneEntry {
  kind: 'milestone'
  plan: PlanGoal
  milestone: PlanMilestone
}

interface UnscheduledTaskEntry {
  kind: 'task'
  plan: PlanGoal
  milestone: PlanMilestone
  task: PlanTask
}

type ScheduledEntry = ScheduledMilestoneEntry | ScheduledTaskEntry
type UnscheduledEntry = UnscheduledMilestoneEntry | UnscheduledTaskEntry

interface PlanCalendarViewProps {
  plans: PlanGoal[]
}

export default function PlanCalendarView({ plans }: PlanCalendarViewProps) {
  const [horizon, setHorizon] = useState<PlannerHorizon>('day')
  const [refDate, setRefDate] = useState<Date>(todayAnchor)

  const now = new Date()
  const [rangeStart, rangeEnd] = getHorizonRange(horizon, refDate)
  const horizonLabel = formatHorizonLabel(horizon, rangeStart, rangeEnd)

  const scheduledItems: ScheduledEntry[] = []
  const overdueItems: ScheduledEntry[] = []
  const unscheduledItems: UnscheduledEntry[] = []

  for (const plan of plans) {
    for (const milestone of plan.milestones) {
      const milestoneDates = [
        { value: milestone.scheduledDate, isDeadline: false },
        { value: milestone.startDate, isDeadline: false },
        { value: milestone.targetDate, isDeadline: true },
        { value: milestone.endDate, isDeadline: true },
      ].filter((entry) => Boolean(entry.value))

      if (milestoneDates.length === 0) {
        unscheduledItems.push({ kind: 'milestone', plan, milestone })
      } else {
        for (const entry of milestoneDates) {
          if (!entry.value) continue
          const d = parseScheduleDate(entry.value)
          if (!d) continue
          if (withinRange(entry.value, rangeStart, rangeEnd)) {
            scheduledItems.push({ kind: 'milestone', plan, milestone, date: d })
          } else if (entry.isDeadline && isOverdue(entry.value, now) && !isMilestoneComplete(milestone)) {
            overdueItems.push({ kind: 'milestone', plan, milestone, date: d })
          }
        }
      }

      for (const task of milestone.tasks) {
        const taskDates = [
          { value: task.scheduledAt, isDeadline: false },
          { value: task.startAt, isDeadline: false },
          { value: task.targetAt, isDeadline: true },
          { value: task.dueAt, isDeadline: true },
          { value: task.endAt, isDeadline: true },
        ].filter((entry) => Boolean(entry.value))

        if (taskDates.length === 0) {
          unscheduledItems.push({ kind: 'task', plan, milestone, task })
        } else {
          for (const entry of taskDates) {
            if (!entry.value) continue
            const d = parseScheduleDate(entry.value)
            if (!d) continue
            if (withinRange(entry.value, rangeStart, rangeEnd)) {
              scheduledItems.push({ kind: 'task', plan, milestone, task, date: d })
            } else if (entry.isDeadline && isOverdue(entry.value, now) && !isTaskComplete(task)) {
              overdueItems.push({ kind: 'task', plan, milestone, task, date: d })
            }
          }
        }
      }
    }
  }

  scheduledItems.sort((a, b) => a.date.getTime() - b.date.getTime())
  overdueItems.sort((a, b) => a.date.getTime() - b.date.getTime())

  const handleSelectHorizon = (h: PlannerHorizon) => {
    setHorizon(h)
    setRefDate(todayAnchor())
  }

  return (
    <div className="space-y-4">
      <div className="flex overflow-hidden rounded border border-gray-700" role="tablist" aria-label="Planning horizon">
        {(Object.keys(HORIZON_LABELS) as PlannerHorizon[]).map((h) => (
          <button
            key={h}
            type="button"
            role="tab"
            aria-selected={horizon === h}
            onClick={() => handleSelectHorizon(h)}
            className={`flex-1 px-3 py-1.5 text-xs transition-colors ${horizon === h ? 'bg-gray-700 text-white' : 'text-gray-300 hover:text-white'}`}
          >
            {HORIZON_LABELS[h]}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 rounded border border-gray-800 px-3 py-2">
        <button
          type="button"
          onClick={() => setRefDate((d) => shiftDate(d, horizon, -1))}
          className="px-2 py-0.5 text-sm text-gray-300 hover:text-white"
          aria-label="Previous period"
        >
          ‹
        </button>
        <span className="flex-1 text-center text-xs font-medium text-gray-200">{horizonLabel}</span>
        <button
          type="button"
          onClick={() => setRefDate((d) => shiftDate(d, horizon, 1))}
          className="px-2 py-0.5 text-sm text-gray-300 hover:text-white"
          aria-label="Next period"
        >
          ›
        </button>
      </div>

      {overdueItems.length > 0 && (
        <section aria-label="Overdue items">
          <p className="mb-1.5 text-[11px] font-medium text-red-400">
            Overdue ({overdueItems.length})
          </p>
          <div className="space-y-1">
            {overdueItems.map((item) => (
              <ScheduledEntryRow key={entryKey(item, 'overdue')} item={item} />
            ))}
          </div>
        </section>
      )}

      {scheduledItems.length > 0 ? (
        <section aria-label="Scheduled items">
          <p className="mb-1.5 text-[11px] font-medium text-gray-400">
            Scheduled ({scheduledItems.length})
          </p>
          <div className="space-y-1">
            {scheduledItems.map((item) => (
              <ScheduledEntryRow key={entryKey(item, 'scheduled')} item={item} />
            ))}
          </div>
        </section>
      ) : (
        <p className="py-6 text-center text-xs text-gray-600">Nothing scheduled for this period.</p>
      )}

      {unscheduledItems.length > 0 && (
        <section aria-label="Unscheduled items">
          <p className="mb-1.5 text-[11px] font-medium text-gray-500">
            Unscheduled ({unscheduledItems.length}) — no backend date set
          </p>
          <div className="space-y-1">
            {unscheduledItems.map((item) => (
              <UnscheduledEntryRow key={entryKey(item, 'unscheduled')} item={item} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

function entryKey(item: ScheduledEntry | UnscheduledEntry, prefix: string): string {
  if (item.kind === 'milestone') return `${prefix}-m-${item.plan.id}-${item.milestone.id}`
  return `${prefix}-t-${item.plan.id}-${item.task.id}`
}

function ScheduledEntryRow({ item }: { item: ScheduledEntry }) {
  const dateLabel = item.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  if (item.kind === 'milestone') {
    return (
      <div className="flex items-start gap-2 rounded border border-gray-700 bg-gray-900/40 px-2 py-1.5 text-[11px]">
        <span className="mt-0.5 shrink-0 rounded border border-blue-700/60 px-1 py-0.5 text-[10px] text-blue-400">
          milestone
        </span>
        <div className="min-w-0 flex-1">
          <span className="text-gray-200">{item.milestone.title}</span>
          <span className="ml-2 text-gray-500">{item.plan.title}</span>
        </div>
        <span className="shrink-0 text-gray-500">{dateLabel}</span>
        <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] ${milestoneStatusClass(item.milestone.status)}`}>
          {MILESTONE_STATUS_LABEL[item.milestone.status]}
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-start gap-2 rounded border border-gray-700 bg-gray-900/40 px-2 py-1.5 text-[11px]">
      <span className="mt-0.5 shrink-0 rounded border border-gray-700/60 px-1 py-0.5 text-[10px] text-gray-400">
        task
      </span>
      <div className="min-w-0 flex-1">
        <span className="text-gray-200">{item.task.title}</span>
        <span className="ml-2 text-gray-500">{item.milestone.title}</span>
      </div>
      <span className="shrink-0 text-gray-500">{dateLabel}</span>
      <span className={`shrink-0 rounded border px-1 py-0.5 text-[10px] ${taskStatusClass(item.task.status)}`}>
        {TASK_STATUS_LABEL[item.task.status]}
      </span>
    </div>
  )
}

function UnscheduledEntryRow({ item }: { item: UnscheduledEntry }) {
  if (item.kind === 'milestone') {
    return (
      <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5 text-[11px] opacity-70">
        <span className="shrink-0 rounded border border-blue-900/60 px-1 py-0.5 text-[10px] text-blue-500">
          milestone
        </span>
        <span className="min-w-0 flex-1 truncate text-gray-400">{item.milestone.title}</span>
        <span className="shrink-0 text-gray-600">{item.plan.title}</span>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 rounded border border-gray-800 bg-gray-950/40 px-2 py-1.5 text-[11px] opacity-70">
      <span className="shrink-0 rounded border border-gray-800 px-1 py-0.5 text-[10px] text-gray-500">
        task
      </span>
      <span className="min-w-0 flex-1 truncate text-gray-400">{item.task.title}</span>
      <span className="shrink-0 text-gray-600">{item.milestone.title}</span>
    </div>
  )
}
