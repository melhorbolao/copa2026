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
  const blank = searchParams.get('blank') === '1'

  const adminClient = createAuthAdminClient()

  // Accept participantId directly (preferred) or fall back to userId lookup
  let participantId = searchParams.get('participantId')

  if (!participantId) {
    const targetUserId = searchParams.get('userId')
    if (!targetUserId) return NextResponse.json({ error: 'participantId ou userId obrigatório' }, { status: 400 })

    // Primary participant for this user
    const { data: up } = await adminClient
      .from('user_participants')
      .select('participant_id')
      .eq('user_id', targetUserId)
      .eq('is_primary', true)
      .maybeSingle()

    // Fallback: any linked participant
    if (!up?.participant_id) {
      const { data: any } = await adminClient
        .from('user_participants')
        .select('participant_id')
        .eq('user_id', targetUserId)
        .limit(1)
        .maybeSingle()
      if (!any?.participant_id) {
        return NextResponse.json({ error: 'Participante não encontrado para este usuário.' }, { status: 404 })
      }
      participantId = any.participant_id
    } else {
      participantId = up.participant_id
    }
  }

  try {
    const { buffer, fileName } = await buildPalpitesBuffer(adminClient, participantId, { blank })

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${blank ? 'modelo-' : ''}${fileName}"`,
      },
    })
  } catch (err) {
    console.error('[admin/palpites/export]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
