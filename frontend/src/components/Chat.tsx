import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { streamChat } from '../api/client'
import type { Message, Source } from '../types'

interface Props {
  messages: Message[]
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  sources: Source[]
}

function SourceBadge({ name, type, page, url, title }: { name: string; type: string; page?: number; url?: string; title?: string }) {
  const displayName = title || name
  const label = type === 'pdf' && page ? `${displayName} · p.${page}` : displayName
  const href = type === 'url' && url ? url : undefined
  const base = 'inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium'

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer"
        className={`${base} bg-blue-900/40 text-blue-300 hover:bg-blue-800/50 transition-colors`}>
        🔗 {label}
      </a>
    )
  }
  return (
    <span className={`${base} bg-red-900/30 text-red-300`}>
      📄 {label}
    </span>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[85%] ${isUser ? 'order-1' : ''}`}>
        {/* Avatar label */}
        <p className={`text-xs text-gray-500 mb-1 ${isUser ? 'text-right' : ''}`}>
          {isUser ? 'You' : 'Helmsman'}
        </p>

        {/* Bubble */}
        <div
          className={`rounded-2xl px-4 py-3 ${
            isUser
              ? 'bg-indigo-600 text-white rounded-tr-sm'
              : 'bg-gray-800 text-gray-100 rounded-tl-sm'
          }`}
        >
          {msg.error ? (
            <p className="text-red-400 text-sm">{msg.error}</p>
          ) : isUser ? (
            <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
          ) : (
            <div className="prose-dark text-sm">
              <ReactMarkdown>{msg.content || ' '}</ReactMarkdown>
              {msg.isStreaming && (
                <span className="inline-block w-2 h-4 bg-gray-400 animate-pulse rounded-sm ml-0.5 align-middle" />
              )}
            </div>
          )}
        </div>

        {/* Source refs */}
        {!isUser && msg.sources && msg.sources.length > 0 && !msg.isStreaming && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {msg.sources.map((s, i) => (
              <SourceBadge
                key={i}
                name={s.source_name}
                type={s.source_type}
                title={s.title}
                page={s.page ?? undefined}
                url={s.url ?? undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

let _id = 0
const uid = () => String(++_id)

export default function Chat({ messages, setMessages, sources }: Props) {
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // Refs for accumulating streaming text without triggering renders on each token
  const streamAccRef = useRef<string>('')
  const streamMsgIdRef = useRef<string | null>(null)

  // RAF loop: reads the accumulated ref and pushes to React state at ~60fps
  useEffect(() => {
    if (!streaming) return
    let rafId: number
    const tick = () => {
      const id = streamMsgIdRef.current
      if (id !== null) {
        const text = streamAccRef.current
        setMessages(prev => prev.map(m => m.id === id ? { ...m, content: text } : m))
      }
      rafId = requestAnimationFrame(tick)
    }
    rafId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafId)
  }, [streaming, setMessages])

  // Auto-scroll on new content
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault()
    const query = input.trim()
    if (!query || streaming) return

    const userMsg: Message = { id: uid(), role: 'user', content: query }
    const assistantMsg: Message = { id: uid(), role: 'assistant', content: '', isStreaming: true }

    streamAccRef.current = ''
    streamMsgIdRef.current = assistantMsg.id

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')
    setStreaming(true)

    // Pass full history (without the blank assistant placeholder)
    const history = [...messages, userMsg]

    try {
      for await (const event of streamChat(query, history)) {
        if (event.type === 'sources') {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, sources: event.data } : m
            )
          )
        } else if (event.type === 'text') {
          // Only update ref — RAF loop pushes to React state at 60fps
          streamAccRef.current += event.data
        } else if (event.type === 'error') {
          streamMsgIdRef.current = null
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, isStreaming: false, error: event.data }
                : m
            )
          )
        } else if (event.type === 'done') {
          streamMsgIdRef.current = null
          const finalContent = streamAccRef.current
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id
                ? { ...m, content: finalContent, isStreaming: false }
                : m
            )
          )
        }
      }
    } catch (err) {
      streamMsgIdRef.current = null
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsg.id
            ? { ...m, isStreaming: false, error: String(err) }
            : m
        )
      )
    } finally {
      setStreaming(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const noSources = sources.length === 0

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Message list */}
      <div className="flex-1 overflow-y-auto px-6 py-6">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-600 select-none">
            <p className="text-4xl mb-3">⚓</p>
            <p className="text-lg font-medium text-gray-500">AI Helmsman</p>
            <p className="text-sm mt-1 max-w-xs">
              {noSources
                ? 'Add a PDF or URL in the sidebar, then ask anything about it.'
                : 'Ask anything about your documents.'}
            </p>
          </div>
        ) : (
          messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-gray-800 px-4 py-3 bg-gray-900">
        {noSources && (
          <p className="text-xs text-yellow-600 mb-2 text-center">
            No sources indexed yet — answers will use Claude's general knowledge only.
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            rows={1}
            value={input}
            onChange={(e) => {
              setInput(e.target.value)
              // Auto-grow
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`
            }}
            onKeyDown={onKeyDown}
            placeholder={streaming ? 'Waiting for response…' : 'Ask a question… (Enter to send, Shift+Enter for newline)'}
            disabled={streaming}
            className="flex-1 resize-none bg-gray-800 border border-gray-700 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none transition-colors max-h-40 overflow-y-auto disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || streaming}
            className="flex-shrink-0 w-10 h-10 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-xl transition-colors"
            title="Send"
          >
            {streaming ? (
              <svg className="w-4 h-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            ) : (
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            )}
          </button>
        </form>
      </div>
    </div>
  )
}
