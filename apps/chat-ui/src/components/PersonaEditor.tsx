import { useState, useEffect } from 'react'
import type { UserPersona, CreatePersonaRequest } from '@gateway/shared'

interface PersonaEditorProps {
  /** If provided, the editor is in edit mode and prefills fields from this persona */
  persona?: UserPersona | null
  onSave: (data: CreatePersonaRequest & { enabled?: boolean }) => Promise<void>
  onClose: () => void
}

const DEFAULT_ICONS = ['🧑', '👩', '👨', '🧙', '🧝', '🦸', '🎭', '🤖', '💡', '🎯', '🌟', '⚡']
const DEFAULT_COLORS = [
  '#8b5cf6', '#6366f1', '#3b82f6', '#0ea5e9', '#14b8a6',
  '#22c55e', '#eab308', '#f97316', '#ef4444', '#ec4899',
]

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto (let routing decide)' },
  { value: 'lm-studio-a', label: 'LM Studio A (local)' },
  { value: 'lm-studio-b', label: 'LM Studio B (local)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'google', label: 'Google' },
]

export default function PersonaEditor({ persona, onSave, onClose }: PersonaEditorProps) {
  const [name, setName] = useState(persona?.name ?? '')
  const [description, setDescription] = useState(persona?.description ?? '')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [icon, setIcon] = useState(persona?.icon ?? '🧑')
  const [color, setColor] = useState(persona?.color ?? '#8b5cf6')
  const [providerName, setProviderName] = useState(persona?.providerName ?? 'auto')
  const [model, setModel] = useState(persona?.model ?? 'auto')
  const [temperature, setTemperature] = useState<string>(
    persona?.temperature != null ? String(persona.temperature) : '0.7',
  )
  const [maxTokens, setMaxTokens] = useState<string>(
    persona?.maxTokens != null ? String(persona.maxTokens) : '',
  )
  const [enableReasoning, setEnableReasoning] = useState(persona?.enableReasoning ?? false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingPrompt, setLoadingPrompt] = useState(false)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)

  const isEditMode = persona != null

  // In edit mode, load the full persona (including systemPrompt) from the caller's getFull
  useEffect(() => {
    if (persona?.systemPrompt != null) {
      setSystemPrompt(persona.systemPrompt)
    } else {
      setLoadingPrompt(false)
    }
  }, [persona])

  const promptLength = systemPrompt.length
  const promptTooLong = promptLength > 4096

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (promptTooLong) {
      setError(`System prompt is too long (${promptLength}/4096 characters)`)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        systemPrompt: systemPrompt.trim() || undefined,
        icon,
        color,
        providerName,
        model: model.trim() || 'auto',
        temperature: temperature !== '' ? parseFloat(temperature) : undefined,
        maxTokens: maxTokens !== '' ? parseInt(maxTokens, 10) : undefined,
        enableReasoning: enableReasoning || undefined,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save persona')
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
        setIconPickerOpen(false)
      }}
    >
      <div className="w-full max-w-lg bg-gray-900 rounded-xl border border-gray-700 shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-base font-semibold text-gray-100">
            {isEditMode ? 'Edit Persona' : 'New Persona'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-200 transition-colors p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form id="persona-form" onSubmit={(e) => { void handleSubmit(e) }} className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Icon + Color + Name row */}
          <div className="flex gap-3 items-start">
            {/* Icon picker */}
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500">Icon</label>
              <div className="relative">
                <div
                  className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl cursor-pointer border-2 transition-colors"
                  style={{ backgroundColor: color + '22', borderColor: color }}
                  title="Click to change icon"
                  onClick={() => setIconPickerOpen((value) => !value)}
                >
                  {icon}
                </div>
                {iconPickerOpen && (
                  <div className="absolute top-14 left-0 z-10 bg-gray-800 border border-gray-700 rounded-lg p-2 grid grid-cols-4 gap-1 shadow-xl">
                    {DEFAULT_ICONS.map((ic) => (
                      <button
                        key={ic}
                        type="button"
                        onClick={() => {
                          setIcon(ic)
                          setIconPickerOpen(false)
                        }}
                        className={`w-8 h-8 rounded text-lg flex items-center justify-center hover:bg-gray-700 transition-colors ${icon === ic ? 'bg-gray-700 ring-1 ring-indigo-500' : ''}`}
                      >
                        {ic}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Name */}
            <div className="flex-1 flex flex-col gap-1">
              <label className="text-xs text-gray-500" htmlFor="persona-name">Name *</label>
              <input
                id="persona-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={128}
                placeholder="My Persona"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                required
              />
            </div>
          </div>

          {/* Color swatches */}
          <div>
            <label className="text-xs text-gray-500 block mb-1">Accent colour</label>
            <div className="flex gap-2 flex-wrap">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-gray-900' : ''}`}
                  style={{ backgroundColor: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-description">
              Description <span className="text-gray-600">(optional, shown in UI)</span>
            </label>
            <input
              id="persona-description"
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={512}
              placeholder="A brief description of this personality…"
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* System Prompt */}
          <div>
            <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-system-prompt">
              Personality prompt
              <span className="text-gray-600 ml-1">(system prompt, max 4096 chars)</span>
            </label>
            {loadingPrompt ? (
              <div className="text-xs text-gray-500 animate-pulse">Loading…</div>
            ) : (
              <>
                <textarea
                  id="persona-system-prompt"
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  rows={5}
                  placeholder="You are a helpful assistant with a curious, friendly tone. You explain things clearly and ask thoughtful follow-up questions."
                  className={`w-full bg-gray-800 border rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 resize-none ${
                    promptTooLong ? 'border-red-500 focus:ring-red-500' : 'border-gray-700 focus:ring-indigo-500'
                  }`}
                />
                <p className={`text-xs mt-1 text-right ${promptTooLong ? 'text-red-400' : 'text-gray-600'}`}>
                  {promptLength}/4096
                </p>
              </>
            )}
          </div>

          {/* Provider + Model */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-provider">Provider</label>
              <select
                id="persona-provider"
                value={providerName}
                onChange={(e) => setProviderName(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {PROVIDER_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-model">Model</label>
              <input
                id="persona-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="auto"
                maxLength={128}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Temperature + Max tokens */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-temp">
                Temperature <span className="text-gray-600">(0–2)</span>
              </label>
              <input
                id="persona-temp"
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                min={0}
                max={2}
                step={0.05}
                placeholder="0.7"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1" htmlFor="persona-max-tokens">
                Max tokens <span className="text-gray-600">(optional)</span>
              </label>
              <input
                id="persona-max-tokens"
                type="number"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                min={1}
                max={32768}
                step={256}
                placeholder="default"
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {/* Reasoning toggle */}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={enableReasoning}
              onChange={(e) => setEnableReasoning(e.target.checked)}
              className="w-4 h-4 rounded accent-indigo-500"
            />
            <span className="text-sm text-gray-300">Enable extended reasoning</span>
          </label>

          {error && (
            <p className="text-sm text-red-400 bg-red-400/10 border border-red-400/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="persona-form"
            disabled={saving || !name.trim() || promptTooLong}
            className="px-5 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : isEditMode ? 'Save changes' : 'Create persona'}
          </button>
        </div>
      </div>
    </div>
  )
}
