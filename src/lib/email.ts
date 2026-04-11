import { Resend } from 'resend'

const resend   = new Resend(process.env.RESEND_API_KEY)
const FROM     = process.env.EMAIL_FROM    ?? 'admin@melhorbolao.app.br'
const ADMIN_TO = process.env.ADMIN_EMAIL   ?? 'gmousinho@gmail.com'
const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL ?? 'https://melhorbolao.app.br'

// ── Cabeçalho HTML compartilhado ─────────────────────────────
const htmlHeader = `
  <div style="background:#009c3b;padding:16px 24px;border-radius:12px 12px 0 0">
    <span style="color:#fff;font-family:sans-serif;font-size:18px;font-weight:900;letter-spacing:1px">
      MELHOR BOLÃO
    </span>
    <span style="color:rgba(255,255,255,0.7);font-family:sans-serif;font-size:11px;margin-left:10px">
      Copa do Mundo 2026
    </span>
  </div>
`

const htmlWrapper = (content: string) => `
  <div style="font-family:sans-serif;max-width:520px;margin:auto;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
    ${htmlHeader}
    <div style="padding:24px;background:#fff">
      ${content}
    </div>
    <div style="padding:12px 24px;background:#f9fafb;text-align:center">
      <span style="font-size:11px;color:#9ca3af">
        Melhor Bolão · Copa do Mundo FIFA 2026 · EUA · Canadá · México
      </span>
    </div>
  </div>
`

// ── 1. Notificação para admin: novo usuário cadastrado ────────
export async function notifyAdminNewUser({ name, email }: { name: string; email: string }) {
  await resend.emails.send({
    from: `Melhor Bolão <${FROM}>`,
    to:   ADMIN_TO,
    subject: `[Bolão] Novo cadastro: ${name}`,
    html: htmlWrapper(`
      <h2 style="margin:0 0 16px;color:#111827;font-size:18px">Novo usuário aguardando aprovação</h2>
      <table style="border-collapse:collapse;width:100%;margin-bottom:20px">
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;font-size:14px;width:80px"><strong>Nome</strong></td>
          <td style="padding:8px 0;font-size:14px;color:#111827">${name}</td>
        </tr>
        <tr>
          <td style="padding:8px 12px 8px 0;color:#6b7280;font-size:14px"><strong>E-mail</strong></td>
          <td style="padding:8px 0;font-size:14px;color:#111827">${email}</td>
        </tr>
      </table>
      <a href="${BASE_URL}/admin/usuarios"
         style="display:inline-block;background:#009c3b;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
        Abrir painel de aprovação →
      </a>
    `),
  })
}

// ── 2. Boas-vindas ao usuário aprovado ────────────────────────
export async function notifyUserApproved({ name, email }: { name: string; email: string }) {
  await resend.emails.send({
    from: `Melhor Bolão <${FROM}>`,
    to:   email,
    subject: '🏆 Bem-vindo ao Melhor Bolão Copa 2026!',
    html: htmlWrapper(`
      <h2 style="margin:0 0 8px;color:#111827;font-size:20px">Olá, ${name}! 🎉</h2>
      <p style="margin:0 0 16px;color:#374151;font-size:15px;line-height:1.6">
        Sua participação no <strong>Melhor Bolão Copa do Mundo 2026</strong> foi aprovada.
        Você já pode começar a fazer seus palpites no link abaixo.
      </p>
      <div style="background:#f0fdf4;border-left:4px solid #009c3b;padding:12px 16px;border-radius:4px;margin-bottom:20px">
        <p style="margin:0 0 4px;font-size:13px;color:#166534;font-weight:700">⚠️ Atenção ao prazo</p>
        <p style="margin:0;font-size:13px;color:#166534">
          Rodada 1: <strong>10/06 às 23h59</strong> (horário de Brasília)
        </p>
      </div>
      <a href="${BASE_URL}/palpites"
         style="display:inline-block;background:#009c3b;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px">
        Fazer meus palpites →
      </a>
      <p style="margin:20px 0 0;font-size:12px;color:#9ca3af">
        Dúvidas? Fale com o admin pelo WhatsApp ou responda este e-mail.
      </p>
    `),
  })
}

// ── 3. E-mail em massa (com anexo opcional) ───────────────────
export async function sendReminderEmail({
  name,
  email,
  body,
  attachments,
}: {
  name: string
  email: string
  body: string
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
}) {
  const personalizedBody = body.replace(/\{nome\}/gi, name)
  await resend.emails.send({
    from: `Melhor Bolão <${FROM}>`,
    to:   email,
    subject: '⏰ Lembrete: seus palpites estão pendentes!',
    html: htmlWrapper(`
      <p style="margin:0;font-size:15px;color:#374151;white-space:pre-line;line-height:1.7">
        ${personalizedBody.replace(/\n/g, '<br/>')}
      </p>
      <div style="margin-top:20px">
        <a href="${BASE_URL}/palpites"
           style="display:inline-block;background:#009c3b;color:#fff;padding:10px 22px;border-radius:8px;text-decoration:none;font-weight:700;font-size:14px">
          Acessar palpites →
        </a>
      </div>
    `),
    attachments,
  })
}
