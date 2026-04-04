/**
 * Templates HTML para os e-mails automáticos do motor de cron.
 */

import type { Etapa, Participant } from './engine'

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://melhorbolao.app.br'
const FROM_NAME = 'Melhor Bolão'

const wrap = (body: string) => `
<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
  <div style="background:#004D1A;padding:18px 28px">
    <span style="color:#fff;font-size:18px;font-weight:900;letter-spacing:1px">MELHOR BOLÃO</span>
    <span style="color:rgba(255,255,255,0.65);font-size:11px;margin-left:10px">Copa do Mundo 2026</span>
  </div>
  <div style="padding:28px;background:#fff">${body}</div>
  <div style="padding:12px 28px;background:#f9fafb;text-align:center">
    <span style="font-size:11px;color:#9ca3af">Melhor Bolão · Copa do Mundo FIFA 2026 · EUA · Canadá · México</span>
  </div>
</div>`

const btn = (url: string, label: string, color = '#009c3b') =>
  `<a href="${url}" style="display:inline-block;background:${color};color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;margin-top:20px">${label}</a>`

const nome = (p: Participant) => p.apelido ?? p.name.split(' ')[0]
const faltam = (p: Participant) => p.matchCount - p.betCount

// ── T-24h: palpites completos ────────────────────────────────

export function html24hComplete(p: Participant, etapa: Etapa): string {
  return wrap(`
    <h2 style="margin:0 0 12px;color:#111827;font-size:19px">⚽ Tudo pronto, ${nome(p)}!</h2>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      Seus palpites para a <strong>${etapa.label}</strong> estão todos registrados
      (<strong>${p.betCount}/${p.matchCount}</strong> partidas preenchidas).
    </p>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      Você ainda pode editá-los até o prazo:
      <strong>${fmtDeadline(etapa.deadline)}</strong>.
      Após isso, os palpites serão travados definitivamente.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #009c3b;padding:12px 16px;border-radius:4px;margin:18px 0">
      <p style="margin:0;font-size:13px;color:#166534">
        O arquivo Excel com seus palpites segue em anexo para conferência.
      </p>
    </div>
    ${btn(`${BASE_URL}/palpites`, 'Ver meus palpites →')}
  `)
}

export function subject24hComplete(etapa: Etapa): string {
  return `⚽ Tudo pronto para a ${etapa.label}! (Confira os seus palpites)`
}

// ── T-24h: palpites incompletos ───────────────────────────────

export function html24hIncomplete(p: Participant, etapa: Etapa): string {
  return wrap(`
    <h2 style="margin:0 0 12px;color:#b91c1c;font-size:19px">⚠️ Atenção, ${nome(p)}!</h2>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      Faltam apenas <strong>24 horas</strong> para o encerramento da
      <strong>${etapa.label}</strong> e seus palpites ainda estão incompletos.
    </p>
    <div style="background:#fef2f2;border-left:4px solid #ef4444;padding:12px 16px;border-radius:4px;margin:18px 0">
      <p style="margin:0 0 6px;font-size:14px;color:#991b1b;font-weight:700">
        Situação: ${p.betCount} de ${p.matchCount} partidas preenchidas
        (faltam ${faltam(p)} palpites)
      </p>
      <p style="margin:0;font-size:13px;color:#991b1b">
        Prazo: <strong>${fmtDeadline(etapa.deadline)}</strong>
      </p>
    </div>
    <p style="margin:0 0 4px;color:#374151;font-size:15px;line-height:1.7">
      Partidas sem palpite valem <strong>zero pontos</strong> automaticamente.
      Complete agora para garantir sua participação na rodada!
    </p>
    ${btn(`${BASE_URL}/palpites`, '🖊️ Completar meus palpites →', '#b91c1c')}
  `)
}

export function subject24hIncomplete(_etapa: Etapa): string {
  return `⚠️ ALERTA: Os seus palpites estão incompletos!`
}

// ── T-6h: alerta crítico ─────────────────────────────────────

export function html6h(p: Participant, etapa: Etapa): string {
  return wrap(`
    <h2 style="margin:0 0 12px;color:#b91c1c;font-size:19px">🚨 ÚLTIMA CHAMADA, ${nome(p)}!</h2>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      O prazo da <strong>${etapa.label}</strong> encerra em
      <strong>menos de 6 horas</strong> (<strong>${fmtDeadline(etapa.deadline)}</strong>).
    </p>
    <div style="background:#fef2f2;border:2px solid #ef4444;padding:16px;border-radius:8px;margin:18px 0;text-align:center">
      <p style="margin:0 0 6px;font-size:20px;font-weight:900;color:#b91c1c">
        ${p.betCount} / ${p.matchCount} palpites
      </p>
      <p style="margin:0;font-size:13px;color:#991b1b">
        Faltam ${faltam(p)} palpite${faltam(p) > 1 ? 's' : ''} para você estar 100% preenchido
      </p>
    </div>
    <p style="margin:0;color:#374151;font-size:15px;line-height:1.7">
      <strong>⚠️ Atenção:</strong> após o fechamento do sistema, não é mais possível editar ou adicionar palpites.
      Partidas sem palpite resultam em <strong>zero pontos</strong> na rodada.
    </p>
    ${btn(`${BASE_URL}/palpites`, '🚨 Completar agora →', '#b91c1c')}
  `)
}

export const subject6h = `🚨 ÚLTIMA CHAMADA: O prazo encerra em 6 horas!`

// ── T-0h: recibo oficial ──────────────────────────────────────

export function html0h(p: Participant, etapa: Etapa): string {
  return wrap(`
    <h2 style="margin:0 0 12px;color:#111827;font-size:19px">✅ Recibo Oficial de Palpites</h2>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      Prezado(a) <strong>${nome(p)}</strong>,
    </p>
    <p style="margin:0 0 14px;color:#374151;font-size:15px;line-height:1.7">
      O prazo de apostas da <strong>${etapa.label}</strong> foi encerrado em
      <strong>${fmtDeadline(etapa.deadline)}</strong>.
    </p>
    <div style="background:#f0fdf4;border-left:4px solid #009c3b;padding:14px 18px;border-radius:4px;margin:18px 0">
      <p style="margin:0 0 6px;font-size:14px;color:#166534;font-weight:700">
        Palpites registrados: ${p.betCount} de ${p.matchCount} partidas
      </p>
      <p style="margin:0;font-size:13px;color:#166534">
        ${p.pct100
          ? 'Preenchimento: ✅ 100% completo'
          : `Preenchimento: ⚠️ incompleto (${faltam(p)} partida${faltam(p) > 1 ? 's' : ''} sem palpite)`
        }
      </p>
    </div>
    <p style="margin:0 0 14px;color:#374151;font-size:14px;line-height:1.7">
      O arquivo Excel em anexo é o <strong>comprovante oficial</strong> dos seus palpites
      para esta etapa. Guarde-o como registro. A partir deste momento, os palpites
      estão travados e <strong>não podem mais ser alterados</strong>.
    </p>
    <p style="margin:0;color:#9ca3af;font-size:12px">
      Este é um e-mail automático. Em caso de dúvidas, entre em contato com o administrador do bolão.
    </p>
  `)
}

export function subject0h(etapa: Etapa): string {
  return `✅ Recibo Oficial: Os seus palpites para a ${etapa.label}`
}

// ── Utilitário de data ────────────────────────────────────────

function fmtDeadline(d: Date): string {
  return d.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }) + ' (Brasília)'
}

export { FROM_NAME }
