'use client'

import { useRef, useState } from 'react'
import type { DeltaBreakdown, ProjectionData } from './engine'

interface Props {
  nameA: string
  nameB: string
  totalA: number
  totalB: number
  breakdown: DeltaBreakdown
  projection: ProjectionData
  onClose: () => void
}

export function DuelCard({ nameA, nameB, totalA, totalB, breakdown, projection, onClose }: Props) {
  const cardRef = useRef<HTMLDivElement>(null)
  const [downloading, setDownloading] = useState(false)

  const delta      = totalA - totalB
  const leader     = delta > 0 ? nameA : delta < 0 ? nameB : null
  const shortA     = nameA.split(' ')[0]
  const shortB     = nameB.split(' ')[0]
  const shortLeader = leader?.split(' ')[0] ?? null

  const handleDownload = async () => {
    if (!cardRef.current) return
    setDownloading(true)
    try {
      const { toPng } = await import('html-to-image')
      const dataUrl = await toPng(cardRef.current, { cacheBust: true, pixelRatio: 2 })
      const a = document.createElement('a')
      a.download = `duelo-mb-${shortA.toLowerCase()}-vs-${shortB.toLowerCase()}.png`
      a.href = dataUrl
      a.click()
    } catch (err) {
      console.error('Erro ao gerar imagem:', err)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>

        {/* Card for export */}
        <div
          ref={cardRef}
          style={{ width: 400, fontFamily: 'system-ui, sans-serif', background: 'white' }}
          className="overflow-hidden rounded-2xl shadow-2xl"
        >
          {/* Header */}
          <div style={{ background: 'linear-gradient(135deg, #004d1a 0%, #006622 100%)', padding: '16px 20px 12px' }}>
            <div style={{ color: '#fbbf24', fontSize: 11, fontWeight: 800, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 4 }}>
              ⚔️ Duelo MB · Copa 2026
            </div>
            <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 10 }}>melhorbolao.com.br</div>
          </div>

          {/* Scoreboard */}
          <div style={{ padding: '16px 20px', background: '#f9fafb' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
              {/* Participant A */}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: '#1e3a5f', color: 'white',
                  fontSize: 18, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 6px',
                }}>
                  {shortA[0]?.toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{shortA}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#1e3a5f', lineHeight: 1.1, marginTop: 4 }}>{totalA}</div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>pts</div>
              </div>

              {/* VS + delta */}
              <div style={{ textAlign: 'center', padding: '0 8px' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#9ca3af', letterSpacing: 2 }}>VS</div>
                {delta !== 0 && (
                  <div style={{
                    marginTop: 6,
                    padding: '3px 10px',
                    borderRadius: 20,
                    background: delta > 0 ? '#dbeafe' : '#fee2e2',
                    color: delta > 0 ? '#1e3a5f' : '#dc2626',
                    fontSize: 13, fontWeight: 900,
                  }}>
                    {delta > 0 ? `+${delta}` : delta}
                  </div>
                )}
                {delta === 0 && (
                  <div style={{ marginTop: 6, fontSize: 11, color: '#9ca3af' }}>Empate!</div>
                )}
              </div>

              {/* Participant B */}
              <div style={{ flex: 1, textAlign: 'center' }}>
                <div style={{
                  width: 48, height: 48, borderRadius: '50%',
                  background: '#dc2626', color: 'white',
                  fontSize: 18, fontWeight: 900,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 6px',
                }}>
                  {shortB[0]?.toUpperCase()}
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>{shortB}</div>
                <div style={{ fontSize: 28, fontWeight: 900, color: '#dc2626', lineHeight: 1.1, marginTop: 4 }}>{totalB}</div>
                <div style={{ fontSize: 10, color: '#6b7280' }}>pts</div>
              </div>
            </div>
          </div>

          {/* Stats grid */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 1, background: '#e5e7eb', borderTop: '1px solid #e5e7eb' }}>
            {[
              { icon: '🎯', label: 'Cravadas', valA: breakdown.exactCountA, valB: breakdown.exactCountB },
              { icon: '⚡', label: 'Zebras acertadas', valA: breakdown.zebraHitsA, valB: breakdown.zebraHitsB },
              { icon: '⚔️', label: 'Batalhas futuras', valA: projection.battlefields.length, valB: projection.battlefields.length, equal: true },
            ].map(stat => {
              const aWins = !stat.equal && stat.valA > stat.valB
              const bWins = !stat.equal && stat.valB > stat.valA
              return (
                <div key={stat.label} style={{ background: 'white', padding: '10px 8px', textAlign: 'center' }}>
                  <div style={{ fontSize: 14, marginBottom: 2 }}>{stat.icon}</div>
                  <div style={{ fontSize: 9, color: '#9ca3af', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    {stat.label}
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 16, fontWeight: 900, color: aWins ? '#1e3a5f' : '#6b7280' }}>{stat.valA}</span>
                    {!stat.equal && <span style={{ fontSize: 9, color: '#d1d5db' }}>×</span>}
                    <span style={{ fontSize: 16, fontWeight: 900, color: bWins ? '#dc2626' : '#6b7280' }}>{stat.equal ? '' : stat.valB}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Verdict */}
          <div style={{ padding: '12px 20px 16px', textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
            {shortLeader ? (
              <>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>
                  🏆 {shortLeader.toUpperCase()} ESTÁ NA FRENTE!
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 3 }}>
                  {breakdown.exactCountA > breakdown.exactCountB
                    ? `${shortA} tem ${breakdown.exactCountA - breakdown.exactCountB} cravada${breakdown.exactCountA - breakdown.exactCountB > 1 ? 's' : ''} a mais!`
                    : breakdown.exactCountB > breakdown.exactCountA
                    ? `${shortB} tem ${breakdown.exactCountB - breakdown.exactCountA} cravada${breakdown.exactCountB - breakdown.exactCountA > 1 ? 's' : ''} a mais!`
                    : `Empatados nas cravadas — a definir nos ${projection.battlefields.length} campos de batalha!`
                  }
                </div>
              </>
            ) : (
              <div style={{ fontSize: 12, fontWeight: 800, color: '#374151' }}>
                🤝 EMPATE TÉCNICO! Tudo em aberto...
              </div>
            )}
          </div>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={handleDownload}
            disabled={downloading}
            className="rounded-xl bg-verde-600 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-verde-700 disabled:opacity-50"
          >
            {downloading ? 'Gerando...' : '📥 Baixar Cartão'}
          </button>
          <button
            onClick={onClose}
            className="rounded-xl border border-gray-300 bg-white px-5 py-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-50"
          >
            Fechar
          </button>
        </div>
        <p className="text-xs text-white/60">Salve e compartilhe no WhatsApp 📲</p>
      </div>
    </div>
  )
}
