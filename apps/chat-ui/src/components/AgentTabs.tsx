import type { AgentListItem } from '@gateway/shared'

interface AgentTabsProps {
  agents: AgentListItem[]
  activeAgentId: string
  onSelect: (agentId: string) => void
  /** IDs of user-created personas — shown with a visual badge */
  personaIds?: Set<string>
  onOpenPersonas?: () => void
}

const COST_LABEL: Record<string, string> = {
  free: 'Free',
  cheap: 'Cheap',
  premium: 'Premium',
}

export default function AgentTabs({ agents, activeAgentId, onSelect, personaIds, onOpenPersonas }: AgentTabsProps) {
  return (
    <nav className="flex gap-1 overflow-x-auto px-4 pt-3 pb-0 border-b border-gray-800 bg-gray-950">
      {agents.map((agent) => {
        const isActive = agent.id === activeAgentId
        const isPersona = personaIds?.has(agent.id) ?? false
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
            title={`${agent.name} · ${agent.model} · ${isPersona ? 'Personal' : COST_LABEL[agent.costClass]}`}
          >
            <span aria-hidden="true">{agent.icon}</span>
            <span>{agent.name}</span>
            {agent.id === 'auto-router' && (
              <span className="text-xs font-bold px-1 py-0.5 rounded bg-indigo-600 text-white leading-none">Auto</span>
            )}
            {isPersona && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 leading-none">✨</span>
            )}
          </button>
        )
      })}
      {/* Persona management button */}
      {onOpenPersonas && (
        <button
          onClick={onOpenPersonas}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 border-b-2 border-transparent hover:text-gray-200 hover:bg-gray-900 rounded-t-lg whitespace-nowrap transition-colors ml-1"
          title="Manage my personas"
        >
          <span aria-hidden="true">✨</span>
          <span className="hidden sm:inline">My Personas</span>
        </button>
      )}
    </nav>
  )
}
