import { createAdminClient } from '@/lib/supabase/server'
import { ArtilheirosClient } from './ArtilheirosClient'

export const metadata = {}

export default async function ArtilheirosPage() {
  const admin = await createAdminClient()

  const [{ data: bets }, { data: mappings }] = await Promise.all([
    admin.from('tournament_bets').select('top_scorer'),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (admin as any).from('top_scorer_mapping').select('raw_name, standardized_name, is_eliminated'),
  ])

  const rawNames = [...new Set(
    (bets ?? []).map((b: { top_scorer: string }) => b.top_scorer).filter(Boolean)
  )].sort() as string[]

  const initialMappings: Record<string, string> = {}
  const initialEliminations: Record<string, boolean> = {}
  for (const m of (mappings ?? []) as { raw_name: string; standardized_name: string; is_eliminated: boolean }[]) {
    if (m.standardized_name) initialMappings[m.raw_name] = m.standardized_name
    if (m.is_eliminated)     initialEliminations[m.raw_name] = true
  }

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-xl font-black text-gray-900">Padronização de Artilheiros</h2>
        <p className="mt-1 text-sm text-gray-500">
          Mapeie os nomes digitados pelos participantes para um nome oficial único.
          Marque &quot;Eliminado&quot; para riscar automaticamente a aposta na Classificação MB.
        </p>
      </div>

      <ArtilheirosClient
        rawNames={rawNames}
        initialMappings={initialMappings}
        initialEliminations={initialEliminations}
      />

      <p className="mt-4 text-xs text-gray-400">
        {rawNames.length} nome{rawNames.length !== 1 ? 's' : ''} distintos encontrados ·{' '}
        {Object.keys(initialMappings).length} mapeado{Object.keys(initialMappings).length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
