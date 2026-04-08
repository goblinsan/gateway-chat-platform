/**
 * A user-owned agent personality.
 * Distinct from operator-managed Agent configs — only the owning user can see and edit these.
 */
export interface UserPersona {
  id: string
  userId: string
  name: string
  description?: string
  /** The personality system prompt — kept server-side, not returned to the browser in list responses */
  systemPrompt?: string
  icon: string
  color: string
  /** Provider to use — defaults to "auto" which lets the routing engine choose */
  providerName: string
  /** Model to use — defaults to "auto" */
  model: string
  temperature?: number
  maxTokens?: number
  enableReasoning?: boolean
  enabled: boolean
  createdAt: string
  updatedAt: string
}

/**
 * Public persona metadata returned by GET /api/personas.
 * systemPrompt is deliberately omitted from list responses.
 */
export type PersonaListItem = Omit<UserPersona, 'systemPrompt'>

/** Request body for creating a new persona */
export interface CreatePersonaRequest {
  name: string
  description?: string
  systemPrompt?: string
  icon?: string
  color?: string
  providerName?: string
  model?: string
  temperature?: number
  maxTokens?: number
  enableReasoning?: boolean
}

/** Request body for updating a persona (all fields optional) */
export type UpdatePersonaRequest = Partial<CreatePersonaRequest> & { enabled?: boolean }

/** Response for GET /api/personas */
export interface PersonasListResponse {
  personas: PersonaListItem[]
}
