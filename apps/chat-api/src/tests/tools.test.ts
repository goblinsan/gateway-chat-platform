import { describe, it, expect } from 'vitest'
import { getBuiltInTools, dispatchTool } from '../tools/registry'

describe('Tool Registry', () => {
  it('has expected built-in tools', () => {
    const tools = getBuiltInTools()
    expect(tools).toBeDefined()
    expect(Array.isArray(tools)).toBe(true)
    const names = tools.map((t) => t.name)
    expect(names).toContain('get_current_time')
    expect(names).toContain('get_provider_status')
    expect(names).toContain('calculate')
  })

  it('get_current_time returns valid ISO timestamp', () => {
    const result = dispatchTool('get_current_time', {})
    expect(typeof result).toBe('string')
    expect(() => new Date(result)).not.toThrow()
    expect(new Date(result).toISOString()).toBe(result)
  })

  it('calculate evaluates basic arithmetic', () => {
    expect(dispatchTool('calculate', { expression: '2 + 3' })).toBe('5')
    expect(dispatchTool('calculate', { expression: '10 * 4' })).toBe('40')
    expect(dispatchTool('calculate', { expression: '(3 + 2) * 4' })).toBe('20')
  })

  it('calculate rejects unsafe expressions', () => {
    const result = dispatchTool('calculate', { expression: 'process.exit(1)' })
    expect(result).toContain('Error')
  })
})
