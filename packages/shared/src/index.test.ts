import { describe, expect, it } from 'vitest'

import type { AgentConfig } from './index'

describe('@gateway/shared', () => {
  it('exposes shared agent contract types', () => {
    const agent: AgentConfig = {
      id: 'story-agent',
      name: 'Story Agent',
      icon: 'SA',
      color: '#2563eb',
      providerName: 'agent-service',
      model: 'local-model',
      costClass: 'free',
      personalContext: { enabled: false },
    }

    expect(agent.personalContext?.enabled).toBe(false)
  })
})
