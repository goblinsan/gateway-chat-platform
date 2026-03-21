import type { ToolDefinition } from '@gateway/shared'

export interface ToolResult {
  name: string
  result: string
}

const BUILT_IN_TOOLS: ToolDefinition[] = [
  {
    name: 'get_current_time',
    description: 'Returns the current date and time as an ISO 8601 timestamp.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'get_provider_status',
    description: 'Returns the list of available AI providers registered in the gateway.',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'calculate',
    description: 'Evaluates a simple arithmetic expression. Supports +, -, *, /, parentheses, and decimals.',
    parameters: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Arithmetic expression to evaluate, e.g. "2 + 3 * 4"' },
      },
      required: ['expression'],
    },
  },
]

const SAFE_EXPR = /^[0-9+\-*/().\s]+$/

export function getBuiltInTools(): ToolDefinition[] {
  return BUILT_IN_TOOLS
}

export function dispatchTool(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'get_current_time':
      return new Date().toISOString()
    case 'get_provider_status':
      return 'Use the /api/providers/status endpoint to get live provider status.'
    case 'calculate': {
      const expr = String(args.expression ?? '')
      if (!SAFE_EXPR.test(expr)) {
        return 'Error: unsafe expression rejected'
      }
      // Limit expression length to prevent DoS via deeply nested operations
      if (expr.length > 200) {
        return 'Error: expression too long'
      }
      try {
        // The SAFE_EXPR allowlist above restricts the expression to digits, the four
        // arithmetic operators, parentheses, decimal points, and whitespace only.
        // No identifiers, strings, or other constructs can appear, so using Function
        // here is safe and avoids an additional dependency.
        // eslint-disable-next-line no-new-func
        const result = Function(`"use strict"; return (${expr})`)()
        return String(result)
      } catch {
        return 'Error: could not evaluate expression'
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}
