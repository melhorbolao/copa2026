'use client'

import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

function IconBot({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 0 1-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 0 1 4.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0 1 12 15a9.065 9.065 0 0 0-6.23-.693L5 14.5m14.8.8 1.402 1.402c1 1 .03 2.798-1.402 2.798H4.2c-1.432 0-2.402-1.798-1.401-2.798L4.1 15.3" />
    </svg>
  )
}

function IconSend({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </svg>
  )
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  )
}

const SUGGESTIONS = [
  'Quem está liderando a classificação?',
  'Quais jogos já aconteceram?',
  'Busca o participante "João"',
]

const transport = new DefaultChatTransport({ api: '/api/chatbot/chat' })

export function ChatbotClient() {
  const { messages, status, sendMessage, error } = useChat({ transport })
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  const isLoading = status === 'submitted' || status === 'streaming'

  // Detecta se há tool call em andamento (estado intermediário)
  const lastMsg = messages.at(-1)
  const hasActiveToolCall =
    status === 'streaming' &&
    lastMsg?.role === 'assistant' &&
    lastMsg.parts.some((p) => p.type === 'tool-invocation' && (p as { state?: string }).state === 'call')

  const loadingLabel = hasActiveToolCall ? 'Consultando banco de dados...' : 'Pensando...'

  useEffect(() => {
    if (error) console.error('[Assistente MB] erro:', error)
  }, [error])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text || isLoading) return
    setInput('')
    await sendMessage({ text })
  }, [input, isLoading, sendMessage])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Exibe apenas mensagens user/assistant com partes de texto
  const visibleMessages = messages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )

  function getTextContent(parts: typeof messages[0]['parts']): string {
    return parts
      .filter((p) => p.type === 'text')
      .map((p) => (p as { type: 'text'; text: string }).text)
      .join('')
  }

  return (
    <main className="flex flex-col h-[calc(100dvh-3.5rem)] sm:h-dvh bg-gray-950">
      {/* Cabeçalho */}
      <div className="shrink-0 px-4 py-3 border-b border-zinc-800 flex items-center gap-2">
        <IconBot className="w-5 h-5 text-yellow-400" />
        <span className="font-semibold text-zinc-100 text-sm">Assistente MB</span>
        <span className="ml-auto text-xs text-zinc-500 hidden sm:block">
          Classificação · Palpites · Participantes
        </span>
      </div>

      {/* Área de mensagens */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {visibleMessages.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 gap-3 pb-8">
            <IconBot className="w-12 h-12 text-zinc-700" />
            <p className="text-sm text-center leading-relaxed max-w-xs">
              Olá! Sou o Assistente MB.<br />
              Posso te ajudar com a classificação, palpites e participantes do bolão.
            </p>
            <div className="flex flex-col gap-1.5 mt-2 w-full max-w-xs">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  className="text-left text-xs text-zinc-400 bg-zinc-800 hover:bg-zinc-700 rounded-lg px-3 py-2 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {visibleMessages.map((m) => {
          const text = getTextContent(m.parts)
          if (!text && m.role === 'assistant') return null // pula steps intermediários sem texto

          return (
            <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {m.role === 'assistant' && (
                <div className="w-6 h-6 rounded-full bg-yellow-400/10 flex items-center justify-center mr-2 mt-1 shrink-0">
                  <IconBot className="w-3.5 h-3.5 text-yellow-400" />
                </div>
              )}
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-blue-600 text-white rounded-br-sm'
                    : 'bg-zinc-800 text-zinc-100 rounded-bl-sm'
                }`}
              >
                {m.role === 'user' ? (
                  <p className="whitespace-pre-wrap">{text}</p>
                ) : (
                  <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* Indicador de loading */}
        {isLoading && (
          <div className="flex justify-start items-start gap-2">
            <div className="w-6 h-6 rounded-full bg-yellow-400/10 flex items-center justify-center mt-1 shrink-0">
              <IconBot className="w-3.5 h-3.5 text-yellow-400" />
            </div>
            <div className="bg-zinc-800 rounded-2xl rounded-bl-sm px-4 py-2.5 flex items-center gap-2">
              <IconSpinner className="w-3.5 h-3.5 text-zinc-400 animate-spin" />
              <span className="text-xs text-zinc-400">{loadingLabel}</span>
            </div>
          </div>
        )}

        {/* Erro da API */}
        {error && (
          <div className="text-center">
            <p className="text-xs text-red-400 bg-red-900/20 rounded-lg px-3 py-2 inline-block">
              {error.message && error.message !== 'An error occurred.'
                ? error.message
                : 'Erro ao processar sua mensagem. Tente novamente.'}
            </p>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input fixo no rodapé */}
      <div className="shrink-0 border-t border-zinc-800 px-4 py-3">
        <div className="flex gap-2 items-end">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pergunte sobre o bolão... (Enter para enviar)"
            disabled={isLoading}
            rows={1}
            className="flex-1 resize-none bg-zinc-800 text-zinc-100 rounded-xl px-4 py-2.5 text-sm placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 max-h-32 overflow-y-auto"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={isLoading || !input.trim()}
            className="shrink-0 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl p-2.5 transition-colors"
            aria-label="Enviar mensagem"
          >
            <IconSend className="w-4 h-4" />
          </button>
        </div>
        <p className="text-[10px] text-zinc-600 mt-1.5 text-center">
          IA pode cometer erros. Confirme informações importantes.
        </p>
      </div>
    </main>
  )
}
