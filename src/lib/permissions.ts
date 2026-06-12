export type UserRole = 'user' | 'admin' | 'master'

// Grupos de permissão que o Master pode conceder/revogar para Admins
export const PERMISSION_GROUPS = [
  {
    key: 'configuracoes',
    label: 'Configurações Globais e Prazos',
    description: 'Usuários, Prazos, E-mails, Avisos, Equipes, Páginas, Classificação',
    pages: ['usuarios', 'prazos', 'emails', 'avisos', 'equipes', 'paginas', 'classificacao'],
  },
  {
    key: 'telemetria',
    label: 'Monitoramento de Acessos (Telemetria)',
    description: 'Visualização e análise de acessos e engajamento',
    pages: ['telemetria'],
  },
  {
    key: 'artilharia',
    label: 'Ativação de Pontos de Artilharia',
    description: 'Artilheiros e Gestão de configurações do torneio',
    pages: ['artilheiros', 'gestao'],
  },
  {
    key: 'auditoria',
    label: 'Auditoria e Exportação de Palpites',
    description: 'Participantes — visualização e exportação de palpites',
    pages: ['participantes'],
  },
  {
    key: 'tribos',
    label: 'Gestão de Tribos',
    description: 'Criação e gerenciamento de grupos de participantes para destaque na classificação',
    pages: ['tribos'],
  },
] as const

export type PermissionGroupKey = (typeof PERMISSION_GROUPS)[number]['key']

// Mapeamento de chave de página → grupo de permissão exigido
const PAGE_TO_GROUP: Record<string, PermissionGroupKey> = {
  usuarios:      'configuracoes',
  participantes: 'auditoria',
  prazos:        'configuracoes',
  emails:        'configuracoes',
  avisos:        'configuracoes',
  artilheiros:   'artilharia',
  equipes:       'configuracoes',
  paginas:       'configuracoes',
  classificacao: 'configuracoes',
  gestao:        'artilharia',
  telemetria:    'telemetria',
  tribos:        'tribos',
}

/**
 * Retorna true se o usuário tem permissão para acessar a página indicada.
 * allowedGroups contém as chaves de grupos liberados (ex: ['configuracoes', 'telemetria']).
 */
export function canAccessPage(role: UserRole, allowedGroups: string[], pageKey: string): boolean {
  if (role === 'master') return true
  if (role !== 'admin') return false
  const requiredGroup = PAGE_TO_GROUP[pageKey]
  if (!requiredGroup) return false
  return allowedGroups.includes(requiredGroup)
}
