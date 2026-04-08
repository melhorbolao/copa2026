'use client'

import { useState } from 'react'

interface Props {
  emails: string[]
}

export function CopyEmailsButton({ emails }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    const text = emails.join(';')
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback para browsers sem clipboard API
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <button
      onClick={handleCopy}
      className="rounded-lg px-4 py-2 text-sm font-semibold text-white transition flex items-center gap-1.5"
      style={{ backgroundColor: copied ? '#009c3b' : '#6b7280' }}
      title={`${emails.length} e-mails copiados separados por ";"`}
    >
      {copied ? '✓ Copiado!' : `📋 Copiar e-mails (${emails.length})`}
    </button>
  )
}
