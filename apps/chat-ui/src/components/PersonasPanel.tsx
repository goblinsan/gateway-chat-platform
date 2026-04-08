import { useState, useEffect } from 'react'
import type { PersonaListItem, UserPersona, CreatePersonaRequest, UpdatePersonaRequest } from '@gateway/shared'
import PersonaEditor from './PersonaEditor'

interface PersonasPanelProps {
  isOpen: boolean
  personas: PersonaListItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void
  onCreate: (data: CreatePersonaRequest) => Promise<UserPersona>
  onUpdate: (id: string, data: UpdatePersonaRequest) => Promise<UserPersona>
  onDelete: (id: string) => Promise<void>
  onDuplicate: (id: string) => Promise<UserPersona>
  onGetFull: (id: string) => Promise<UserPersona>
  onSelectPersona: (persona: PersonaListItem) => void
  activePersonaId?: string
  onClose: () => void
}

export default function PersonasPanel({
  isOpen,
  personas,
  loading,
  error,
  onRefresh,
  onCreate,
  onUpdate,
  onDelete,
  onDuplicate,
  onGetFull,
  onSelectPersona,
  activePersonaId,
  onClose,
}: PersonasPanelProps) {
  const [showCreate, setShowCreate] = useState(false)
  const [editingPersona, setEditingPersona] = useState<UserPersona | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null)

  useEffect(() => {
    if (isOpen) {
      void onRefresh()
    }
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null

  const handleCreate = async (data: CreatePersonaRequest) => {
    await onCreate(data)
    setShowCreate(false)
  }

  const handleEdit = async (persona: PersonaListItem) => {
    const full = await onGetFull(persona.id)
    setEditingPersona(full)
  }

  const handleUpdate = async (data: CreatePersonaRequest) => {
    if (!editingPersona) return
    await onUpdate(editingPersona.id, data)
    setEditingPersona(null)
  }

  const handleDelete = async (id: string) => {
    setDeletingId(id)
    try {
      await onDelete(id)
    } finally {
      setDeletingId(null)
    }
  }

  const handleDuplicate = async (id: string) => {
    setDuplicatingId(id)
    try {
      await onDuplicate(id)
    } finally {
      setDuplicatingId(null)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40 bg-black/60" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-sm bg-gray-900 border-l border-gray-800 flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden="true">✨</span>
            <h2 className="text-sm font-semibold text-gray-100">My Personas</h2>
            <span className="text-xs text-gray-500 font-normal">(personal)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
            >
              <span>+</span> New
            </button>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
              aria-label="Close personas panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Description */}
        <div className="px-5 py-3 border-b border-gray-800 bg-gray-950/50">
          <p className="text-xs text-gray-500 leading-relaxed">
            Personal personas are yours only — operator-managed agents are not affected.
            Select a persona below to start chatting with it.
          </p>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && (
            <p className="text-sm text-gray-500 text-center mt-8 animate-pulse">Loading personas…</p>
          )}
          {error && (
            <p className="text-sm text-red-400 text-center mt-8">{error}</p>
          )}
          {!loading && !error && personas.length === 0 && (
            <div className="text-center mt-12">
              <span className="text-4xl mb-3 block select-none" aria-hidden="true">✨</span>
              <p className="text-sm text-gray-400">No personas yet.</p>
              <p className="text-xs text-gray-600 mt-1">Create one to define your own personality.</p>
              <button
                onClick={() => setShowCreate(true)}
                className="mt-4 px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 transition-colors"
              >
                Create persona
              </button>
            </div>
          )}
          {!loading && personas.map((persona) => {
            const isActive = persona.id === activePersonaId
            return (
              <div
                key={persona.id}
                className={`group relative mb-2 rounded-xl border transition-colors ${
                  isActive
                    ? 'border-indigo-500 bg-indigo-500/10'
                    : 'border-gray-800 hover:border-gray-700 bg-gray-800/50'
                }`}
              >
                {/* Main click area for selecting */}
                <button
                  className="w-full text-left px-4 py-3 flex items-start gap-3"
                  onClick={() => onSelectPersona(persona)}
                >
                  <span
                    className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-lg"
                    style={{ backgroundColor: persona.color + '33' }}
                  >
                    {persona.icon}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-gray-100 truncate">{persona.name}</p>
                      <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30 font-medium">
                        Personal
                      </span>
                      {!persona.enabled && (
                        <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                          disabled
                        </span>
                      )}
                    </div>
                    {persona.description && (
                      <p className="text-xs text-gray-500 mt-0.5 truncate">{persona.description}</p>
                    )}
                    <p className="text-xs text-gray-600 mt-0.5">
                      {persona.providerName === 'auto' ? 'Auto routing' : persona.providerName}
                      {persona.model !== 'auto' ? ` · ${persona.model}` : ''}
                    </p>
                  </div>
                </button>

                {/* Action buttons */}
                <div className="absolute right-3 top-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={() => { void handleEdit(persona) }}
                    className="p-1.5 rounded-md text-gray-500 hover:text-gray-200 hover:bg-gray-700 transition-colors"
                    title="Edit persona"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                    </svg>
                  </button>
                  <button
                    onClick={() => { void handleDuplicate(persona.id) }}
                    disabled={duplicatingId === persona.id}
                    className="p-1.5 rounded-md text-gray-500 hover:text-blue-400 hover:bg-gray-700 transition-colors disabled:opacity-40"
                    title="Duplicate persona"
                  >
                    {duplicatingId === persona.id ? (
                      <span className="text-xs animate-pulse">…</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => { void handleDelete(persona.id) }}
                    disabled={deletingId === persona.id}
                    className="p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-colors disabled:opacity-40"
                    title="Delete persona"
                  >
                    {deletingId === persona.id ? (
                      <span className="text-xs animate-pulse">…</span>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Create editor */}
      {showCreate && (
        <PersonaEditor
          onSave={handleCreate}
          onClose={() => setShowCreate(false)}
        />
      )}

      {/* Edit editor */}
      {editingPersona && (
        <PersonaEditor
          persona={editingPersona}
          onSave={handleUpdate}
          onClose={() => setEditingPersona(null)}
        />
      )}
    </>
  )
}
