import { createAuthAdminClient } from '@/lib/supabase/server'
import { ParticipantRow } from './ParticipantRow'
import { CreateParticipantModal } from './CreateParticipantModal'

export default async function AdminParticipantesPage() {
  const supabase = createAuthAdminClient()

  const [{ data: rawParticipants }, { data: approvedUsers }] = await Promise.all([
    supabase
      .from('participants')
      .select('id, apelido, bio, paid, created_at, user_participants(user_id, is_primary, users(id, name, email))')
      .order('apelido'),
    supabase
      .from('users')
      .select('id, name, apelido')
      .eq('status', 'aprovado')
      .order('name'),
  ])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const participants = (rawParticipants ?? []) as any[]
  const users        = (approvedUsers ?? []) as { id: string; name: string; apelido: string | null }[]

  const total = participants.length
  const pagos = participants.filter(p => p.paid).length

  return (
    <div>
      {/* Resumo */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Participantes" value={total}         color="gray"   />
        <StatCard label="Pagos"         value={pagos}         color="verde"  />
        <StatCard label="Pendentes"     value={total - pagos} color="orange" />
      </div>

      <div className="mb-4 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-gray-500">
          Gerencie os participantes do bolão · ★ = usuário primário
        </p>
        <CreateParticipantModal users={users} />
      </div>

      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {total === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Nenhum participante cadastrado.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Nome no Bolão</th>
                  <th className="px-3 py-3">Bio</th>
                  <th className="px-3 py-3">Pagamento</th>
                  <th className="px-3 py-3">Usuários com acesso</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {participants.map((p, i) => (
                  <ParticipantRow key={p.id} participant={p} index={i} allUsers={users} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {pagos}/{total} pagos
      </p>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const styles: Record<string, string> = {
    gray:   'bg-gray-50   border-gray-200   text-gray-700',
    verde:  'bg-verde-50  border-verde-200  text-verde-700',
    orange: 'bg-orange-50 border-orange-200 text-orange-700',
  }
  return (
    <div className={`rounded-xl border p-4 text-center ${styles[color] ?? styles.gray}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
    </div>
  )
}
