import { createAuthAdminClient } from '@/lib/supabase/server'
import { getVisibilitySettings, buildAvailableRounds } from '@/lib/production-mode'
import { getPhaseSettings, roundKeyToStage } from '@/lib/phase-availability'
import { GestaoAdminClient } from './GestaoAdminClient'

export interface CorteInfo {
  executadoEm: string | null
  classificados: number
}

export default async function GestaoAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const [{ productionMode, releasedRounds }, phaseSettings, { data: matchesRaw }, sobeDesceRow, { data: corteRows }] = await Promise.all([
    getVisibilitySettings(),
    getPhaseSettings(),
    admin.from('matches').select('phase, round, betting_deadline').order('match_datetime', { ascending: true }),
    admin.from('tournament_settings').select('value').eq('key', 'sobe_desce_visible').maybeSingle(),
    admin.from('tournament_settings').select('key, value').in('key', [
      'corte1_participantes', 'corte1_executado_em',
      'corte2_participantes', 'corte2_executado_em',
    ]),
  ])
  // padrão: visível (true) se a chave ainda não existir
  const sobeDesceVisible = sobeDesceRow?.data?.value !== 'false'

  const availableRounds = buildAvailableRounds(matchesRaw ?? [])

  // Mapeia availableStages (StageKey) -> roundKeys do production-mode para
  // permitir que o GestaoAdminClient acompanhe o mesmo conjunto de toggles.
  const fillableRoundKeys = availableRounds
    .filter(r => {
      // 'bonus' não tem StageKey — verifica diretamente nos raw keys persistidos
      if (r.key === 'bonus') return phaseSettings.availableRawKeys.has('bonus')
      const stage = roundKeyToStage(r.key)
      return stage ? phaseSettings.availableStages.has(stage) : false
    })
    .map(r => r.key)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const corteMap: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (corteRows ?? []).map((r: any) => [r.key as string, r.value as string]),
  )
  const parseCount = (key: string) => {
    try { return (JSON.parse(corteMap[key] ?? '[]') as string[]).length } catch { return 0 }
  }
  const corte1: CorteInfo = {
    executadoEm: corteMap['corte1_executado_em'] ?? null,
    classificados: parseCount('corte1_participantes'),
  }
  const corte2: CorteInfo = {
    executadoEm: corteMap['corte2_executado_em'] ?? null,
    classificados: parseCount('corte2_participantes'),
  }

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Gestão</h2>
      <p className="mb-6 text-sm text-gray-500">
        Controle de visibilidade, exportação, importação e limpeza de dados do bolão.
      </p>
      <GestaoAdminClient
        productionMode={productionMode}
        releasedRounds={[...releasedRounds]}
        fillableRoundKeys={fillableRoundKeys}
        availableRounds={availableRounds}
        sobeDesceVisible={sobeDesceVisible}
        corte1={corte1}
        corte2={corte2}
      />
    </>
  )
}
