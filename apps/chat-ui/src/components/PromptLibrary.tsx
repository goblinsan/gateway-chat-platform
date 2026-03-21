import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'

interface PromptItem {
  id: string
  title: string
  category: string
  prompt: string
  tags: string[]
}

interface PromptsListResponse {
  prompts: PromptItem[]
}

interface PromptLibraryProps {
  onUse: (prompt: string) => void
  onClose: () => void
}

export default function PromptLibrary({ onUse, onClose }: PromptLibraryProps) {
  const [search, setSearch] = useState('')
  const [activeCategory, setActiveCategory] = useState<string>('All')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery<PromptsListResponse>({
    queryKey: ['prompts'],
    queryFn: () => axios.get<PromptsListResponse>('/api/prompts').then((r) => r.data),
  })

  const prompts = data?.prompts ?? []
  const categories = ['All', ...Array.from(new Set(prompts.map((p) => p.category)))]

  const filtered = prompts.filter((p) => {
    const matchesCategory = activeCategory === 'All' || p.category === activeCategory
    const matchesSearch =
      !search ||
      p.title.toLowerCase().includes(search.toLowerCase()) ||
      p.tags.some((t) => t.toLowerCase().includes(search.toLowerCase()))
    return matchesCategory && matchesSearch
  })

  const handleCopy = (p: PromptItem) => {
    navigator.clipboard.writeText(p.prompt).then(() => {
      setCopiedId(p.id)
      setTimeout(() => setCopiedId(null), 1500)
    }).catch(() => {
      setCopiedId(`error-${p.id}`)
      setTimeout(() => setCopiedId(null), 1500)
    })
  }

  return (
    <div className="fixed inset-y-0 right-0 w-96 bg-gray-900 border-l border-gray-700 flex flex-col shadow-xl z-40">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
        <h2 className="text-sm font-semibold text-gray-100">Prompt Library</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-200 transition-colors">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="px-4 py-2 border-b border-gray-700">
        <input
          type="text"
          placeholder="Search prompts…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      <div className="flex gap-1 px-4 py-2 overflow-x-auto border-b border-gray-700">
        {categories.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`flex-shrink-0 px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-blue-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-gray-200'
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-2 space-y-2">
        {isLoading && <p className="text-xs text-gray-500 text-center mt-4">Loading…</p>}
        {filtered.map((p) => (
          <div key={p.id} className="bg-gray-800 rounded-lg p-3 border border-gray-700 hover:border-gray-600 transition-colors">
            <div className="flex items-start justify-between gap-2 mb-1">
              <h3 className="text-xs font-medium text-gray-200">{p.title}</h3>
              <span className="flex-shrink-0 text-xs text-gray-500 bg-gray-700 px-1.5 py-0.5 rounded">{p.category}</span>
            </div>
            <p className="text-xs text-gray-400 mb-2 line-clamp-2">{p.prompt}</p>
            <div className="flex gap-2">
              <button
                onClick={() => handleCopy(p)}
                className="flex-1 text-xs py-1 rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition-colors"
              >
                {copiedId === p.id ? 'Copied!' : copiedId === `error-${p.id}` ? 'Failed' : 'Copy'}
              </button>
              <button
                onClick={() => { onUse(p.prompt); onClose() }}
                className="flex-1 text-xs py-1 rounded bg-blue-700 text-white hover:bg-blue-600 transition-colors"
              >
                Use
              </button>
            </div>
          </div>
        ))}
        {!isLoading && filtered.length === 0 && (
          <p className="text-xs text-gray-500 text-center mt-4">No prompts found.</p>
        )}
      </div>
    </div>
  )
}
