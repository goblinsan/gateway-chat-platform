import type { UserPersona, PersonaListItem, CreatePersonaRequest, UpdatePersonaRequest, PersonasListResponse } from '@gateway/shared'
import { apiClient } from './client'

export async function listPersonas(): Promise<PersonaListItem[]> {
  const res = await apiClient.get<PersonasListResponse>('/personas')
  return res.data.personas
}

export async function getPersona(id: string): Promise<UserPersona> {
  const res = await apiClient.get<UserPersona>(`/personas/${id}`)
  return res.data
}

export async function createPersona(data: CreatePersonaRequest): Promise<UserPersona> {
  const res = await apiClient.post<UserPersona>('/personas', data)
  return res.data
}

export async function updatePersona(id: string, data: UpdatePersonaRequest): Promise<UserPersona> {
  const res = await apiClient.put<UserPersona>(`/personas/${id}`, data)
  return res.data
}

export async function deletePersona(id: string): Promise<void> {
  await apiClient.delete(`/personas/${id}`)
}

export async function duplicatePersona(id: string, name?: string): Promise<UserPersona> {
  const res = await apiClient.post<UserPersona>(`/personas/${id}/duplicate`, name ? { name } : {})
  return res.data
}
