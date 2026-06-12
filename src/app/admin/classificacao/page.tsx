import { createAuthAdminClient } from '@/lib/supabase/server'
import { ClassificacaoAdminClient } from './ClassificacaoAdminClient'

const COL_DEFS = [
  { key: 'classif_col_premio',       label: 'Prêmio',        description: 'Primeira coluna (antes da colocação) — faixa de premiação', enabled: false },
  { key: 'classif_col_last_match',   label: 'Último jogo',   description: 'Palpite do participante no último jogo disputado', enabled: true },
  { key: 'classif_col_next_match',   label: 'Próximo jogo',  description: 'Palpite do participante no próximo jogo', enabled: true },
  { key: 'classif_col_delta_premio', label: '∆ Prêmio',      description: 'Diferença de pontos para o 1º colocado premiado (10ª posição por padrão)', enabled: true },
  { key: 'classif_col_delta_corte1', label: '∆ Corte 1',     description: 'Diferença de pontos para o 1º corte de eliminação (≈ posição 110)', enabled: true },
  { key: 'classif_col_delta_corte2', label: '∆ Corte 2',     description: 'Diferença de pontos para o 2º corte de eliminação (≈ posição 55)', enabled: true },
  { key: 'classif_col_pts_jg',       label: 'Pts Jg',        description: 'Pontos com Jogos', enabled: true },
  { key: 'classif_col_pts_cl',       label: 'Pts Cl',        description: 'Pontos com Classificação de Grupos + 3os Lugares', enabled: true },
  { key: 'classif_col_pts_g4',       label: 'Pts G4 + Art',  description: 'Pontos com G4 (1º ao 4º lugar) + Artilheiro', enabled: true },
]

export default async function ClassificacaoAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any

  const allKeys = [...COL_DEFS.map(c => c.key), 'sobe_desce_visible']
  const { data: settings } = await admin
    .from('tournament_settings')
    .select('key, value')
    .in('key', allKeys)

  const settingsMap: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (settings ?? []).map((r: any) => [r.key, r.value])
  )

  const cols = COL_DEFS.map(c => ({
    ...c,
    enabled: c.key in settingsMap ? settingsMap[c.key] === 'true' : c.enabled,
  }))

  // padrão: visível (true) se a chave ainda não foi gravada
  const sobeDesceVisible = settingsMap['sobe_desce_visible'] !== 'false'

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Colunas — Classificação</h2>
      <p className="mb-6 text-sm text-gray-500">
        Ative ou desative colunas da tabela de classificação para todos os usuários.
      </p>
      <ClassificacaoAdminClient cols={cols} sobeDesceVisible={sobeDesceVisible} />
    </>
  )
}
