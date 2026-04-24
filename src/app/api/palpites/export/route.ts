import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { buildPalpitesBuffer } from '../_workbook'

export async function GET() {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return new NextResponse('Não autorizado', { status: 401 })

    const participantId = await getActiveParticipantId(supabase, user.id)
    const { buffer, fileName } = await buildPalpitesBuffer(supabase, participantId)

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (err) {
    console.error('[export] error:', err)
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Erro ao gerar arquivo.' },
      { status: 500 },
    )
  }
}
