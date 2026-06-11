import Link from 'next/link'

export const metadata = { title: '403 — Acesso Negado' }

export default function AcessoNegadoPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-gray-50 px-4 text-center">
      <p className="text-8xl font-black text-gray-100">403</p>
      <h1 className="mt-2 text-2xl font-bold text-gray-800">Acesso Negado</h1>
      <p className="mt-2 max-w-sm text-sm text-gray-500">
        Você não tem permissão para acessar esta página. Se acredita que isso é um erro, fale com o administrador.
      </p>
      <Link
        href="/"
        className="mt-6 inline-block rounded-lg bg-azul-dark px-6 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
      >
        Voltar ao início
      </Link>
    </div>
  )
}
