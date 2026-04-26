import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getVisibilitySettings } from '@/lib/production-mode'
import { buildTabelaMBBuffer } from './_builder'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  if (!profile?.is_admin) return NextResponse.json({ error: 'Acesso negado' }, { status: 403 })

  try {
    const settings = await getVisibilitySettings()
    const { buffer, fileName } = await buildTabelaMBBuffer(settings)

    return new NextResponse(buffer as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${fileName}"`,
      },
    })
  } catch (err) {
    console.error('[admin/dados/export]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
