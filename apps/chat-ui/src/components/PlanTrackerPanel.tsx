import { useMemo, useState } from 'react'

type PlanStatus = 'on_track' | 'at_risk' | 'blocked' | 'complete'

interface PlanTask {
  id: string
  title: string
  status: PlanStatus
}

interface PlanMilestone {
  id: string
  title: string
  status: PlanStatus
  progress: number
  tasks: PlanTask[]
}

interface PlanGoal {
  id: string
  title: string
  status: PlanStatus
  progress: number
  nextReview: string
  sources: string[]
  metrics: Array<{ label: string; value: string }>
  milestones: PlanMilestone[]
}

interface PlanTrackerPanelProps {
  isOpen: boolean
  onClose: () => void
}

const PLAN_GOALS: PlanGoal[] = [
  {
    id: 'goal-shared-planning',
    title: 'Shared visual planning across web + iPhone',
    status: 'on_track',
    progress: 56,
    nextReview: 'Weekly · Monday',
    sources: ['chat-ui', 'GatewayAppFoundation', 'Control plane'],
    metrics: [
      { label: 'Open tasks', value: '5' },
      { label: 'Completed this week', value: '2' },
      { label: 'Stale items', value: '1' },
    ],
    milestones: [
      {
        id: 'milestone-web-surface',
        title: 'Deliver plan tracker surface in chat-ui',
        status: 'on_track',
        progress: 70,
        tasks: [
          { id: 'task-web-overview', title: 'Render goal + milestone hierarchy', status: 'complete' },
          { id: 'task-web-details', title: 'Show task detail and status chips', status: 'on_track' },
          { id: 'task-web-nav', title: 'Expose tracker outside transcript', status: 'complete' },
        ],
      },
      {
        id: 'milestone-ios-surface',
        title: 'Deliver plan tracker tab in iPhone app',
        status: 'at_risk',
        progress: 45,
        tasks: [
          { id: 'task-ios-overview', title: 'Add native tracker browsing view', status: 'on_track' },
          { id: 'task-ios-detail', title: 'Expose milestone and task drill-down', status: 'at_risk' },
          { id: 'task-ios-state', title: 'Highlight blocked and stale work', status: 'blocked' },
        ],
      },
    ],
  },
]

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

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-700 overflow-hidden">
      <div className="h-full rounded-full bg-blue-500" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export default function PlanTrackerPanel({ isOpen, onClose }: PlanTrackerPanelProps) {
  const [selectedGoalId, setSelectedGoalId] = useState<string | null>(PLAN_GOALS[0]?.id ?? null)

  const selectedGoal = useMemo(
    () => PLAN_GOALS.find((goal) => goal.id === selectedGoalId) ?? PLAN_GOALS[0] ?? null,
    [selectedGoalId],
  )

  if (!isOpen) return null

  return (
    <aside className="w-full md:w-[32rem] border-l border-gray-800 bg-gray-900/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center justify-between gap-3 px-4 py-4 border-b border-gray-800">
        <div>
          <p className="text-sm font-semibold text-gray-100">Plan Tracker</p>
          <p className="text-xs text-gray-500">Goals, milestones, tasks, and progress</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs border border-gray-700 text-gray-300 hover:border-gray-600 hover:text-white transition-colors"
        >
          Close
        </button>
      </div>

      <div className="grid md:grid-cols-[15rem,1fr] flex-1 min-h-0">
        <div className="border-b md:border-b-0 md:border-r border-gray-800 overflow-y-auto p-3 space-y-2">
          {PLAN_GOALS.map((goal) => (
            <button
              key={goal.id}
              type="button"
              onClick={() => setSelectedGoalId(goal.id)}
              className={`w-full text-left rounded-lg border p-3 transition-colors ${
                selectedGoal?.id === goal.id
                  ? 'border-blue-500/40 bg-blue-950/20'
                  : 'border-gray-700 bg-gray-800/40 hover:border-gray-600'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-gray-100">{goal.title}</p>
                <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[goal.status]}`}>
                  {STATUS_LABEL[goal.status]}
                </span>
              </div>
              <p className="mt-2 text-[11px] text-gray-500">{goal.progress}% complete</p>
              <ProgressBar value={goal.progress} />
            </button>
          ))}
        </div>

        <div className="overflow-y-auto p-4 space-y-4">
          {!selectedGoal ? null : (
            <>
              <div className="bg-gray-800/50 border border-gray-700 rounded-lg p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-gray-100">{selectedGoal.title}</p>
                  <span className={`text-[11px] px-2 py-0.5 rounded border ${STATUS_CLASS[selectedGoal.status]}`}>
                    {STATUS_LABEL[selectedGoal.status]}
                  </span>
                </div>
                <div className="mt-2">
                  <p className="text-xs text-gray-500 mb-1">Overall progress</p>
                  <ProgressBar value={selectedGoal.progress} />
                  <p className="text-[11px] text-gray-500 mt-1">{selectedGoal.progress}%</p>
                </div>
                <p className="text-xs text-gray-400 mt-2">Next review: {selectedGoal.nextReview}</p>
                <p className="text-xs text-gray-500 mt-1">Sources: {selectedGoal.sources.join(' · ')}</p>
              </div>

              <div className="grid grid-cols-3 gap-2">
                {selectedGoal.metrics.map((metric) => (
                  <div key={metric.label} className="rounded-lg border border-gray-700 bg-gray-800/40 p-2">
                    <p className="text-[11px] text-gray-500">{metric.label}</p>
                    <p className="text-sm font-medium text-gray-200">{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="space-y-3">
                {selectedGoal.milestones.map((milestone) => (
                  <div key={milestone.id} className="rounded-lg border border-gray-700 bg-gray-800/40 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium text-gray-100">{milestone.title}</p>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[milestone.status]}`}>
                        {STATUS_LABEL[milestone.status]}
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] text-gray-500">{milestone.progress}% complete</p>
                    <ProgressBar value={milestone.progress} />
                    <ul className="mt-2 space-y-1">
                      {milestone.tasks.map((task) => (
                        <li key={task.id} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-300">{task.title}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded border ${STATUS_CLASS[task.status]}`}>
                            {STATUS_LABEL[task.status]}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </aside>
  )
}
