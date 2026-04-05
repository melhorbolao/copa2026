export const dynamic = 'force-dynamic'
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
import { html0h, subject0h, FROM_NAME } from '@/lib/cron/templates'

// T-0h: deadline acabou de passar (dentro dos últimos 5 min)
// Tolerância negativa = deadline no passado
const TOLERANCE_MS = 5 * 60 * 1000

export async function GET(req: Request) {
  const resend = new Resend(process.env.RESEND_API_KEY)
  const FROM = `${FROM_NAME} <${process.env.EMAIL_FROM ?? 'noreply@melhorbolao.app.br'}>`
  const AUDIT_CC = process.env.AUDIT_EMAIL ?? 'auditoria@melhorbolao.app.br'
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  // targetOffset = 0 mas queremos deadlines no passado recente
  // Window: deadline entre (now - 5min) e (now + 1min) — pequena tolerância positiva
  const etapa = await findEtapaInWindow(supabase, 0, TOLERANCE_MS)
  if (!etapa) {
    return NextResponse.json({ skipped: true, reason: 'Nenhuma etapa com prazo nos últimos 5 min' })
  }

  // Confirma que o prazo realmente passou (não é futuro)
  if (etapa.deadline > new Date()) {
    return NextResponse.json({ skipped: true, reason: 'Prazo ainda não encerrou' })
  }

  const participants = await getParticipants(supabase, etapa)
  const results = { sent: 0, skipped: 0, errors: 0 }

  for (const p of participants) {
    if (await wasAlreadySent(supabase, p.id, 'receipt', etapa.key)) {
      results.skipped++
      continue
    }

    try {
      const { buffer } = await buildPalpitesBuffer(supabase, p.id)

      const { data, error } = await resend.emails.send({
        from: FROM,
        to: [p.email],
        cc: [AUDIT_CC],
        subject: subject0h(etapa),
        html: html0h(p, etapa),
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
        jobType: 'receipt',
        etapaKey: etapa.key,
        messageId: data?.id ?? null,
        status: 'sent',
      })
      results.sent++
    } catch (err) {
      await logEmail(supabase, {
        userId: p.id,
        email: p.email,
        jobType: 'receipt',
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
