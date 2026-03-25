import React, { useState, useCallback } from 'react'
import type { ThreadMessage, MessageMeta } from '../types/chat'
import MarkdownContent from './MarkdownContent'
import TtsAudioPlayer from './TtsAudioPlayer'

interface MessageBubbleProps {
  message: ThreadMessage
  isStreaming?: boolean
  agentIcon?: string
  ttsEnabled?: boolean
  ttsVoice?: string
  ttsActive?: boolean
  onCopy: () => void
  onRegenerate?: () => void
  onEditResend?: (newContent: string) => void
  onAudioStored?: (base64: string) => void
}

const COST_BADGE: Record<string, string> = {
  free: 'bg-green-900 text-green-300',
  cheap: 'bg-yellow-900 text-yellow-300',
  premium: 'bg-purple-900 text-purple-300',
}

function RoutingInfo({ explanation }: { explanation: NonNullable<MessageMeta['routingExplanation']> }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
      >
        <span>{open ? '▼' : '▶'}</span>
        Routed to: {explanation.selectedProvider}
      </button>
      {open && (
        <div className="mt-1 bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs text-gray-400 space-y-1">
          <p><span className="text-gray-500">Reason:</span> {explanation.reason}</p>
          <p><span className="text-gray-500">Chain:</span> {explanation.orderedChain.join(' → ')}</p>
          {explanation.policyMatches.length > 0 && (
            <p><span className="text-gray-500">Policies:</span> {explanation.policyMatches.join(', ')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  )
}

function EditIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
      />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
      />
    </svg>
  )
}

const MessageBubble = React.memo(function MessageBubble({
  message,
  isStreaming = false,
  agentIcon,
  ttsEnabled = false,
  ttsVoice,
  ttsActive = false,
  onCopy,
  onRegenerate,
  onEditResend,
  onAudioStored,
}: MessageBubbleProps) {
  const [editing, setEditing] = useState(false)
  const [editContent, setEditContent] = useState(message.content)
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(message.content).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch((err) => {
      console.warn('[MessageBubble] Clipboard write failed:', err)
      setCopied(false)
    })
    onCopy()
  }, [message.content, onCopy])

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content)
    setEditing(true)
  }, [message.content])

  const handleResend = useCallback(() => {
    const trimmed = editContent.trim()
    if (!trimmed) return
    setEditing(false)
    onEditResend?.(trimmed)
  }, [editContent, onEditResend])

  const handleCancelEdit = useCallback(() => {
    setEditing(false)
    setEditContent(message.content)
  }, [message.content])

  const handleEditKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleResend()
      }
      if (e.key === 'Escape') handleCancelEdit()
    },
    [handleResend, handleCancelEdit],
  )

  if (message.role === 'user') {
    return (
      <div className="flex justify-end group">
        <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
          {editing ? (
            <div className="w-full flex flex-col gap-2">
              <textarea
                autoFocus
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={3}
                className="w-full resize-none rounded-2xl bg-gray-800 border border-blue-500 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCancelEdit}
                  className="px-4 py-2 text-sm rounded-xl border border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors min-h-[40px]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleResend}
                  disabled={!editContent.trim()}
                  className="px-4 py-2 text-sm rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 transition-colors min-h-[40px]"
                >
                  Resend
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative bg-blue-600 text-white rounded-2xl rounded-br-sm px-4 py-3 text-sm whitespace-pre-wrap">
                {message.content}
              </div>
              {onEditResend && (
                <button
                  onClick={handleStartEdit}
                  className="mt-1 flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity min-h-[32px] px-2"
                  title="Edit and resend"
                >
                  <EditIcon />
                  Edit
                </button>
              )}
            </>
          )}
        </div>
      </div>
    )
  }

  // Assistant message
  const meta = message.meta
  const shouldShowTtsPlayer = ttsActive && !isStreaming && Boolean(message.content)
  return (
    <div className="flex justify-start gap-3 group">
      {agentIcon && (
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-800 flex items-center justify-center text-base mt-1 select-none">
          {agentIcon}
        </div>
      )}
      <div className="flex flex-col items-start max-w-[85%] sm:max-w-[80%]">
        <div
          className={`bg-gray-800 text-gray-100 rounded-2xl rounded-bl-sm px-4 py-3 text-sm prose prose-invert prose-sm max-w-none ${
            isStreaming ? 'streaming-cursor' : ''
          }`}
        >
          {message.content ? (
            <MarkdownContent content={message.content} />
          ) : isStreaming ? null : (
            <span className="text-gray-500">…</span>
          )}

          {/* Inline TTS audio player — only shown when TTS is active for this chat */}
          {shouldShowTtsPlayer && (
            <TtsAudioPlayer
              text={message.content}
              ttsEnabled={ttsEnabled}
              voice={ttsVoice}
              audioBase64={message.ttsAudioBase64}
              onAudioStored={onAudioStored}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-800 min-h-[36px]"
            title="Copy"
          >
            <CopyIcon />
            <span className="hidden sm:inline">{copied ? 'Copied!' : 'Copy'}</span>
          </button>
          {onRegenerate && !isStreaming && (
            <button
              onClick={onRegenerate}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors px-2 py-1.5 rounded-lg hover:bg-gray-800 min-h-[36px]"
              title="Regenerate"
            >
              <RefreshIcon />
              <span className="hidden sm:inline">Regenerate</span>
            </button>
          )}
        </div>

        {/* Metadata footer */}
        {meta && !isStreaming && (
          <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-gray-500">
            {meta.model && <span className="font-mono">{meta.model}</span>}
            {meta.usedProvider && (
              <span className="text-gray-600">via {meta.usedProvider}</span>
            )}
            {meta.latencyMs !== undefined && (
              <span>{meta.latencyMs}ms</span>
            )}
            {meta.usage && (
              <span>
                {meta.usage.promptTokens}↑ {meta.usage.completionTokens}↓ ={' '}
                {meta.usage.totalTokens} tok
              </span>
            )}
            {meta.costClass && (
              <span
                className={`px-1.5 py-0.5 rounded text-xs font-medium ${COST_BADGE[meta.costClass] ?? 'bg-gray-700 text-gray-300'}`}
              >
                {meta.costClass}
              </span>
            )}
          </div>
        )}
        {meta && !isStreaming && meta.toolsAvailable && meta.toolsAvailable.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs text-gray-500">🔧</span>
            {meta.toolsAvailable.map((t) => (
              <span key={t} className="text-xs px-1.5 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">{t}</span>
            ))}
          </div>
        )}
        {meta && !isStreaming && meta.routingExplanation && (
          <RoutingInfo explanation={meta.routingExplanation} />
        )}
      </div>
    </div>
  )
})

export default MessageBubble
