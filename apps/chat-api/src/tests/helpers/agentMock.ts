import { vi } from 'vitest'
import type { AgentConfig } from '@gateway/shared'

/**
 * Test seed agents — same as production seeds, used by tests that rely on
 * getAgent() / listAgents() from the agent registry.
 */
const TEST_AGENTS: AgentConfig[] = [
  {
    id: 'local-analyst',
    name: 'Local Analyst',
    icon: '🔍',
    color: '#3b82f6',
    providerName: 'lm-studio-a',
    model: 'local-model',
    costClass: 'free',
    systemPrompt: 'You are a precise local analyst.',
    temperature: 0.3,
    enabled: true,
    source: 'seed',
  },
  {
    id: 'creative-builder',
    name: 'Creative Builder',
    icon: '🎨',
    color: '#a855f7',
    providerName: 'lm-studio-b',
    model: 'local-model',
    costClass: 'free',
    systemPrompt: 'You are a creative builder.',
    temperature: 0.9,
    enabled: true,
    source: 'seed',
  },
  {
    id: 'deep-reasoner',
    name: 'Premium Deep Reasoner',
    icon: '🧠',
    color: '#f59e0b',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt: 'You are a deep reasoning assistant.',
    temperature: 0.2,
    enableReasoning: true,
    enabled: true,
    source: 'seed',
  },
  {
    id: 'fast-helper',
    name: 'Fast Cheap Helper',
    icon: '⚡',
    color: '#22c55e',
    providerName: 'openai',
    model: 'gpt-4o-mini',
    costClass: 'cheap',
    systemPrompt: 'You are a fast, concise helper.',
    temperature: 0.5,
    maxTokens: 512,
    enabled: true,
    source: 'seed',
  },
  {
    id: 'tool-agent',
    name: 'Tool Agent',
    icon: '🔧',
    color: '#ef4444',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt: 'You are a tool-use agent.',
    temperature: 0.0,
    featureFlags: { tools: true },
    enabled: true,
    source: 'seed',
  },
  {
    id: 'auto-router',
    name: 'Auto Router',
    icon: '🤖',
    color: '#6366f1',
    providerName: 'auto',
    model: 'auto',
    costClass: 'free',
    systemPrompt: 'You are an intelligent assistant.',
    enabled: true,
    source: 'seed',
  },
]

/**
 * Mock the agent registry module so tests don't need a real database.
 * Call this BEFORE importing any modules that use getAgent/listAgents.
 */
export function mockAgentRegistry(agents: AgentConfig[] = TEST_AGENTS) {
  const agentMap = new Map(agents.map((a) => [a.id, a]))

  vi.mock('../agents/registry', () => ({
    listAgents: () => agents.filter((a) => a.enabled !== false),
    getAgent: (id: string) => {
      const agent = agentMap.get(id)
      return agent && agent.enabled !== false ? agent : undefined
    },
    getAgentRegistry: () => ({
      list: (enabledOnly = true) =>
        enabledOnly ? agents.filter((a) => a.enabled !== false) : agents,
      get: (id: string) => {
        const agent = agentMap.get(id)
        return agent && agent.enabled !== false ? agent : undefined
      },
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      sync: vi.fn(),
      reload: vi.fn(),
    }),
    initAgentRegistry: vi.fn(),
    setAgentRegistry: vi.fn(),
  }))
}
