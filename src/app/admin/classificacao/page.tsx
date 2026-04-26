import { createAuthAdminClient } from '@/lib/supabase/server'
import { ClassificacaoAdminClient } from './ClassificacaoAdminClient'

const COL_DEFS = [
  { key: 'classif_col_premio',       label: 'Prêmio',        description: 'Primeira coluna (antes da colocação) — faixa de premiação', enabled: false },
  { key: 'classif_col_last_match',   label: 'Último jogo',   description: 'Palpite do participante no último jogo disputado', enabled: true },
  { key: 'classif_col_next_match',   label: 'Próximo jogo',  description: 'Palpite do participante no próximo jogo', enabled: true },
  { key: 'classif_col_delta_premio', label: '∆ Prêmio',      description: 'Diferença de pontos para o 1º colocado premiado (10ª posição por padrão)', enabled: true },
  { key: 'classif_col_delta_corte',  label: '∆ Corte',       description: 'Diferença de pontos para o último colocado na zona de prêmio', enabled: true },
  { key: 'classif_col_pts_jg',       label: 'Pts Jg',        description: 'Pontos com Jogos', enabled: true },
  { key: 'classif_col_pts_cl',       label: 'Pts Cl',        description: 'Pontos com Classificação de Grupos + 3os Lugares', enabled: true },
  { key: 'classif_col_pts_g4',       label: 'Pts G4 + Art',  description: 'Pontos com G4 (1º ao 4º lugar) + Artilheiro', enabled: true },
]

export default async function ClassificacaoAdminPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { data: settings } = await admin
    .from('tournament_settings')
    .select('key, value')
    .in('key', COL_DEFS.map(c => c.key))

  const settingsMap: Record<string, string> = Object.fromEntries(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (settings ?? []).map((r: any) => [r.key, r.value])
  )

  const cols = COL_DEFS.map(c => ({
    ...c,
    enabled: c.key in settingsMap ? settingsMap[c.key] === 'true' : c.enabled,
  }))

  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Colunas — Classificação MB</h2>
      <p className="mb-6 text-sm text-gray-500">
        Ative ou desative colunas da tabela de classificação para todos os usuários.
      </p>
      <ClassificacaoAdminClient cols={cols} />
    </>
  )
}
