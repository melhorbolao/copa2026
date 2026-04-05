'use client'

import { useState } from 'react'
import { updateScoringRule } from './actions'
import { Flag } from '@/components/ui/Flag'
import { useAdminView } from '@/contexts/AdminViewContext'

export interface ScoringRule {
  key: string
  label: string
  points: number
  category: string
  is_zebra_bonus: boolean
}

interface Props {
  rules: ScoringRule[]
  isAdmin: boolean
}

// Ordem canônica de exibição por categoria
const CATEGORY_ORDER: Record<string, string[]> = {
  jogos: [
    'placar_exato', 'empate_gols_errados', 'vencedor_gols_vencedor',
    'vencedor_diferenca_gols', 'vencedor_gols_perdedor', 'somente_vencedor',
    'bonus_zebra_jogo', 'multiplicador_brasil',
  ],
  grupos: [
    'grupo_ordem_certa', 'grupo_ordem_invertida', 'grupo_primeiro_certo',
    'grupo_segundo_certo', 'grupo_um_dos_dois',
    'terceiro_classificado',
    'bonus_zebra_grupo_1', 'bonus_zebra_grupo_2',
  ],
  g4_artilheiro: [
    'artilheiro', 'semifinalista', 'bonus_finalista',
    'bonus_vice', 'bonus_campeao', 'bonus_zebra_g4',
  ],
}

const SECTIONS = [
  { key: 'jogos',         title: 'Jogos',                    icon: '⚽' },
  { key: 'grupos',        title: 'Classificados por Grupo',  icon: '🏅' },
  { key: 'g4_artilheiro', title: 'G4 e Artilheiro',         icon: '🏆' },
]

function suffix(ruleKey: string) {
  if (ruleKey === 'multiplicador_brasil') return '×'
  if (ruleKey === 'percentual_zebra')     return '%'
  return 'pts'
}

function isBonusRow(rule: ScoringRule) {
  return rule.is_zebra_bonus ||
    ['bonus_finalista', 'bonus_vice', 'bonus_campeao'].includes(rule.key)
}

// ── Célula de pontos editável (admin) ou só leitura ───────────
function PointsCell({ rule, isAdmin }: { rule: ScoringRule; isAdmin: boolean }) {
  const [val,    setVal]    = useState(rule.points)
  const [saving, setSaving] = useState(false)
  const [saved,  setSaved]  = useState(false)

  const suf    = suffix(rule.key)
  const isZebra = rule.is_zebra_bonus
  const isMult  = rule.key === 'multiplicador_brasil'
  const isBonus = isBonusRow(rule)

  const badgeCls = isZebra
    ? 'bg-amber-400 text-amber-900'
    : isMult
      ? 'bg-verde-600 text-white'
      : isBonus
        ? 'bg-gray-700 text-white'
        : 'bg-azul-escuro text-white'

  const save = async () => {
    if (val === rule.points) return
    setSaving(true)
    try {
      await updateScoringRule(rule.key, val)
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-black ${badgeCls}`}>
        {suf === '×' ? `×${val}` : suf === '%' ? `${val}%` : isBonus ? `+${val} pts` : `${val} pts`}
      </span>
    )
  }

  // Admin: input inline
  return (
    <div className="flex items-center justify-end gap-1.5">
      {saving && <span className="text-xs text-gray-400">…</span>}
      {saved  && <span className="text-xs text-verde-600">✓</span>}
      {isBonus && suf === 'pts' && <span className="text-xs text-gray-400">+</span>}
      <input
        type="number"
        min={0}
        value={val}
        onChange={e => setVal(Number(e.target.value))}
        onBlur={save}
        onKeyDown={e => e.key === 'Enter' && (e.currentTarget.blur())}
        className={`w-12 rounded border py-0.5 text-center text-xs font-black focus:outline-none ${
          isZebra ? 'border-amber-300 bg-amber-50 focus:border-amber-500'
          : isMult ? 'border-verde-300 bg-verde-50 focus:border-verde-500'
          : 'border-gray-300 bg-white focus:border-azul-escuro'
        }`}
      />
      <span className="w-6 text-xs text-gray-500">{suf}</span>
    </div>
  )
}

// ── Componente principal ──────────────────────────────────────
export function ScoringTable({ rules, isAdmin }: Props) {
  const { viewMode } = useAdminView()
  const canEdit = isAdmin && viewMode === 'admin'
  const ruleMap = Object.fromEntries(rules.map(r => [r.key, r]))
  const zebraRule = ruleMap['percentual_zebra']

  return (
    <div className="space-y-5">
      {canEdit && (
        <div className="flex justify-end">
          <span className="rounded-full bg-amarelo-400 px-3 py-1 text-xs font-black text-verde-900">
            Modo admin — valores editáveis
          </span>
        </div>
      )}
      {SECTIONS.map(section => {
        const keys = CATEGORY_ORDER[section.key] ?? []
        const sectionRules = keys.map(k => ruleMap[k]).filter(Boolean)

        return (
          <section key={section.key} className="overflow-hidden rounded-2xl border border-gray-200 shadow-sm">
            <div className="flex items-center gap-2 px-4 py-3" style={{ backgroundColor: '#002776' }}>
              <span>{section.icon}</span>
              <h2 className="text-sm font-black uppercase tracking-widest text-white">
                {section.title}
              </h2>
            </div>
            <table className="w-full">
              <tbody>
                {sectionRules.map((rule, i) => {
                  const isZebra = rule.is_zebra_bonus
                  const isMult  = rule.key === 'multiplicador_brasil'
                  return (
                    <tr
                      key={rule.key}
                      className={`border-t border-gray-100 ${
                        isZebra ? 'bg-amber-50'
                        : isMult ? 'bg-verde-50/50'
                        : i % 2 === 0 ? 'bg-white' : 'bg-gray-50/40'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-sm text-gray-700">
                        {isZebra && <span className="mr-1.5">🦓</span>}
                        {isMult  && <Flag code="BR" size="sm" className="mr-1.5" />}
                        {rule.label}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <PointsCell rule={rule} isAdmin={canEdit} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </section>
        )
      })}

      {/* Legenda zebra */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4">
        <div className="flex items-start gap-2">
          <span className="text-lg">🦓</span>
          <div className="flex-1">
            <div className="flex items-center justify-between">
              <p className="text-sm font-black text-amber-900">Regra Zebra</p>
              {zebraRule && (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-amber-700">Limite:</span>
                  <PointsCell rule={zebraRule} isAdmin={canEdit} />
                </div>
              )}
            </div>
            <p className="mt-0.5 text-xs text-amber-800 leading-relaxed">
              Um resultado é zebra quando{' '}
              <strong>{zebraRule?.points ?? 15}% ou menos</strong>{' '}
              dos participantes apostaram naquele desfecho. Quem pontuar recebe o bônus automaticamente.
              Nos jogos do Brasil, o bônus zebra também é multiplicado (×{ruleMap['multiplicador_brasil']?.points ?? 2}).
            </p>
          </div>
        </div>
      </div>

      {canEdit && (
        <p className="text-center text-xs text-gray-400">
          Clique em qualquer valor para editar · Enter ou Tab para salvar
        </p>
      )}
    </div>
  )
}
