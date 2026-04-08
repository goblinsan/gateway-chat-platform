import type { PersonaListItem, AgentListItem } from '@gateway/shared'

/** Convert a PersonaListItem to an AgentListItem shape for use in agent tabs/chat. */
export function personaToAgentListItem(p: PersonaListItem): AgentListItem {
  return {
    id: p.id,
    name: p.name,
    icon: p.icon,
    color: p.color,
    providerName: p.providerName,
    model: p.model,
    costClass: 'free',
    enabled: p.enabled,
    source: 'database',
  }
}
