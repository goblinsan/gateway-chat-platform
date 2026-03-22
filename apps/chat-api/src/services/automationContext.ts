import type { ProviderMessage } from '@gateway/shared'
import type { AgentConfig } from '@gateway/shared'
import { getBuiltInTools, dispatchTool } from '../tools/registry'

/**
 * Context provided by an external scheduler or control-plane when
 * invoking an agent run.
 */
export interface AutomationContext {
  workflowId?: string
  source?: string
  metadata?: Record<string, unknown>
}

/**
 * Delivery instructions for the agent's output.
 * Stored / logged for v1; outbound delivery is not yet implemented.
 */
export interface DeliverySpec {
  mode?: string
  channel?: string
  to?: string
}

/**
 * Builds the full provider message array for a single-turn automation run.
 *
 * This centralises prompt assembly so that future enhancements (RAG context
 * injection, file attachment, workflow-variable interpolation) can be added
 * in one place without touching the route handler.
 */
export function buildAutomationMessages(
  agent: AgentConfig,
  prompt: string,
  _context?: AutomationContext,
): ProviderMessage[] {
  const messages: ProviderMessage[] = []

  // System prompt
  let systemPrompt = agent.systemPrompt ?? ''
  if (agent.featureFlags?.tools === true) {
    const tools = getBuiltInTools()
    const currentTime = dispatchTool('get_current_time', {})
    const toolBlock = tools.map((t) => `- **${t.name}**: ${t.description}`).join('\n')
    systemPrompt += `\n\n## Available Tools\n${toolBlock}\n\nCurrent time: ${currentTime}`
  }
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }

  // Future: inject context from _context.metadata, contextSources, etc.

  // User prompt (single-turn)
  messages.push({ role: 'user', content: prompt })

  return messages
}
