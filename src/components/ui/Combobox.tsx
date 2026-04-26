'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Option {
  value: string
  label: string
  disabled?: boolean
}

interface Props {
  value: string
  onChange: (value: string) => void
  options: Option[]
  placeholder?: string
  className?: string
}

const MAX_H = 208 // max-h-52 = 13rem

export function Combobox({ value, onChange, options, placeholder = '— selecione —', className = '' }: Props) {
  const [query, setQuery] = useState('')
  const [open,  setOpen]  = useState(false)
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({ display: 'none' })

  const inputRef    = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  // Compute fixed position so the dropdown never extends the document height
  const computePosition = useCallback(() => {
    if (!containerRef.current) return
    const rect  = containerRef.current.getBoundingClientRect()
    const viewH = window.visualViewport?.height ?? window.innerHeight
    const viewW = window.visualViewport?.width  ?? window.innerWidth
    const goUp  = viewH - rect.bottom < MAX_H && rect.top > MAX_H

    setDropStyle(goUp
      ? { position: 'fixed', bottom: viewH - rect.top + 2, left: rect.left, width: rect.width, maxWidth: viewW - rect.left - 4, zIndex: 200 }
      : { position: 'fixed', top: rect.bottom + 2,         left: rect.left, width: rect.width, maxWidth: viewW - rect.left - 4, zIndex: 200 }
    )
  }, [])

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reposition while open (scroll / keyboard resize)
  useEffect(() => {
    if (!open) return
    const update = () => computePosition()
    window.addEventListener('scroll', update, { capture: true, passive: true })
    window.visualViewport?.addEventListener('resize', update)
    window.visualViewport?.addEventListener('scroll', update)
    return () => {
      window.removeEventListener('scroll', update, { capture: true })
      window.visualViewport?.removeEventListener('resize', update)
      window.visualViewport?.removeEventListener('scroll', update)
    }
  }, [open, computePosition])

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const handleFocus = () => {
    computePosition()
    setQuery('')
    setOpen(true)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value)
    setOpen(true)
  }

  const handleSelect = (e: React.MouseEvent, opt: Option) => {
    e.preventDefault()
    if (opt.disabled) return
    onChange(opt.value)
    setQuery('')
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  const inputValue = open ? query : selectedLabel

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={inputValue}
        placeholder={open ? (selectedLabel || placeholder) : (!value ? placeholder : undefined)}
        onChange={handleChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        className="w-full rounded border border-gray-200 py-1 px-1.5 text-xs focus:border-verde-400 focus:outline-none"
      />
      {open && (
        <ul
          style={dropStyle}
          className="max-h-52 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg"
        >
          {filtered.length === 0 ? (
            <li className="px-2 py-2 text-xs text-gray-400">Nenhum resultado</li>
          ) : (
            filtered.map(opt => (
              <li
                key={opt.value}
                onMouseDown={e => handleSelect(e, opt)}
                className={`px-2 py-1.5 text-xs select-none ${
                  opt.disabled
                    ? 'text-gray-300 cursor-not-allowed'
                    : opt.value === value
                      ? 'bg-verde-50 text-verde-700 font-semibold cursor-pointer'
                      : 'text-gray-700 hover:bg-gray-50 cursor-pointer'
                }`}
              >
                {opt.label}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
