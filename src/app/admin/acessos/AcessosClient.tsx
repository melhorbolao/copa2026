'use client'

import { useState } from 'react'
import { PERMISSION_GROUPS } from '@/lib/permissions'
import { saveAdminPermissions } from '../actions'

interface AdminWithPermissions {
  id: string
  name: string
  email: string
  role: string
  allowed_pages: string[]
}

interface Props {
  admins: AdminWithPermissions[]
}

export function AcessosClient({ admins }: Props) {
  const [permissions, setPermissions] = useState<Record<string, string[]>>(
    Object.fromEntries(admins.map(a => [a.id, a.allowed_pages]))
  )
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved]   = useState<string | null>(null)
  const [error, setError]   = useState<string | null>(null)

  function toggle(userId: string, groupKey: string) {
    setPermissions(prev => {
      const current = prev[userId] ?? []
      const next = current.includes(groupKey)
        ? current.filter(p => p !== groupKey)
        : [...current, groupKey]
      return { ...prev, [userId]: next }
    })
  }

  async function save(userId: string) {
    setSaving(userId)
    setError(null)
    try {
      await saveAdminPermissions(userId, permissions[userId] ?? [])
      setSaved(userId)
      setTimeout(() => setSaved(null), 2500)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao salvar')
    } finally {
      setSaving(null)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-bold text-gray-900">Controle de Acessos</h2>
        <p className="mt-1 text-sm text-gray-500">
          Defina quais áreas cada Admin pode visualizar e gerenciar. As permissões são aplicadas imediatamente na próxima requisição do usuário.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {admins.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-12 text-center text-gray-400">
          <p className="font-medium">Nenhum usuário Admin encontrado.</p>
          <p className="mt-1 text-xs">Conceda o papel de Admin a um usuário na aba Usuários.</p>
        </div>
      ) : (
        admins.map(admin => (
          <div key={admin.id} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="font-semibold text-gray-900">{admin.name}</p>
                <p className="text-sm text-gray-400">{admin.email}</p>
              </div>
              <button
                onClick={() => save(admin.id)}
                disabled={saving === admin.id}
                className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                  saved === admin.id
                    ? 'bg-verde-100 text-verde-700'
                    : 'bg-verde-600 text-white hover:bg-verde-700'
                }`}
              >
                {saving === admin.id ? 'Salvando…' : saved === admin.id ? '✓ Salvo' : 'Salvar'}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {PERMISSION_GROUPS.map(group => {
                const enabled = (permissions[admin.id] ?? []).includes(group.key)
                return (
                  <label
                    key={group.key}
                    className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition ${
                      enabled
                        ? 'border-verde-300 bg-verde-50'
                        : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={() => toggle(admin.id, group.key)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded accent-verde-600"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900">{group.label}</p>
                      <p className="mt-0.5 text-xs text-gray-400">{group.description}</p>
                    </div>
                  </label>
                )
              })}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
