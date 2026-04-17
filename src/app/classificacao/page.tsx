export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveParticipantId } from '@/lib/participant'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { RankingTable } from './RankingTable'

export const metadata = { title: 'Classificação' }

export default async function ClassificacaoPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('classificacao', isAdmin)

  const activeParticipantId = await getActiveParticipantId(supabase, user.id).catch(() => null)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: rows } = await (supabase as any)
    .from('participant_scores')
    .select('participant_id, pts_matches, pts_groups, pts_thirds, pts_tournament, pts_total, participants(apelido)')
    .order('pts_total', { ascending: false })

  type RawRow = {
    participant_id: string
    pts_matches: number
    pts_groups: number
    pts_thirds: number
    pts_tournament: number
    pts_total: number
    participants: { apelido: string } | null
  }

  const entries = ((rows ?? []) as RawRow[]).map((r, i, arr) => ({
    participant_id: r.participant_id,
    apelido: r.participants?.apelido ?? '—',
    pts_total: r.pts_total ?? 0,
    pts_matches: r.pts_matches ?? 0,
    pts_groups: r.pts_groups ?? 0,
    pts_thirds: r.pts_thirds ?? 0,
    pts_tournament: r.pts_tournament ?? 0,
    position: i + 1,
    tied: i > 0 && (arr[i - 1].pts_total ?? 0) === (r.pts_total ?? 0),
  }))

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-black text-gray-900">Classificação</h1>
          <p className="mt-0.5 text-sm text-gray-500">
            {entries.length} participante{entries.length !== 1 ? 's' : ''} · pontuação acumulada
          </p>
        </div>

        <RankingTable entries={entries} activeParticipantId={activeParticipantId ?? ''} />
      </div>
    </>
  )
}
