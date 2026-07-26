import Link from 'next/link'

export default function HomePage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #009c3b 0%, #002776 100%)' }}
    >
      <div className="w-full max-w-sm text-center">
        <div className="rounded-2xl bg-white p-8 shadow-xl">
          <div className="mb-4 text-5xl">🏆</div>
          <h1 className="mb-2 text-xl font-bold text-gray-900">
            Melhor Bolão Copa 2026 encerrado!
          </h1>
          <p className="mb-6 text-sm text-gray-500">
            Obrigado por participar do Melhor Bolão Copa do Mundo 2026! O torneio
            terminou e o site agora funciona como um histórico dos resultados e
            palpites finais.
          </p>
          <Link
            href="/copa2026/classificacaoMB"
            className="inline-block w-full rounded-lg bg-azul-dark px-4 py-3 text-sm font-semibold text-white transition hover:opacity-90"
            style={{ backgroundColor: '#002776' }}
          >
            Ver Histórico Copa 2026 →
          </Link>
        </div>
        <p className="mt-6 text-center text-xs text-white/85">
          Até a próxima competição!
        </p>
      </div>
    </main>
  )
}
