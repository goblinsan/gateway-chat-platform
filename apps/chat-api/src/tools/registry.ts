import fs from 'fs'
import path from 'path'
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
  {
    name: 'file_read',
    description: 'Reads the contents of a file at the given path. Returns an error string if the file cannot be read.',
    parameters: {
      type: 'object',
      properties: {
        filePath: { type: 'string', description: 'Absolute or relative path to the file to read' },
      },
      required: ['filePath'],
    },
  },
  // TODO: http_health_check — performs a GET request and returns status code + latency
  // TODO: telegram_send — sends a message to a Telegram chat via bot API
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
    case 'file_read': {
      const filePath = String(args.filePath ?? '')
      if (!filePath) return 'Error: filePath is required'
      // Prevent path traversal — resolve and verify the path stays within cwd
      const resolved = path.resolve(filePath)
      const cwd = process.cwd()
      if (!resolved.startsWith(cwd)) {
        return 'Error: path traversal not allowed'
      }
      try {
        const content = fs.readFileSync(resolved, 'utf-8')
        // Cap output to prevent huge files from blowing up context
        const MAX_LENGTH = 32_000
        if (content.length > MAX_LENGTH) {
          return content.slice(0, MAX_LENGTH) + `\n\n[truncated — file is ${content.length} chars]`
        }
        return content
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error'
        return `Error reading file: ${msg}`
      }
    }
    default:
      return `Unknown tool: ${name}`
  }
}
