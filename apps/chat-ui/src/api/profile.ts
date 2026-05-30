import type { UserProfile, UserProfileResponse } from '@gateway/shared'
import { apiClient } from './client'

export async function getProfile(): Promise<UserProfile> {
  const res = await apiClient.get<UserProfileResponse>('/profile')
  return res.data.profile
}

export async function updateProfile(profile: UserProfile): Promise<UserProfile> {
  const res = await apiClient.put<UserProfileResponse>('/profile', { profile })
  return res.data.profile
}
