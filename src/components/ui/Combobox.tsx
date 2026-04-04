'use client'

import { useState, useRef, useEffect } from 'react'

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

const DROPDOWN_HEIGHT = 208 // max-h-52 = 13rem = 208px

export function Combobox({ value, onChange, options, placeholder = '— selecione —', className = '' }: Props) {
  const [query, setQuery]     = useState('')
  const [open,  setOpen]      = useState(false)
  const [dropUp, setDropUp]   = useState(false)
  const inputRef              = useRef<HTMLInputElement>(null)
  const containerRef          = useRef<HTMLDivElement>(null)

  const selectedLabel = options.find(o => o.value === value)?.label ?? ''

  // Fecha ao clicar fora
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

  const filtered = query.trim()
    ? options.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  const checkDropDirection = () => {
    if (!containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    setDropUp(spaceBelow < DROPDOWN_HEIGHT)
  }

  const handleFocus = () => {
    checkDropDirection()
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
        <ul className={`absolute z-[200] max-h-52 w-full overflow-y-auto rounded border border-gray-200 bg-white shadow-lg ${
          dropUp ? 'bottom-full mb-0.5' : 'top-full mt-0.5'
        }`}>
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
