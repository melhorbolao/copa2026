import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createAdminClient } from '@/lib/supabase/server'
import {
  findEtapaInWindow,
  getParticipants,
  wasAlreadySent,
  logEmail,
} from '@/lib/cron/engine'
import { html6h, subject6h, FROM_NAME } from '@/lib/cron/templates'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = `${FROM_NAME} <${process.env.EMAIL_FROM ?? 'noreply@melhorbolao.app.br'}>`

const WINDOW_6H_MS  = 6 * 3600 * 1000
const TOLERANCE_MS  = 35 * 60 * 1000   // ±35 min

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createAdminClient()

  const etapa = await findEtapaInWindow(supabase, WINDOW_6H_MS, TOLERANCE_MS)
  if (!etapa) {
    return NextResponse.json({ skipped: true, reason: 'Nenhuma etapa com prazo em ~6h' })
  }

  const participants = await getParticipants(supabase, etapa)

  // T-6h: APENAS usuários com preenchimento < 100%
  const incomplete = participants.filter(p => !p.pct100)
  const results = { sent: 0, skipped: 0, errors: 0 }

  for (const p of incomplete) {
    if (await wasAlreadySent(supabase, p.id, 'alert_6h', etapa.key)) {
      results.skipped++
      continue
    }

    try {
      const { data, error } = await resend.emails.send({
        from:    FROM,
        to:      [p.email],
        subject: subject6h,
        html:    html6h(p, etapa),
      })

      if (error) throw new Error(error.message)

      await logEmail(supabase, {
        userId:    p.id,
        email:     p.email,
        jobType:   'alert_6h',
        etapaKey:  etapa.key,
        messageId: data?.id ?? null,
        status:    'sent',
      })
      results.sent++
    } catch (err) {
      await logEmail(supabase, {
        userId:    p.id,
        email:     p.email,
        jobType:   'alert_6h',
        etapaKey:  etapa.key,
        messageId: null,
        status:    'error',
        errorMsg:  err instanceof Error ? err.message : String(err),
      })
      results.errors++
    }
  }

  return NextResponse.json({
    etapa:    etapa.key,
    deadline: etapa.deadline,
    total:    participants.length,
    targeted: incomplete.length,
    ...results,
  })
}
