import { useState, useCallback } from 'react'
import type { PersonaListItem, UserPersona, CreatePersonaRequest, UpdatePersonaRequest } from '@gateway/shared'
import {
  listPersonas,
  createPersona,
  updatePersona,
  deletePersona,
  duplicatePersona,
  getPersona,
} from '../api/personas'

export interface UsePersonasResult {
  personas: PersonaListItem[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  create: (data: CreatePersonaRequest) => Promise<UserPersona>
  update: (id: string, data: UpdatePersonaRequest) => Promise<UserPersona>
  remove: (id: string) => Promise<void>
  duplicate: (id: string, name?: string) => Promise<UserPersona>
  getFull: (id: string) => Promise<UserPersona>
}

export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<PersonaListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const list = await listPersonas()
      setPersonas(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load personas')
    } finally {
      setLoading(false)
    }
  }, [])

  const create = useCallback(async (data: CreatePersonaRequest): Promise<UserPersona> => {
    const created = await createPersona(data)
    setPersonas((prev) => [...prev, created])
    return created
  }, [])

  const update = useCallback(async (id: string, data: UpdatePersonaRequest): Promise<UserPersona> => {
    const updated = await updatePersona(id, data)
    setPersonas((prev) => prev.map((p) => (p.id === id ? updated : p)))
    return updated
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    await deletePersona(id)
    setPersonas((prev) => prev.filter((p) => p.id !== id))
  }, [])

  const duplicate = useCallback(async (id: string, name?: string): Promise<UserPersona> => {
    const copy = await duplicatePersona(id, name)
    setPersonas((prev) => [...prev, copy])
    return copy
  }, [])

  const getFull = useCallback(async (id: string): Promise<UserPersona> => {
    return getPersona(id)
  }, [])

  return { personas, loading, error, refresh, create, update, remove, duplicate, getFull }
}
