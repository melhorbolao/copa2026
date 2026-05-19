'use client'

import { useState, useEffect, useRef } from 'react'
import { setPagantesNote } from './actions'

interface Props {
  initialText: string
}

export function PagantesNote({ initialText }: Props) {
  const [open, setOpen]     = useState(false)
  const [text, setText]     = useState(initialText)
  const [saving, setSaving] = useState(false)
  const textareaRef         = useRef<HTMLTextAreaElement>(null)
  const debounceRef         = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open) setTimeout(() => textareaRef.current?.focus(), 50)
  }, [open])

  const handleChange = (val: string) => {
    setText(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setSaving(true)
    debounceRef.current = setTimeout(async () => {
      await setPagantesNote(val)
      setSaving(false)
    }, 800)
  }

  const lineCount = text ? text.split('\n').filter(l => l.trim()).length : 0

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-sm text-gray-400 hover:text-gray-600 transition underline underline-offset-2"
      >
        Pagantes sem cadastro{lineCount > 0 ? ` (${lineCount})` : ''}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between rounded-t-2xl bg-gray-900 px-5 py-3">
              <span className="text-sm font-black uppercase tracking-wide text-white">Pagantes sem cadastro</span>
              <button onClick={() => setOpen(false)} className="text-gray-400 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="p-4 flex flex-col gap-2">
              <p className="text-xs text-gray-400">Anotações livres — salvo automaticamente no banco.</p>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={e => handleChange(e.target.value)}
                rows={10}
                placeholder="Um nome por linha..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-verde-400 focus:outline-none resize-y"
              />
              <p className="text-right text-xs text-gray-300">
                {saving ? 'Salvando…' : `${lineCount} ${lineCount === 1 ? 'entrada' : 'entradas'}`}
              </p>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
