import { useCallback, useState } from 'react'
import type { UserProfile } from '@gateway/shared'
import { getProfile, updateProfile } from '../api/profile'

export function useProfile() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setProfile(await getProfile())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load profile')
    } finally {
      setLoading(false)
    }
  }, [])

  const save = useCallback(async (nextProfile: UserProfile) => {
    setSaving(true)
    setError(null)
    try {
      const saved = await updateProfile(nextProfile)
      setProfile(saved)
      return saved
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save profile')
      throw err
    } finally {
      setSaving(false)
    }
  }, [])

  return { profile, setProfile, loading, saving, error, refresh, save }
}
