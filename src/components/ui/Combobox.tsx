'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

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

const MAX_H = 240 // max dropdown height in px

export function Combobox({ value, onChange, options, placeholder = '— selecione —', className = '' }: Props) {
  const [query,    setQuery]    = useState('')
  const [open,     setOpen]     = useState(false)
  const [dropStyle, setDropStyle] = useState<React.CSSProperties>({})
  const [mounted,  setMounted]  = useState(false)

  const inputRef    = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const listRef     = useRef<HTMLUListElement>(null)

  // Portal requires the DOM to be mounted
  useEffect(() => { setMounted(true) }, [])

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  // ── Compute dropdown position, accounting for iOS virtual keyboard ──────────
  const computePosition = useCallback(() => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()

    // On iOS with the keyboard open, visualViewport is smaller than window.innerHeight
    // and may have a non-zero offsetTop. We must use these values for correct placement.
    const vv    = window.visualViewport
    const viewH = vv?.height  ?? window.innerHeight
    const viewW = vv?.width   ?? window.innerWidth
    // visualViewport.offsetTop accounts for any fixed-toolbar offset on iOS
    const vtTop  = vv?.offsetTop  ?? 0
    const vtLeft = vv?.offsetLeft ?? 0

    // Positions relative to the visual viewport
    const top    = rect.top  - vtTop
    const bottom = rect.bottom - vtTop
    const left   = rect.left - vtLeft

    const goUp = (viewH - bottom) < MAX_H && top > MAX_H

    setDropStyle(
      goUp
        ? { position: 'fixed', bottom: viewH - top + 2,  left, width: rect.width, maxWidth: viewW - left - 4, zIndex: 9999 }
        : { position: 'fixed', top:    bottom + 2,        left, width: rect.width, maxWidth: viewW - left - 4, zIndex: 9999 },
    )
  }, [])

  // ── Close on outside mouse or touch ─────────────────────────────────────────
  useEffect(() => {
    if (!open) return

    const isInside = (node: Node | null): boolean =>
      !!node && (
        (containerRef.current?.contains(node) ?? false) ||
        (listRef.current?.contains(node) ?? false)
      )

    const onMouseDown = (e: MouseEvent) => {
      if (!isInside(e.target as Node)) { setOpen(false); setQuery('') }
    }
    const onTouchStart = (e: TouchEvent) => {
      const t = e.changedTouches[0]
      const el = document.elementFromPoint(t.clientX, t.clientY)
      if (!isInside(el)) { setOpen(false); setQuery('') }
    }

    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('touchstart', onTouchStart)
    }
  }, [open])

  // ── Reposition on scroll / viewport resize (e.g. keyboard appearing) ────────
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

  const handleSelect = (opt: Option) => {
    if (opt.disabled) return
    onChange(opt.value)
    setQuery('')
    setOpen(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); setQuery('') }
  }

  const inputValue = open ? query : selectedLabel

  // ── Dropdown rendered in a portal to escape any parent paint-containment ────
  // (contentVisibility:auto implies contain:paint, which clips position:fixed
  // children — portal at document.body avoids this entirely)
  const dropdown = (
    <ul
      ref={listRef}
      style={dropStyle}
      className="max-h-60 overflow-y-auto rounded border border-gray-200 bg-white shadow-lg"
    >
      {filtered.length === 0 ? (
        <li className="px-2 py-2 text-xs text-gray-400">Nenhum resultado</li>
      ) : (
        filtered.map(opt => (
          <li
            key={opt.value}
            // onMouseDown with preventDefault keeps the input focused (desktop)
            onMouseDown={e => { e.preventDefault(); handleSelect(opt) }}
            // onTouchEnd for touch devices — preventDefault stops the 300 ms delay
            // and the subsequent synthesised mousedown that would re-open the list
            onTouchEnd={e => { e.preventDefault(); handleSelect(opt) }}
            className={[
              'px-2 py-2.5 text-xs select-none',
              opt.disabled
                ? 'text-gray-300 cursor-not-allowed'
                : opt.value === value
                  ? 'bg-verde-50 text-verde-700 font-semibold cursor-pointer'
                  : 'text-gray-700 active:bg-gray-100 cursor-pointer',
            ].join(' ')}
          >
            {opt.label}
          </li>
        ))
      )}
    </ul>
  )

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
      {open && mounted && createPortal(dropdown, document.body)}
    </div>
  )
}
