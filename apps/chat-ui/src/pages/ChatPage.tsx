import { useState, useRef, useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { AgentListItem, AgentsListResponse, AgentChatRequest, AgentChatResponse } from '@gateway/shared'
import AgentTabs from '../components/AgentTabs'

interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
}

const COST_COLOR: Record<string, string> = {
  free: 'text-green-400',
  cheap: 'text-yellow-400',
  premium: 'text-purple-400',
}

export default function ChatPage() {
  const { data, isLoading: agentsLoading } = useQuery<AgentsListResponse>({
    queryKey: ['agents'],
    queryFn: () => axios.get<AgentsListResponse>('/api/agents').then((r) => r.data),
  })

  const agents = useMemo<AgentListItem[]>(() => data?.agents ?? [], [data])

  const [activeAgentId, setActiveAgentId] = useState<string>('')
  const [conversations, setConversations] = useState<Record<string, DisplayMessage[]>>({})
  const [input, setInput] = useState('')
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Set first agent as active once loaded
  useEffect(() => {
    if (agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id)
    }
  }, [agents, activeAgentId])

  // Scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversations, activeAgentId])

  const activeAgent = agents.find((a) => a.id === activeAgentId)
  const messages = conversations[activeAgentId] ?? []

  async function handleSend() {
    const trimmed = input.trim()
    if (!trimmed || !activeAgentId || isSending) return

    const userMsg: DisplayMessage = { role: 'user', content: trimmed }
    const updatedMessages = [...messages, userMsg]
    setConversations((prev) => ({ ...prev, [activeAgentId]: updatedMessages }))
    setInput('')
    setIsSending(true)

    try {
      const body: AgentChatRequest = {
        agentId: activeAgentId,
        messages: updatedMessages,
      }
      const { data: responseData } = await axios.post<AgentChatResponse>('/api/chat', body)
      const assistantMsg: DisplayMessage = {
        role: 'assistant',
        content: responseData.message.content,
      }
      setConversations((prev) => ({
        ...prev,
        [activeAgentId]: [...updatedMessages, assistantMsg],
      }))
    } catch {
      const errMsg: DisplayMessage = {
        role: 'assistant',
        content: '⚠️ Something went wrong. Please try again.',
      }
      setConversations((prev) => ({
        ...prev,
        [activeAgentId]: [...updatedMessages, errMsg],
      }))
    } finally {
      setIsSending(false)
    }
  }

  function handleNewChat() {
    if (!activeAgentId) return
    setConversations((prev) => ({ ...prev, [activeAgentId]: [] }))
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  return (
    <main className="flex flex-col h-screen">
      {/* Agent tab navigation */}
      {agentsLoading ? (
        <div className="border-b border-gray-800 px-6 py-3 text-gray-500 text-sm">
          Loading agents…
        </div>
      ) : (
        <AgentTabs
          agents={agents}
          activeAgentId={activeAgentId}
          onSelect={setActiveAgentId}
        />
      )}

      {/* Active agent header */}
      {activeAgent && (
        <header className="flex items-center gap-3 border-b border-gray-800 px-6 py-3 bg-gray-900">
          <span className="text-2xl" aria-hidden="true">
            {activeAgent.icon}
          </span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-base font-semibold truncate">{activeAgent.name}</h1>
              <span
                className={`text-xs font-medium px-1.5 py-0.5 rounded ${COST_COLOR[activeAgent.costClass]} bg-gray-800`}
              >
                {activeAgent.costClass}
              </span>
            </div>
            <p className="text-xs text-gray-400 truncate">
              {activeAgent.model} · {activeAgent.providerName}
              {activeAgent.enableReasoning && (
                <span className="ml-2 text-amber-400">reasoning</span>
              )}
            </p>
          </div>
          <button
            onClick={handleNewChat}
            className="ml-auto text-xs text-gray-400 hover:text-gray-200 border border-gray-700 hover:border-gray-500 rounded px-3 py-1 transition-colors"
          >
            New Chat
          </button>
        </header>
      )}

      {/* Message list */}
      <section className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.length === 0 && (
          <p className="text-gray-500 text-sm text-center mt-8">
            {activeAgent
              ? `Start a conversation with ${activeAgent.name}…`
              : 'Select an agent to begin…'}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[75%] rounded-xl px-4 py-3 text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white rounded-br-sm'
                  : 'bg-gray-800 text-gray-100 rounded-bl-sm'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {isSending && (
          <div className="flex justify-start">
            <div className="bg-gray-800 text-gray-400 rounded-xl rounded-bl-sm px-4 py-3 text-sm">
              <span className="animate-pulse">…</span>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </section>

      {/* Input bar */}
      <footer className="border-t border-gray-800 p-4 bg-gray-950">
        <div className="flex gap-3 items-end">
          <textarea
            className="flex-1 resize-none rounded-lg bg-gray-900 border border-gray-700 px-4 py-2 text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 max-h-40"
            placeholder={activeAgent ? `Message ${activeAgent.name}…` : 'Select an agent…'}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={!activeAgentId || isSending}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || !activeAgentId || isSending}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </footer>
    </main>
  )
}
