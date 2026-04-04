import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { buildPalpitesBuffer } from '../_workbook'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return new NextResponse('Não autorizado', { status: 401 })

  const { buffer } = await buildPalpitesBuffer(supabase, user.id)

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="palpites-copa2026.xlsx"',
    },
  })
}
