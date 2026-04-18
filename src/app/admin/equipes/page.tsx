import { createAuthAdminClient } from '@/lib/supabase/server'
import { EquipesClient } from './EquipesClient'

export default async function AdminEquipesPage() {
  const admin = createAuthAdminClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from('teams')
    .select('name, abbr_br, abbr_fifa, group_name')
    .order('group_name', { ascending: true })
    .order('name', { ascending: true })

  if (error) console.error('[admin/equipes] SELECT error:', error)

  const teams = (data ?? []) as {
    name: string
    abbr_br: string
    abbr_fifa: string
    group_name: string
  }[]

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">
            {teams.length} equipes cadastradas · Clique em <strong>Editar</strong> para alterar siglas ou grupo.
          </p>
          {teams.length === 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Tabela vazia — execute <code className="bg-gray-100 px-1 rounded">supabase/create_teams.sql</code> no Supabase SQL Editor.
            </p>
          )}
        </div>
      </div>

      <EquipesClient teams={teams} />
    </div>
  )
}
