import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { buildPalpitesBuffer } from '@/app/api/palpites/_workbook'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const targetUserId = searchParams.get('userId')
  const blank = searchParams.get('blank') === '1'

  if (!targetUserId) return NextResponse.json({ error: 'userId obrigatório' }, { status: 400 })

  const adminClient = createAuthAdminClient()

  // Resolve o participante primário do usuário alvo
  const { data: up } = await adminClient
    .from('user_participants')
    .select('participant_id')
    .eq('user_id', targetUserId)
    .eq('is_primary', true)
    .maybeSingle()
  if (!up?.participant_id) return NextResponse.json({ error: 'Participante não encontrado para este usuário.' }, { status: 404 })

  const { buffer, fileName } = await buildPalpitesBuffer(adminClient, up.participant_id, { blank })

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${blank ? 'modelo-' : ''}${fileName}"`,
    },
  })
}
