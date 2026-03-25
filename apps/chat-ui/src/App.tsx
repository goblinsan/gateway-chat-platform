import { useMemo, useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { AgentListItem, AgentsListResponse } from '@gateway/shared'
import ChatPage from './pages/ChatPage'
import HealthPage from './pages/HealthPage'
import AdminPage from './pages/AdminPage'
import Sidebar from './components/Sidebar'
import AgentTabs from './components/AgentTabs'
import WorkflowPanel from './components/WorkflowPanel'
import { useThreads } from './hooks/useThreads'

function ChatLayout() {
  const { data, isLoading } = useQuery<AgentsListResponse>({
    queryKey: ['agents'],
    queryFn: () => axios.get<AgentsListResponse>('/api/agents').then((r) => r.data),
  })
  const agents = useMemo<AgentListItem[]>(() => data?.agents ?? [], [data])

  const [activeAgentId, setActiveAgentId] = useState<string>('')
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)

  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    createThread,
    addMessage,
    updateLastAssistantMessage,
    updateMessageTtsAudio,
    setThreadTtsEnabled,
    setThreadMessages,
    deleteThread,
  } = useThreads()

  // Select first agent once loaded
  useEffect(() => {
    if (agents.length > 0 && !activeAgentId) {
      setActiveAgentId(agents[0].id)
    }
  }, [agents, activeAgentId])

  const activeAgent = agents.find((a) => a.id === activeAgentId)

  // When switching agent, auto-select most recent thread for that agent (or none)
  const handleSelectAgent = (agentId: string) => {
    setActiveAgentId(agentId)
    const recent = [...threads]
      .filter((t) => t.agentId === agentId)
      .sort((a, b) => b.createdAt - a.createdAt)[0]
    setActiveThreadId(recent?.id ?? null)
  }

  const handleNewChat = () => {
    setActiveThreadId(null)
  }

  const handleSelectThread = (threadId: string) => {
    const thread = threads.find((t) => t.id === threadId)
    if (thread) {
      setActiveAgentId(thread.agentId)
      setActiveThreadId(threadId)
    }
  }

  return (
    <div className="flex h-screen overflow-hidden bg-gray-950 text-gray-100">
      <Sidebar
        agents={agents}
        threads={threads}
        activeThreadId={activeThreadId}
        activeAgentId={activeAgentId}
        isOpen={sidebarOpen}
        onSelectThread={(id) => { handleSelectThread(id); setSidebarOpen(false) }}
        onNewChat={() => { handleNewChat(); setSidebarOpen(false) }}
        onDeleteThread={deleteThread}
        onWorkflows={() => setShowWorkflows((v) => !v)}
        onClose={() => setSidebarOpen(false)}
      />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile top bar with hamburger */}
        <div className="flex items-center gap-2 md:hidden border-b border-gray-800 px-3 py-2 bg-gray-900">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 rounded-lg text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <span className="text-sm font-semibold text-gray-100">Gateway Chat</span>
        </div>

        {isLoading ? (
          <div className="border-b border-gray-800 px-6 py-3 text-gray-500 text-sm">
            Loading agents…
          </div>
        ) : (
          <AgentTabs
            agents={agents}
            activeAgentId={activeAgentId}
            onSelect={handleSelectAgent}
          />
        )}
        <ChatPage
          activeAgentId={activeAgentId}
          activeAgent={activeAgent}
          agents={agents}
          threads={threads}
          activeThreadId={activeThreadId}
          onSetActiveThreadId={setActiveThreadId}
          onCreateThread={createThread}
          onAddMessage={addMessage}
          onUpdateLastAssistantMessage={updateLastAssistantMessage}
          onSetThreadMessages={setThreadMessages}
          onUpdateMessageTtsAudio={updateMessageTtsAudio}
          onSetThreadTtsEnabled={setThreadTtsEnabled}
        />
        {showWorkflows && (
          <WorkflowPanel agents={agents} onClose={() => setShowWorkflows(false)} />
        )}
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatLayout />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="/admin" element={<AdminPage />} />
    </Routes>
  )
}
