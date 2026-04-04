export default function ConfirmarEmailPage() {
  return (
    <main
      className="flex min-h-screen flex-col items-center justify-center p-4"
      style={{ background: 'linear-gradient(135deg, #009c3b 0%, #002776 100%)' }}
    >
      <div className="w-full max-w-sm">
        <div className="rounded-2xl bg-white p-8 shadow-xl text-center">
          <div className="mb-4 text-5xl">📧</div>
          <h1 className="text-xl font-black text-gray-900 mb-2">Confirme seu e-mail</h1>
          <p className="text-sm text-gray-600 leading-relaxed mb-4">
            Enviamos um link de confirmação para o seu e-mail.
            Clique no link para ativar sua conta e continuar.
          </p>
          <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-xs text-gray-500">
            Não recebeu? Verifique a pasta de spam ou entre em contato com o administrador.
          </div>
        </div>
        <p className="mt-4 text-center text-xs text-white/50">
          Melhor Bolão · Copa do Mundo 2026
        </p>
      </div>
    </main>
  )
}
