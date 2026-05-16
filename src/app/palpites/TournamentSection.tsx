'use client'

import { useTransition, useState, useEffect, useRef } from 'react'
import { saveTournamentBet } from './actions'
import { isDeadlinePassed, formatBrasilia } from '@/utils/date'
import type { TournamentBetBreakdown } from '@/lib/scoring/engine'

interface Team { team: string; flag: string }
interface TBet { champion: string; runner_up: string; semi1: string; semi2: string; top_scorer: string; points?: number | null }

const EMPTY: TBet = { champion: '', runner_up: '', semi1: '', semi2: '', top_scorer: '' }
const STORAGE_KEY = 'bolao_tbet'

function readStorage(): TBet | null {
  try {
    if (typeof window === 'undefined') return null
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as TBet : null
  } catch { return null }
}
function writeStorage(f: TBet) {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(f)) } catch {}
}

interface Props {
  allTeams: Team[]
  deadline: string
  existingBet: TBet | null
  scorerMapping?: Record<string, string>
  liveScore?: number | null
  liveBreakdown?: TournamentBetBreakdown | null
}

function ScoreBadge({ pts, compact = false }: { pts: number | null | undefined; compact?: boolean }) {
  if (pts == null) return null
  if (pts > 0) return <span className={`font-bold text-verde-500 ${compact ? 'text-[10px]' : 'text-xs'}`}>+{pts} pts</span>
  return <span className={`text-gray-400 ${compact ? 'text-[10px]' : 'text-xs'}`}>0 pts</span>
}

export function TournamentSection({ allTeams, deadline, existingBet, scorerMapping, liveScore, liveBreakdown }: Props) {
  const [pending, startTransition] = useTransition()

  const [form, setForm] = useState<TBet>(() => {
    // Prefer server data if any G4/artilheiro field has been saved
    const hasServer = existingBet && (
      existingBet.champion || existingBet.runner_up ||
      existingBet.semi1    || existingBet.semi2 || existingBet.top_scorer
    )
    if (hasServer) return {
      champion:   existingBet!.champion   ?? '',
      runner_up:  existingBet!.runner_up  ?? '',
      semi1:      existingBet!.semi1      ?? '',
      semi2:      existingBet!.semi2      ?? '',
      top_scorer: existingBet!.top_scorer ?? '',
    }
    // No server data — restore from sessionStorage (survived tab switch)
    return readStorage() ?? EMPTY
  })

  const [error, setError]     = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [savedOk, setSavedOk] = useState(false)

  const timerRef      = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const hasPendingRef = useRef(false)
  const latestFormRef = useRef<TBet>(form)

  const deadlinePassed = isDeadlinePassed(deadline)

  // Keep latestFormRef in sync so the unmount cleanup uses the latest value
  useEffect(() => { latestFormRef.current = form }, [form])

  // When server data arrives (e.g. revalidation), sync form and storage
  useEffect(() => {
    if (existingBet) {
      const f = {
        champion:   existingBet.champion   ?? '',
        runner_up:  existingBet.runner_up  ?? '',
        semi1:      existingBet.semi1      ?? '',
        semi2:      existingBet.semi2      ?? '',
        top_scorer: existingBet.top_scorer ?? '',
      }
      setForm(f)
      writeStorage(f)
    }
  }, [existingBet])

  // Flush any pending save when the component unmounts (tab switch, navigation)
  useEffect(() => {
    return () => {
      if (hasPendingRef.current) {
        clearTimeout(timerRef.current)
        void saveTournamentBet(latestFormRef.current)
      }
    }
  }, [])

  const triggerSave = (updated: TBet, delay = 0) => {
    clearTimeout(timerRef.current)
    setError('')
    setIsDirty(true)
    setSavedOk(false)
    hasPendingRef.current = true
    writeStorage(updated)           // Persist immediately — survives unmount
    timerRef.current = setTimeout(() => {
      hasPendingRef.current = false
      startTransition(async () => {
        const r = await saveTournamentBet(updated)
        if (r.error) { setError(r.error); setIsDirty(true) }
        else { setIsDirty(false); setSavedOk(true) }
      })
    }, delay)
  }

  const handleSelect = (field: keyof TBet, value: string) => {
    const updated = { ...form, [field]: value }
    setForm(updated)
    triggerSave(updated)
  }

  const handleScorer = (value: string) => {
    const updated = { ...form, top_scorer: value }
    setForm(updated)
    triggerSave(updated, 800)
  }

  const handleManualSave = () => {
    clearTimeout(timerRef.current)
    hasPendingRef.current = false
    startTransition(async () => {
      const r = await saveTournamentBet(form)
      if (r.error) { setError(r.error); setIsDirty(true) }
      else { setIsDirty(false); setSavedOk(true) }
    })
  }

  const teams    = allTeams.filter(t => t.team !== 'TBD')
  const selected = [form.champion, form.runner_up, form.semi1, form.semi2]

  // Detecta campos G4 com valores duplicados
  const conflictFields = new Set<string>()
  const g4Entries: [string, string][] = [
    ['champion', form.champion], ['runner_up', form.runner_up],
    ['semi1', form.semi1],       ['semi2', form.semi2],
  ]
  const seenG4 = new Map<string, string>()
  for (const [field, val] of g4Entries) {
    if (!val) continue
    if (seenG4.has(val)) { conflictFields.add(field); conflictFields.add(seenG4.get(val)!) }
    else seenG4.set(val, field)
  }

  if (deadlinePassed) {
    const fields: { label: string; val: string; key: keyof TournamentBetBreakdown }[] = [
      { label: '🥇 Campeão',    val: existingBet?.champion   ?? '',  key: 'champion'   },
      { label: '🥈 Vice',       val: existingBet?.runner_up  ?? '',  key: 'runner_up'  },
      { label: '3º Lugar',      val: existingBet?.semi1      ?? '',  key: 'semi1'      },
      { label: '4º Lugar',      val: existingBet?.semi2      ?? '',  key: 'semi2'      },
      { label: '⚽ Artilheiro', val: scorerMapping?.[existingBet?.top_scorer ?? ''] ?? existingBet?.top_scorer ?? '', key: 'top_scorer' },
    ]

    return (
      <div className="border-t-4 border-azul-escuro bg-white">
        <div className="flex items-center justify-between gap-3 bg-gray-900 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <span className="text-sm font-black uppercase tracking-widest text-white">🏆 Bônus G4 e Artilheiro</span>
            <span className="rounded-full bg-gray-700 px-2 py-0.5 text-xs text-gray-300">🔒 encerrado</span>
          </div>
          {existingBet && (() => {
            const pts = existingBet.points ?? liveScore ?? null
            if (pts === null) return <span className="text-xs text-gray-400">⌛</span>
            return pts > 0
              ? <span className="text-xs font-bold text-verde-400">+{pts} pts</span>
              : <span className="text-xs text-gray-500">0 pts</span>
          })()}
        </div>
        {existingBet ? (
          <div className="grid grid-cols-2 gap-0 divide-x divide-y divide-gray-100 sm:grid-cols-3 lg:grid-cols-5">
            {fields.map(({ label, val, key }) => (
              <div key={label} className="px-4 py-3">
                <div className="text-xs text-gray-400">{label}</div>
                <div className="mt-0.5 font-bold text-gray-900">{val || '—'}</div>
                {liveBreakdown && val && (
                  <div className="mt-0.5">
                    <ScoreBadge pts={liveBreakdown[key]} />
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="px-4 py-3 text-sm text-gray-400">Sem aposta de torneio registrada.</p>
        )}
      </div>
    )
  }

  const fieldDefs: { field: keyof TBet & keyof TournamentBetBreakdown; label: string }[] = [
    { field: 'champion',  label: '🥇 Campeão'       },
    { field: 'runner_up', label: '🥈 Vice-Campeão'  },
    { field: 'semi1',     label: '🥉 3º Lugar'      },
    { field: 'semi2',     label: '4️⃣ 4º Lugar'      },
  ]

  return (
    <div className="border-t-4 border-azul-escuro bg-white">
      <div className="flex items-center justify-between bg-gray-900 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-sm font-black uppercase tracking-widest text-white">🏆 Bônus G4 e Artilheiro</span>
          {pending && <span className="text-xs text-amber-300 animate-pulse">Salvando…</span>}
          {!pending && savedOk && <span className="text-xs text-verde-400">Salvo ✓</span>}
          {!pending && !savedOk && (() => {
            const pts = existingBet?.points ?? liveScore ?? null
            if (pts === null) return null
            return pts > 0
              ? <span className="text-xs font-bold text-verde-400">+{pts} pts</span>
              : <span className="text-xs text-gray-500">0 pts</span>
          })()}
        </div>
        <span className="text-xs text-gray-400">
          prazo: {formatBrasilia(deadline, "dd/MM HH:mm")}
        </span>
      </div>

      <div className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {fieldDefs.map(({ field, label }) => {
            const others = selected.filter(v => v !== form[field])
            const hasConflict = conflictFields.has(field)
            const pts = liveBreakdown?.[field as keyof TournamentBetBreakdown]
            return (
              <div key={field}>
                <label className={`mb-1 flex items-center justify-between gap-1 text-xs font-semibold ${hasConflict ? 'text-red-500' : 'text-gray-500'}`}>
                  <span>{label}{hasConflict && ' ⚠️'}</span>
                  {liveBreakdown && form[field] && <ScoreBadge pts={pts} compact />}
                </label>
                <select
                  value={form[field] as string}
                  onChange={e => handleSelect(field, e.target.value)}
                  className={`w-full rounded border border-gray-200 bg-white py-1.5 pl-1.5 pr-5 text-xs focus:border-verde-400 focus:outline-none${hasConflict ? ' ring-1 ring-red-400' : ''}`}
                >
                  <option value="">— selecione —</option>
                  {teams.map(t => (
                    <option key={t.team} value={t.team} disabled={others.includes(t.team)}>
                      {t.team}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}

          <div>
            <label className="mb-1 flex items-center justify-between gap-1 text-xs font-semibold text-gray-500">
              <span>⚽ Artilheiro</span>
              {liveBreakdown && form.top_scorer && <ScoreBadge pts={liveBreakdown.top_scorer} compact />}
            </label>
            <input
              type="text"
              value={form.top_scorer}
              onChange={e => handleScorer(e.target.value)}
              placeholder=""
              className="w-full rounded border border-gray-200 py-1 px-1.5 text-xs focus:border-verde-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="space-y-1">
            {conflictFields.size > 0 && (
              <p className="text-xs text-red-500 font-medium">
                ⚠️ Times repetidos no G4: corrija os campos marcados acima.
              </p>
            )}
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>

          <div className="flex items-center gap-2">
            {pending && (
              <span className="text-xs text-amber-600 animate-pulse">Salvando…</span>
            )}
            {!pending && savedOk && (
              <span className="text-xs font-medium text-verde-600">Salvo ✓</span>
            )}
            {!pending && isDirty && conflictFields.size === 0 && (
              <button
                onClick={handleManualSave}
                className="rounded-lg bg-verde-600 px-4 py-1.5 text-xs font-semibold text-white shadow hover:bg-verde-700 active:scale-95 transition-all"
              >
                Salvar G4 e Artilheiro
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
