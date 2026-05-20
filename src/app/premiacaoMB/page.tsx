export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient, createAuthAdminClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'

export const metadata = {}

const ENTRY_FEE = 250

const PRIZE_DIST = [
  { place: '1º',  pct: 55.0 },
  { place: '2º',  pct: 15.0 },
  { place: '3º',  pct:  9.0 },
  { place: '4º',  pct:  6.0 },
  { place: '5º',  pct:  5.0 },
  { place: '6º',  pct:  3.0 },
  { place: '7º',  pct:  2.5 },
  { place: '8º',  pct:  2.0 },
  { place: '9º',  pct:  1.5 },
  { place: '10º', pct:  1.0 },
]

function brl(value: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)
}

export default async function PremiacaoMBPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('is_admin').eq('id', user.id).single()
  const isAdmin = profile?.is_admin ?? false
  await requirePageAccess('premiacaoMB', isAdmin)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const admin = createAuthAdminClient() as any
  const { data: participants } = await admin.from('participants').select('paid')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pagos      = (participants ?? []).filter((p: any) => p.paid).length
  const totalPrize = pagos * ENTRY_FEE

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-lg px-4 py-8">
        <h1 className="text-2xl font-black text-gray-900 mb-1">Premiação</h1>
        <p className="text-sm text-gray-500 mb-6">Melhor Bolão · Copa do Mundo 2026</p>

        {/* Resumo da arrecadação */}
        <div className="mb-5 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <tbody>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-gray-500">Valor por participante</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                  {brl(ENTRY_FEE)}
                </td>
              </tr>
              <tr className="border-b border-gray-100">
                <td className="px-4 py-3 text-gray-500">Participantes</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-900 tabular-nums">
                  {pagos}
                </td>
              </tr>
              <tr className="bg-verde-50">
                <td className="px-4 py-3 font-bold text-verde-800">Premiação total</td>
                <td className="px-4 py-3 text-right font-black text-verde-800 text-base tabular-nums">
                  {brl(totalPrize)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tabela de distribuição */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2.5 text-left">Colocação</th>
                <th className="px-4 py-2.5 text-right">Prêmio</th>
                <th className="px-4 py-2.5 text-right">%</th>
              </tr>
            </thead>
            <tbody>
              {PRIZE_DIST.map(({ place, pct }, i) => {
                const amount = totalPrize * pct / 100
                const top    = i === 0
                return (
                  <tr
                    key={place}
                    className={`border-b border-gray-50 last:border-0 ${top ? 'bg-amarelo-50' : ''}`}
                  >
                    <td className={`px-4 py-2.5 ${top ? 'font-bold text-amarelo-800' : 'font-medium text-gray-700'}`}>
                      {place} colocado
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${top ? 'font-bold text-amarelo-800' : 'text-gray-700'}`}>
                      {brl(amount)}
                    </td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${top ? 'font-bold text-amarelo-800' : 'text-gray-500'}`}>
                      {pct.toFixed(1).replace('.', ',')}%
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-gray-200 bg-gray-50">
                <td className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Total
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500 tabular-nums">
                  {brl(totalPrize)}
                </td>
                <td className="px-4 py-2.5 text-right text-xs font-semibold text-gray-500">
                  100,0%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Observações */}
        <div className="mt-4 space-y-1 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs text-gray-500">
          <p>Não há critério de desempate.</p>
          <p>Se houver empate em posições premiadas, o prêmio é dividido igualmente.</p>
          <p>
            <span className="font-semibold">Ex:</span>{' '}
            2 participantes empatam em 1º lugar — soma-se o prêmio do 1º e do 2º e divide-se por 2.
          </p>
        </div>
      </div>
    </>
  )
}
