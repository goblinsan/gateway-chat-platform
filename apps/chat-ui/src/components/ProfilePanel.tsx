import { useEffect, useMemo, useState } from 'react'
import type { UserProfile } from '@gateway/shared'

interface ProfilePanelProps {
  isOpen: boolean
  profile: UserProfile | null
  loading: boolean
  saving: boolean
  error: string | null
  onRefresh: () => Promise<void>
  onSave: (profile: UserProfile) => Promise<UserProfile>
  onClose: () => void
}

export default function ProfilePanel({
  isOpen,
  profile,
  loading,
  saving,
  error,
  onRefresh,
  onSave,
  onClose,
}: ProfilePanelProps) {
  const [draft, setDraft] = useState<UserProfile | null>(profile)
  const [savedMessage, setSavedMessage] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen && !profile && !loading) {
      void onRefresh()
    }
  }, [isOpen, profile, loading, onRefresh])

  useEffect(() => {
    setDraft(profile)
  }, [profile])

  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(profile), [draft, profile])

  if (!isOpen) return null

  const updateField = (sectionId: string, fieldKey: string, value: string) => {
    setSavedMessage(null)
    setDraft((current) => {
      if (!current) return current
      return {
        ...current,
        sections: current.sections.map((section) => (
          section.id !== sectionId
            ? section
            : {
                ...section,
                fields: section.fields.map((field) => (
                  field.key === fieldKey ? { ...field, value } : field
                )),
              }
        )),
      }
    })
  }

  const save = async () => {
    if (!draft) return
    await onSave(draft)
    setSavedMessage('Saved')
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-gray-800 bg-gray-950 shadow-2xl">
      <div className="flex items-center gap-3 border-b border-gray-800 px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-gray-100">User Profile</h2>
          <p className="text-xs text-gray-500">Facts the assistant can use across chats</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:bg-gray-800"
        >
          Close
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-5 py-4">
        {loading && !draft ? (
          <p className="text-sm text-gray-400">Loading profile…</p>
        ) : error && !draft ? (
          <div className="space-y-3">
            <p className="text-sm text-red-300">{error}</p>
            <button
              type="button"
              onClick={() => { void onRefresh() }}
              className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:bg-gray-800"
            >
              Retry
            </button>
          </div>
        ) : draft ? (
          <div className="space-y-6">
            {draft.sections.map((section) => (
              <section key={section.id} className="space-y-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{section.title}</h3>
                <div className="space-y-3">
                  {section.fields.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-gray-400">{field.label}</span>
                      <textarea
                        value={field.value}
                        rows={field.value.length > 80 ? 3 : 2}
                        onChange={(event) => updateField(section.id, field.key, event.target.value)}
                        className="w-full resize-y rounded-md border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
                      />
                    </label>
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}
      </div>

      <div className="border-t border-gray-800 px-5 py-4">
        {error && draft ? <p className="mb-2 text-xs text-red-300">{error}</p> : null}
        {savedMessage ? <p className="mb-2 text-xs text-green-300">{savedMessage}</p> : null}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => { void onRefresh() }}
            disabled={loading || saving}
            className="rounded-md border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50"
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => { void save() }}
            disabled={!draft || !dirty || saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save Profile'}
          </button>
        </div>
      </div>
    </div>
  )
}
