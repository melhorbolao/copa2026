import { createAuthAdminClient } from '@/lib/supabase/server'
import { UsuariosClient } from './UsuariosClient'

export default async function AdminUsuariosPage() {
  const supabase = createAuthAdminClient()

  const { data: users } = await supabase.from('users')
    .select(`
      id, name, email, whatsapp, padrinho, apelido, observacao,
      provider, approved, paid, status, is_manual, is_admin, role, created_at,
      user_participants(participant_id, is_primary, participants(id, apelido))
    `)
    .order('created_at', { ascending: false })

  const total       = users?.length ?? 0
  const aprovados   = users?.filter(u => u.status === 'aprovado').length ?? 0
  const pendentes   = users?.filter(u => u.status === 'aprovacao_pendente').length ?? 0
  const incompletos = users?.filter(u => !u.is_manual && (!u.whatsapp || !u.padrinho)).length ?? 0

  return (
    <div>
      {/* Resumo */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Cadastrados"        value={total}       color="gray"   />
        <StatCard label="Aprovados"          value={aprovados}   color="verde"  />
        <StatCard label="Aguard. aprovação"  value={pendentes}   color="orange" />
        <StatCard label="Perfil incompleto"  value={incompletos} color="red"    />
      </div>

      <UsuariosClient users={users ?? []} />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const styles: Record<string, string> = {
    gray:    'bg-gray-50   border-gray-200   text-gray-700',
    verde:   'bg-verde-50  border-verde-200  text-verde-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    amarelo: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    red:     'bg-red-50    border-red-200    text-red-700',
  }
  return (
    <div className={`rounded-xl border p-4 text-center ${styles[color] ?? styles.gray}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
    </div>
  )
}
