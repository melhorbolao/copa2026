import { createClient } from '@/lib/supabase/server'
import { UserRow } from './UserRow'
import { ReminderSection } from './ReminderSection'
import { CopyEmailsButton } from './CopyEmailsButton'

export default async function AdminUsuariosPage() {
  const supabase = await createClient()

  const { data: users } = await supabase.from('users')
    .select(`
      id, name, email, whatsapp, padrinho, apelido, observacao,
      provider, approved, paid, status, is_manual, is_admin, created_at,
      user_participants(participant_id, is_primary, participants(id, apelido))
    `)
    .order('created_at', { ascending: false })

  const total     = users?.length ?? 0
  const aprovados = users?.filter(u => u.status === 'aprovado').length ?? 0
  const pendentes = users?.filter(u => u.status === 'aprovacao_pendente').length ?? 0
  const pagos     = users?.filter(u => u.paid).length ?? 0

  const approvedEmails = (users ?? [])
    .filter(u => u.status === 'aprovado')
    .map(u => u.email)

  return (
    <div>
      {/* Resumo */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Cadastrados"       value={total}     color="gray"    />
        <StatCard label="Aprovados"         value={aprovados} color="verde"   />
        <StatCard label="Aguard. aprovação" value={pendentes} color="orange"  />
        <StatCard label="Pagos"             value={pagos}     color="amarelo" />
      </div>

      {/* Lembrete + Copiar e-mails */}
      <div className="mb-4 flex items-start justify-between gap-3 flex-wrap">
        <ReminderSection />
        <CopyEmailsButton emails={approvedEmails} />
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        {total === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Nenhum usuário cadastrado ainda.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-3">#</th>
                  <th className="px-3 py-3">Nome</th>
                  <th className="px-3 py-3">WhatsApp</th>
                  <th className="px-3 py-3">E-mail</th>
                  <th className="hidden px-3 py-3 sm:table-cell">Login</th>
                  <th className="hidden px-3 py-3 lg:table-cell">Cadastro</th>
                  <th className="px-3 py-3">Padrinho</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3">Nome no Bolão</th>
                  <th className="px-3 py-3">Obs.</th>
                  <th className="px-3 py-3">Participantes</th>
                  <th className="px-3 py-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {(users ?? []).map((user, i) => (
                  <UserRow
                    key={user.id}
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    user={user as any}
                    index={i}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="mt-3 text-right text-xs text-gray-400">
        {aprovados}/{total} aprovados · {pagos}/{total} pagos
      </p>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  const styles: Record<string, string> = {
    gray:    'bg-gray-50   border-gray-200   text-gray-700',
    verde:   'bg-verde-50  border-verde-200  text-verde-700',
    orange:  'bg-orange-50 border-orange-200 text-orange-700',
    amarelo: 'bg-yellow-50 border-yellow-200 text-yellow-700',
  }
  return (
    <div className={`rounded-xl border p-4 text-center ${styles[color] ?? styles.gray}`}>
      <p className="text-3xl font-black">{value}</p>
      <p className="mt-0.5 text-xs font-medium">{label}</p>
    </div>
  )
}
