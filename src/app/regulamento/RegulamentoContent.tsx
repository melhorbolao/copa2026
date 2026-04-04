'use client'

import { useState, useTransition } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { toast } from 'react-hot-toast'
import { saveRegulamento } from './actions'
import { useAdminView } from '@/contexts/AdminViewContext'

interface Props {
  content: string
  isAdmin: boolean
}

export function RegulamentoContent({ content, isAdmin }: Props) {
  const { viewMode } = useAdminView()
  const canEdit = isAdmin && viewMode === 'admin'
  const [editing,  setEditing]  = useState(false)
  const [saved,    setSaved]    = useState(content)
  const [draft,    setDraft]    = useState(content)
  const [pending,  startSave]   = useTransition()

  const handleSave = () => {
    startSave(async () => {
      try {
        await saveRegulamento(draft)
        setSaved(draft)
        setEditing(false)
        toast.success('Regulamento salvo!')
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Erro ao salvar')
      }
    })
  }

  const handleCancel = () => {
    setDraft(saved)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col bg-white">
        {/* Barra do editor */}
        <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 bg-gray-900">
          <span className="text-sm font-black uppercase tracking-wide text-white">Editar Regulamento</span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="rounded-lg px-4 py-1.5 text-sm font-semibold bg-gray-700 text-gray-200 hover:bg-gray-600 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={pending}
              className="rounded-lg px-4 py-1.5 text-sm font-bold bg-verde-600 text-white hover:bg-verde-700 disabled:opacity-50 transition"
            >
              {pending ? 'Salvando…' : 'Salvar'}
            </button>
          </div>
        </div>

        {/* Editor + Preview lado a lado */}
        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-1 flex-col border-r border-gray-200">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Markdown
            </div>
            <textarea
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 resize-none p-4 font-mono text-sm text-gray-800 focus:outline-none"
              spellCheck={false}
            />
          </div>
          <div className="flex flex-1 flex-col overflow-auto">
            <div className="border-b border-gray-100 bg-gray-50 px-3 py-1.5 text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Preview
            </div>
            <div className="p-6 overflow-auto">
              <MarkdownRenderer content={draft} />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="relative">
      {canEdit && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => { setDraft(saved); setEditing(true) }}
            className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition"
            style={{ backgroundColor: '#009c3b' }}
          >
            ✏️ Editar regulamento
          </button>
        </div>
      )}
      <MarkdownRenderer content={saved} />
    </div>
  )
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-3xl font-black text-gray-900 mb-1">{children}</h1>
        ),
        h2: ({ children }) => (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm mb-6">
            <h2 className="mb-3 text-base font-black text-gray-900">{children}</h2>
          </section>
        ),
        p: ({ children }) => (
          <p className="text-sm text-gray-700 leading-relaxed mb-3">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 text-gray-700 text-sm mb-3">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 text-gray-700 text-sm mb-3">{children}</ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        table: ({ children }) => (
          <div className="overflow-x-auto rounded-lg border border-gray-100 mb-3">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {children}
          </thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-t border-gray-100">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-gray-700">{children}</td>
        ),
        blockquote: ({ children }) => (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600 mb-3">
            {children}
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
