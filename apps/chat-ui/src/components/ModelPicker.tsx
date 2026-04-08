import { useState, useEffect, useRef, useCallback } from 'react'

interface ProviderStatus {
  name: string
  status: 'ok' | 'error' | 'unconfigured'
}

interface ModelPickerProps {
  /** The currently selected model identifier, or undefined for agent default */
  value: string | undefined
  /** The agent's own default model — shown as the "Default" option label */
  agentModel: string
  /** Called when the user picks a model; undefined means "use agent default" */
  onChange: (model: string | undefined) => void
  disabled?: boolean
  /** Optional label override for the trigger button */
  label?: string
}

interface ProviderModel {
  provider: string
  model: string
}

/**
 * A compact dropdown that lets users pick a model override.
 * Fetches the model list from each healthy provider on first open (Issue #95).
 */
export default function ModelPicker({ value, agentModel, onChange, disabled, label }: ModelPickerProps) {
  const [open, setOpen] = useState(false)
  const [providerModels, setProviderModels] = useState<ProviderModel[]>([])
  const [loading, setLoading] = useState(false)
  const fetchedRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const fetchModels = useCallback(async () => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    setLoading(true)
    try {
      const statusRes = await fetch('/api/providers/status')
      if (!statusRes.ok) return
      const statusData = await statusRes.json() as { providers: ProviderStatus[] }
      const healthy = statusData.providers.filter((p) => p.status === 'ok')

      const results = await Promise.allSettled(
        healthy.map(async (p) => {
          const res = await fetch(`/api/providers/${p.name}/models`)
          if (!res.ok) return []
          const data = await res.json() as { models: string[] }
          return (data.models ?? []).map((m) => ({ provider: p.name, model: m }))
        }),
      )
      const combined: ProviderModel[] = []
      for (const r of results) {
        if (r.status === 'fulfilled') combined.push(...r.value)
      }
      setProviderModels(combined)
    } catch {
      // silently ignore model-fetch errors
    } finally {
      setLoading(false)
    }
  }, [])

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const handleOpen = () => {
    if (disabled) return
    void fetchModels()
    setOpen((v) => !v)
  }

  const handleSelect = (model: string | undefined) => {
    onChange(model)
    setOpen(false)
  }

  const displayLabel = label ?? (value ? value : agentModel)
  const isOverridden = Boolean(value)

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg border transition-colors min-h-[32px] disabled:opacity-40 ${
          isOverridden
            ? 'border-blue-500 text-blue-300 bg-blue-900/30 hover:bg-blue-900/50'
            : 'border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
        }`}
        title={isOverridden ? `Model override: ${value}` : `Using agent default model: ${agentModel}`}
      >
        <span className="hidden sm:inline truncate max-w-[140px] font-mono">{displayLabel}</span>
        <span className="sm:hidden">🧠</span>
        <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full mb-1 right-0 z-50 w-64 bg-gray-900 border border-gray-700 rounded-xl shadow-xl overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 font-medium">
            Select model
          </div>
          <div className="max-h-56 overflow-y-auto">
            {/* Default option */}
            <button
              type="button"
              onClick={() => handleSelect(undefined)}
              className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                !value ? 'text-blue-300 font-medium' : 'text-gray-300'
              }`}
            >
              <span className="block font-mono truncate">Agent default</span>
              <span className="block text-gray-500 truncate">{agentModel}</span>
            </button>

            {loading && (
              <div className="px-3 py-3 text-xs text-gray-500 text-center animate-pulse">
                Loading models…
              </div>
            )}

            {!loading && providerModels.length === 0 && (
              <div className="px-3 py-3 text-xs text-gray-600 text-center">
                No models available
              </div>
            )}

            {!loading && providerModels.map(({ provider, model }) => (
              <button
                key={`${provider}:${model}`}
                type="button"
                onClick={() => handleSelect(model)}
                className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-800 transition-colors ${
                  value === model ? 'text-blue-300 font-medium' : 'text-gray-300'
                }`}
              >
                <span className="block font-mono truncate">{model}</span>
                <span className="block text-gray-500 truncate">via {provider}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
