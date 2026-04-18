'use client'

import { useState, useTransition } from 'react'
import { updateTeam } from './actions'

type Team = {
  name: string
  abbr_br: string
  abbr_fifa: string
  group_name: string
}

type EditingRow = {
  abbr_br: string
  abbr_fifa: string
  group_name: string
}

export function EquipesClient({ teams }: { teams: Team[] }) {
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<EditingRow>({ abbr_br: '', abbr_fifa: '', group_name: '' })
  const [rowError, setRowError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function startEdit(team: Team) {
    setEditing(team.name)
    setDraft({ abbr_br: team.abbr_br, abbr_fifa: team.abbr_fifa, group_name: team.group_name })
    setRowError(null)
  }

  function cancelEdit() {
    setEditing(null)
    setRowError(null)
  }

  function save(name: string) {
    const group = draft.group_name.toUpperCase()
    if (!/^[A-L]$/.test(group)) {
      setRowError('Grupo deve ser uma letra de A a L.')
      return
    }
    startTransition(async () => {
      const res = await updateTeam(name, {
        abbr_br: draft.abbr_br.trim().toUpperCase(),
        abbr_fifa: draft.abbr_fifa.trim().toUpperCase(),
        group_name: group,
      })
      if (res.error) {
        setRowError(res.error)
      } else {
        setEditing(null)
        setRowError(null)
      }
    })
  }

  const sorted = [...teams].sort((a, b) =>
    a.group_name.localeCompare(b.group_name) || a.name.localeCompare(b.name, 'pt')
  )

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 w-8">#</th>
              <th className="px-4 py-3">Equipe</th>
              <th className="px-4 py-3 w-28">Sigla BR</th>
              <th className="px-4 py-3 w-28">FIFA</th>
              <th className="px-4 py-3 w-20">Grupo</th>
              <th className="px-4 py-3 w-24"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sorted.map((team, i) => {
              const isEditing = editing === team.name
              return (
                <tr key={team.name} className={isEditing ? 'bg-verde-50' : 'hover:bg-gray-50'}>
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-4 py-2 font-medium text-gray-900">{team.name}</td>

                  {isEditing ? (
                    <>
                      <td className="px-4 py-2">
                        <input
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono uppercase focus:border-verde-500 focus:outline-none"
                          value={draft.abbr_br}
                          maxLength={4}
                          onChange={e => setDraft(d => ({ ...d, abbr_br: e.target.value }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="w-full rounded border border-gray-300 px-2 py-1 text-xs font-mono uppercase focus:border-verde-500 focus:outline-none"
                          value={draft.abbr_fifa}
                          maxLength={4}
                          onChange={e => setDraft(d => ({ ...d, abbr_fifa: e.target.value }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <input
                          className="w-16 rounded border border-gray-300 px-2 py-1 text-xs font-mono uppercase focus:border-verde-500 focus:outline-none"
                          value={draft.group_name}
                          maxLength={1}
                          onChange={e => setDraft(d => ({ ...d, group_name: e.target.value }))}
                        />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => save(team.name)}
                            disabled={pending}
                            className="rounded bg-verde-600 px-3 py-1 text-xs font-semibold text-white hover:bg-verde-700 disabled:opacity-40"
                          >
                            {pending ? '…' : 'Salvar'}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={pending}
                            className="rounded border border-gray-200 px-3 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                          >
                            Cancelar
                          </button>
                        </div>
                        {rowError && (
                          <p className="mt-1 text-xs text-red-600">{rowError}</p>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{team.abbr_br}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-700">{team.abbr_fifa}</td>
                      <td className="px-4 py-2">
                        <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-verde-100 text-xs font-bold text-verde-800">
                          {team.group_name}
                        </span>
                      </td>
                      <td className="px-4 py-2">
                        <button
                          onClick={() => startEdit(team)}
                          className="text-xs text-verde-600 hover:underline"
                        >
                          Editar
                        </button>
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
