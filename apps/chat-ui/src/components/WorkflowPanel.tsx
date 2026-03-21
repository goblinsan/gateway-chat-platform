import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import type { AgentListItem } from '@gateway/shared'

interface WorkflowStep {
  order: number
  agentId: string
  prompt: string
  label?: string
}

interface Workflow {
  id: string
  name: string
  description: string
  steps: WorkflowStep[]
  createdAt: number
}

interface WorkflowStepResult {
  step: WorkflowStep
  content: string
  provider: string
  latencyMs: number
}

interface WorkflowPanelProps {
  agents: AgentListItem[]
  onClose: () => void
}

export default function WorkflowPanel({ agents, onClose }: WorkflowPanelProps) {
  const queryClient = useQueryClient()
  const [showBuilder, setShowBuilder] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDesc, setNewDesc] = useState('')
  const [steps, setSteps] = useState<WorkflowStep[]>([{ order: 0, agentId: agents[0]?.id ?? '', prompt: '' }])
  const [runResults, setRunResults] = useState<Record<string, WorkflowStepResult[]>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<{ workflows: Workflow[] }>({
    queryKey: ['workflows'],
    queryFn: () => axios.get<{ workflows: Workflow[] }>('/api/workflows').then((r) => r.data),
  })

  const createMutation = useMutation({
    mutationFn: (payload: { name: string; description: string; steps: WorkflowStep[] }) =>
      axios.post('/api/workflows', payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workflows'] })
      setShowBuilder(false)
      setNewName(''); setNewDesc('')
      setSteps([{ order: 0, agentId: agents[0]?.id ?? '', prompt: '' }])
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => axios.delete(`/api/workflows/${id}`),
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['workflows'] }) },
  })

  const runMutation = useMutation({
    mutationFn: (id: string) =>
      axios.post<{ results: WorkflowStepResult[] }>(`/api/workflows/${id}/run`).then((r) => r.data),
    onSuccess: (data, id) => {
      setRunResults((prev) => ({ ...prev, [id]: data.results }))
      setExpandedId(id)
    },
  })

  const addStep = () => setSteps((prev) => [...prev, { order: prev.length, agentId: agents[0]?.id ?? '', prompt: '' }])
  const removeStep = (i: number) => setSteps((prev) => prev.filter((_, idx) => idx !== i).map((s, idx) => ({ ...s, order: idx })))
  const updateStep = (i: number, field: keyof WorkflowStep, value: string | number) =>
    setSteps((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))

  return (
    <div className="fixed inset-y-0 left-60 w-80 bg-gray-900 border-r border-gray-700 flex flex-col shadow-xl z-30">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-100">⚙ Workflows</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {isLoading && <p className="text-xs text-gray-500 text-center mt-6">Loading…</p>}
        <div className="p-3 space-y-2">
          {(data?.workflows ?? []).map((wf) => (
            <div key={wf.id} className="bg-gray-800 rounded-lg border border-gray-700">
              <div className="flex items-center gap-2 px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-gray-200 truncate">{wf.name}</p>
                  <p className="text-xs text-gray-500">{wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}</p>
                </div>
                <button
                  onClick={() => runMutation.mutate(wf.id)}
                  disabled={runMutation.isPending}
                  className="px-2 py-1 text-xs rounded bg-blue-700 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
                >
                  ▶ Run
                </button>
                <button
                  onClick={() => deleteMutation.mutate(wf.id)}
                  className="text-gray-500 hover:text-red-400 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              {runResults[wf.id] && (
                <div className="border-t border-gray-700">
                  <button
                    onClick={() => setExpandedId(expandedId === wf.id ? null : wf.id)}
                    className="w-full text-left px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 flex items-center gap-1"
                  >
                    <span>{expandedId === wf.id ? '▼' : '▶'}</span> Results
                  </button>
                  {expandedId === wf.id && (
                    <div className="px-3 pb-3 space-y-2">
                      {runResults[wf.id].map((r, i) => (
                        <div key={i} className="bg-gray-700 rounded p-2">
                          <p className="text-xs text-gray-400 mb-1">{r.step.label ?? `Step ${r.step.order + 1}`} ({r.provider} · {r.latencyMs}ms)</p>
                          <p className="text-xs text-gray-200 whitespace-pre-wrap line-clamp-4">{r.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
          {!isLoading && (data?.workflows ?? []).length === 0 && (
            <p className="text-xs text-gray-500 text-center mt-4">No workflows yet.</p>
          )}
        </div>

        {showBuilder && (
          <div className="border-t border-gray-700 p-3 space-y-3">
            <h3 className="text-xs font-semibold text-gray-300">New Workflow</h3>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Name"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <input
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="Description (optional)"
              className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-xs text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="bg-gray-700 rounded p-2 space-y-1.5">
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-gray-400 w-8">#{i + 1}</span>
                    <select
                      value={step.agentId}
                      onChange={(e) => updateStep(i, 'agentId', e.target.value)}
                      className="flex-1 bg-gray-600 border border-gray-500 rounded px-1.5 py-1 text-xs text-gray-200 focus:outline-none"
                    >
                      {agents.map((a) => <option key={a.id} value={a.id}>{a.icon} {a.name}</option>)}
                    </select>
                    {steps.length > 1 && (
                      <button onClick={() => removeStep(i)} className="text-gray-500 hover:text-red-400">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                  <textarea
                    value={step.prompt}
                    onChange={(e) => updateStep(i, 'prompt', e.target.value)}
                    placeholder="Prompt for this step…"
                    rows={2}
                    className="w-full bg-gray-600 border border-gray-500 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500 resize-none focus:outline-none"
                  />
                </div>
              ))}
              <button
                onClick={addStep}
                className="w-full text-xs text-gray-400 hover:text-gray-200 py-1 border border-dashed border-gray-600 rounded hover:border-gray-500 transition-colors"
              >
                + Add step
              </button>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowBuilder(false)}
                className="flex-1 text-xs py-1.5 rounded border border-gray-600 text-gray-400 hover:text-gray-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createMutation.mutate({ name: newName, description: newDesc, steps })}
                disabled={!newName.trim() || steps.some((s) => !s.prompt.trim()) || createMutation.isPending}
                className="flex-1 text-xs py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-colors"
              >
                {createMutation.isPending ? '…' : 'Create'}
              </button>
            </div>
          </div>
        )}
      </div>

      {!showBuilder && (
        <div className="border-t border-gray-700 p-3">
          <button
            onClick={() => setShowBuilder(true)}
            className="w-full text-xs py-2 rounded-lg bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white border border-gray-700 transition-colors"
          >
            + New Workflow
          </button>
        </div>
      )}
    </div>
  )
}
