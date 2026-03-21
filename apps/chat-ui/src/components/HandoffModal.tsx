import { useState } from 'react'
import type { AgentListItem } from '@gateway/shared'

interface HandoffModalProps {
  currentAgentId: string
  agents: AgentListItem[]
  onConfirm: (toAgentId: string) => void
  onClose: () => void
}

export default function HandoffModal({ currentAgentId, agents, onConfirm, onClose }: HandoffModalProps) {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    agents.find((a) => a.id !== currentAgentId)?.id ?? ''
  )

  const eligibleAgents = agents.filter((a) => a.id !== currentAgentId)

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-sm">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <h2 className="text-sm font-semibold text-gray-100">🔄 Hand Off Conversation</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-4">
          <p className="text-xs text-gray-400 mb-3">
            Transfer this conversation context to another agent.
          </p>
          <label className="block text-xs text-gray-300 mb-1.5">Select target agent</label>
          <select
            value={selectedAgentId}
            onChange={(e) => setSelectedAgentId(e.target.value)}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {eligibleAgents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.icon} {a.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2 mt-4">
            <button
              onClick={onClose}
              className="flex-1 px-3 py-2 text-sm rounded-lg border border-gray-600 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={() => { if (selectedAgentId) onConfirm(selectedAgentId) }}
              disabled={!selectedAgentId}
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Hand Off
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
