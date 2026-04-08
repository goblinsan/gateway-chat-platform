import { useMemo, useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import type { AgentListItem, AgentsListResponse } from '@gateway/shared'
import type { InboxItem } from '@gateway/shared'
import ChatPage from './pages/ChatPage'
import HealthPage from './pages/HealthPage'
import AdminPage from './pages/AdminPage'
import Sidebar from './components/Sidebar'
import AgentTabs from './components/AgentTabs'
import WorkflowPanel from './components/WorkflowPanel'
import InboxPanel from './components/InboxPanel'
import PersonasPanel from './components/PersonasPanel'
import { personaToAgentListItem } from './utils/persona'
import { useThreads } from './hooks/useThreads'
import { useInbox, type ChatInboxScope } from './hooks/useInbox'
import { usePersonas } from './hooks/usePersonas'

function resolveInboxScope(): ChatInboxScope {
  try {
    return {
      userId: localStorage.getItem('gateway-chat-user-id')?.trim() || 'me',
      channelId: localStorage.getItem('gateway-chat-channel-id')?.trim() || 'coach',
    }
  } catch {
    return { userId: 'me', channelId: 'coach' }
  }
}

function ChatLayout() {
  const { data, isLoading } = useQuery<AgentsListResponse>({
    queryKey: ['agents'],
    queryFn: () => axios.get<AgentsListResponse>('/api/agents').then((r) => r.data),
  })
  const operatorAgents = useMemo<AgentListItem[]>(() => data?.agents ?? [], [data])

  const personas = usePersonas()

  // Merge operator agents and enabled user personas into a single list
  const agents = useMemo<AgentListItem[]>(() => {
    const personaItems = personas.personas
      .filter((p) => p.enabled)
      .map(personaToAgentListItem)
    return [...operatorAgents, ...personaItems]
  }, [operatorAgents, personas.personas])

  const personaIdSet = useMemo(
    () => new Set(personas.personas.filter((p) => p.enabled).map((p) => p.id)),
    [personas.personas],
  )

  const [activeAgentId, setActiveAgentId] = useState<string>('')
  const [showWorkflows, setShowWorkflows] = useState(false)
  const [showInbox, setShowInbox] = useState(false)
  const [showPersonas, setShowPersonas] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [inboxScope] = useState<ChatInboxScope>(() => resolveInboxScope())

  const {
    threads,
    activeThreadId,
    setActiveThreadId,
    createThread,
    upsertThread,
    addMessage,
    updateLastAssistantMessage,
    updateMessageTtsAudio,
    setThreadTtsEnabled,
    setThreadDefaultModel,
    setThreadMessages,
    deleteThread,
    getThread,
  } = useThreads(inboxScope.userId)
  const inbox = useInbox(inboxScope)

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

  const handleOpenInboxItem = async (item: InboxItem) => {
    const threadId = item.threadId || `inbox-${item.id}`
    const existingThread = getThread(threadId)

    upsertThread({
      id: threadId,
      agentId: item.agentId,
      title: item.threadTitle || item.title || existingThread?.title || 'Inbox',
      createdAt: existingThread?.createdAt ?? (Date.parse(item.createdAt) || Date.now()),
      messages: existingThread?.messages ?? [],
      ttsEnabled: existingThread?.ttsEnabled ?? true,
    })

    const alreadyInserted = existingThread?.messages.some(
      (message) => message.meta?.inboxMessageId === item.id,
    )
    if (!alreadyInserted) {
      addMessage(threadId, {
        role: 'assistant',
        content: item.content,
        meta: {
          inboxMessageId: item.id,
          inboxKind: item.kind,
          inboxChannelId: item.channelId,
        },
      })
    }

    setActiveAgentId(item.agentId)
    setActiveThreadId(threadId)
    setShowInbox(false)
    setSidebarOpen(false)
    await inbox.acknowledge(item.id)
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
        unreadCount={inbox.unreadCount}
        onInbox={() => setShowInbox((value) => !value)}
        onPersonas={() => { setShowPersonas((v) => !v); setSidebarOpen(false) }}
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
          <button
            type="button"
            onClick={() => setShowInbox((value) => !value)}
            className="ml-auto px-2.5 py-1 border border-gray-700 text-xs text-gray-300"
          >
            Inbox {inbox.unreadCount > 0 ? `(${inbox.unreadCount})` : ''}
          </button>
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
            personaIds={personaIdSet}
            onOpenPersonas={() => setShowPersonas((v) => !v)}
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
          onSetThreadDefaultModel={setThreadDefaultModel}
        />
        {showWorkflows && (
          <WorkflowPanel agents={agents} onClose={() => setShowWorkflows(false)} />
        )}
      </div>
      <InboxPanel
        isOpen={showInbox}
        items={inbox.items}
        unreadCount={inbox.unreadCount}
        loading={inbox.loading}
        error={inbox.error}
        scopeLabel={`${inboxScope.userId} / ${inboxScope.channelId}`}
        onRefresh={() => { void inbox.refresh() }}
        onOpenItem={(item) => { void handleOpenInboxItem(item) }}
        onClose={() => setShowInbox(false)}
      />
      <PersonasPanel
        isOpen={showPersonas}
        personas={personas.personas}
        loading={personas.loading}
        error={personas.error}
        onRefresh={() => { void personas.refresh() }}
        onCreate={(data) => personas.create(data)}
        onUpdate={(id, data) => personas.update(id, data)}
        onDelete={(id) => personas.remove(id)}
        onDuplicate={(id) => personas.duplicate(id)}
        onGetFull={(id) => personas.getFull(id)}
        onSelectPersona={(persona) => {
          handleSelectAgent(persona.id)
          setShowPersonas(false)
        }}
        activePersonaId={personaIdSet.has(activeAgentId) ? activeAgentId : undefined}
        onClose={() => setShowPersonas(false)}
      />
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
