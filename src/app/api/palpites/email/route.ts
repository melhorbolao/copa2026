import { NextResponse } from 'next/server'
import { Resend } from 'resend'
import { createClient } from '@/lib/supabase/server'
import { buildPalpitesBuffer } from '../_workbook'

const resend = new Resend(process.env.RESEND_API_KEY)
const FROM   = process.env.EMAIL_FROM ?? 'Melhor Bolão <noreply@melhorbolao.app.br>'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const email = user.email
  if (!email) return NextResponse.json({ error: 'Usuário sem e-mail cadastrado.' }, { status: 400 })

  const { buffer, displayName } = await buildPalpitesBuffer(supabase, user.id)

  const now = new Date()
  const dataHora = now.toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #111827;">
      <div style="background: #004D1A; padding: 24px 32px; border-radius: 8px 8px 0 0;">
        <h1 style="color: #ffffff; margin: 0; font-size: 20px;">⚽ Melhor Bolão · Copa 2026</h1>
      </div>
      <div style="background: #f9fafb; padding: 28px 32px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px;">
        <p style="margin: 0 0 12px;">Olá, <strong>${displayName}</strong>!</p>
        <p style="margin: 0 0 12px;">Segue em anexo o comprovante atualizado dos seus palpites para o Bolão da Copa 2026.</p>
        <p style="margin: 0 0 20px;">O arquivo <strong>palpites-copa2026.xlsx</strong> contém todos os seus palpites de jogos, classificados de grupos e apostas bônus registrados até agora.</p>
        <div style="background: #fff; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px;">
          <p style="margin: 0; font-size: 13px; color: #6b7280;">📅 Gerado em: <strong>${dataHora} (horário de Brasília)</strong></p>
        </div>
        <p style="margin: 0; font-size: 13px; color: #6b7280;">
          Você pode usar este arquivo para conferir seus palpites ou reimportá-los pelo sistema.<br/>
          Dúvidas? Entre em contato com o administrador do bolão.
        </p>
      </div>
    </div>
  `

  const { error } = await resend.emails.send({
    from: FROM,
    to:   [email],
    subject: '⚽ Seu Comprovante de Palpites - Bolão Copa 2026',
    html,
    attachments: [{
      filename:     'palpites-copa2026.xlsx',
      content:      buffer,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }],
  })

  if (error) {
    console.error('[email] Resend error:', error)
    return NextResponse.json({ error: 'Falha ao enviar e-mail. Tente novamente.' }, { status: 500 })
  }

  return NextResponse.json({ email })
}
