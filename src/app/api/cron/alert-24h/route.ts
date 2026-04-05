export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import { buildPalpitesBuffer } from '../../palpites/_workbook'
import {
  findEtapaInWindow,
  getParticipants,
  wasAlreadySent,
  logEmail,
} from '@/lib/cron/engine'
import {
  html24hComplete, subject24hComplete,
  html24hIncomplete, subject24hIncomplete,
  FROM_NAME,
} from '@/lib/cron/templates'

const WINDOW_24H_MS = 24 * 3600 * 1000
const TOLERANCE_MS = 35 * 60 * 1000  // ±35 min (cron roda a cada hora)

export async function GET(req: Request) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const FROM = `${FROM_NAME} <${process.env.EMAIL_FROM ?? 'noreply@melhorbolao.app.br'}>`
  // Protege com CRON_SECRET (Vercel injeta automaticamente em prod)
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  const etapa = await findEtapaInWindow(supabase, WINDOW_24H_MS, TOLERANCE_MS)
  if (!etapa) {
    return NextResponse.json({ skipped: true, reason: 'Nenhuma etapa com prazo em ~24h' })
  }

  const participants = await getParticipants(supabase, etapa)
  const results = { sent: 0, skipped: 0, errors: 0 }

  for (const p of participants) {
    // Deduplicação
    if (await wasAlreadySent(supabase, p.id, 'alert_24h', etapa.key)) {
      results.skipped++
      continue
    }

    const subject = p.pct100
      ? subject24hComplete(etapa)
      : subject24hIncomplete(etapa)
    const html = p.pct100
      ? html24hComplete(p, etapa)
      : html24hIncomplete(p, etapa)

    try {
      // Gera Excel individual
      const { buffer } = await buildPalpitesBuffer(supabase, p.id)

      const { data, error } = await resend.emails.send({
        from: FROM,
        to: [p.email],
        subject,
        html,
        attachments: [{
          filename: 'Meus_Palpites.xlsx',
          content: buffer,
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }],
      })

      if (error) throw new Error(error.message)

      await logEmail(supabase, {
        userId: p.id,
        email: p.email,
        jobType: 'alert_24h',
        etapaKey: etapa.key,
        messageId: data?.id ?? null,
        status: 'sent',
      })
      results.sent++
    } catch (err) {
      await logEmail(supabase, {
        userId: p.id,
        email: p.email,
        jobType: 'alert_24h',
        etapaKey: etapa.key,
        messageId: null,
        status: 'error',
        errorMsg: err instanceof Error ? err.message : String(err),
      })
      results.errors++
    }
  }

  return NextResponse.json({ etapa: etapa.key, deadline: etapa.deadline, ...results })
}
