import type { AgentConfig } from '@gateway/shared'

/**
 * Seed definitions for the five default agents (Issue #27).
 * systemPrompt and routingPolicy are kept server-side and never sent to the browser.
 */
const AGENTS: AgentConfig[] = [
  {
    id: 'local-analyst',
    name: 'Local Analyst',
    icon: '🔍',
    color: '#3b82f6',
    providerName: 'lm-studio-a',
    model: 'local-model',
    costClass: 'free',
    systemPrompt:
      'You are a precise local analyst. Respond with structured, data-driven analysis. Be concise and factual.',
    temperature: 0.3,
    routingPolicy: {
      preferredProvider: 'lm-studio-a',
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
      maxCostClass: 'free',
    },
  },
  {
    id: 'creative-builder',
    name: 'Creative Builder',
    icon: '🎨',
    color: '#a855f7',
    providerName: 'lm-studio-b',
    model: 'local-model',
    costClass: 'free',
    systemPrompt:
      'You are a creative builder. Explore imaginative solutions, generate ideas freely, and embrace lateral thinking.',
    temperature: 0.9,
    routingPolicy: {
      preferredProvider: 'lm-studio-b',
      allowedProviders: ['lm-studio-a', 'lm-studio-b'],
      maxCostClass: 'free',
    },
  },
  {
    id: 'deep-reasoner',
    name: 'Premium Deep Reasoner',
    icon: '🧠',
    color: '#f59e0b',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt:
      'You are a deep reasoning assistant. Break down complex problems step-by-step, show your work, and arrive at well-supported conclusions.',
    temperature: 0.2,
    enableReasoning: true,
    routingPolicy: {
      preferredProvider: 'openai',
      requiresReasoning: true,
    },
  },
  {
    id: 'fast-helper',
    name: 'Fast Cheap Helper',
    icon: '⚡',
    color: '#22c55e',
    providerName: 'openai',
    model: 'gpt-4o-mini',
    costClass: 'cheap',
    systemPrompt:
      'You are a fast, concise helper. Give short, direct answers. Avoid unnecessary elaboration.',
    temperature: 0.5,
    maxTokens: 512,
    routingPolicy: {
      preferredProvider: 'openai',
      promptLengthThreshold: 1000,
      allowPaidFallback: true,
    },
  },
  {
    id: 'tool-agent',
    name: 'Tool Agent',
    icon: '🔧',
    color: '#ef4444',
    providerName: 'openai',
    model: 'gpt-4o',
    costClass: 'premium',
    systemPrompt:
      'You are a tool-use agent. When completing tasks, prefer structured outputs and leverage available tools effectively.',
    temperature: 0.0,
    featureFlags: { tools: true },
    routingPolicy: {
      preferredProvider: 'openai',
      requiresTools: true,
    },
  },
  {
    id: 'auto-router',
    name: 'Auto Router',
    icon: '🤖',
    color: '#6366f1',
    providerName: 'auto',
    model: 'auto',
    costClass: 'free',
    systemPrompt: 'You are an intelligent assistant. Respond helpfully and concisely.',
    routingPolicy: { allowPaidFallback: true },
  },
]

/** Return all registered agent configurations. */
export function listAgents(): AgentConfig[] {
  return AGENTS
}

/** Look up a single agent by id. Returns undefined if not found. */
export function getAgent(id: string): AgentConfig | undefined {
  return AGENTS.find((a) => a.id === id)
}
