import type { AgentListItem } from '@gateway/shared'

interface AgentTabsProps {
  agents: AgentListItem[]
  activeAgentId: string
  onSelect: (agentId: string) => void
}

const COST_LABEL: Record<string, string> = {
  free: 'Free',
  cheap: 'Cheap',
  premium: 'Premium',
}

export default function AgentTabs({ agents, activeAgentId, onSelect }: AgentTabsProps) {
  return (
    <nav className="flex gap-1 overflow-x-auto px-4 pt-3 pb-0 border-b border-gray-800 bg-gray-950">
      {agents.map((agent) => {
        const isActive = agent.id === activeAgentId
        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            style={isActive ? { borderBottomColor: agent.color } : undefined}
            className={[
              'flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-t-lg border-b-2 whitespace-nowrap transition-colors',
              isActive
                ? 'bg-gray-900 text-white'
                : 'text-gray-400 border-transparent hover:text-gray-200 hover:bg-gray-900',
            ].join(' ')}
            title={`${agent.name} · ${agent.model} · ${COST_LABEL[agent.costClass]}`}
          >
            <span aria-hidden="true">{agent.icon}</span>
            <span>{agent.name}</span>
          </button>
        )
      })}
    </nav>
  )
}
