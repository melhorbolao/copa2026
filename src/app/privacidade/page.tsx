export const metadata = { title: 'Política de Privacidade' }

export default function PrivacidadePage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-black text-gray-900">Política de Privacidade</h1>
        <p className="mb-8 text-sm text-gray-400">Melhor Bolão — última atualização: abril de 2026</p>

        <section className="space-y-6 text-sm leading-relaxed text-gray-700">

          <div>
            <h2 className="mb-2 font-bold text-gray-900">1. O que é o Melhor Bolão</h2>
            <p>
              O Melhor Bolão é uma plataforma privada de palpites para a Copa do Mundo 2026, de acesso
              restrito a participantes convidados. O acesso é feito por login com conta Google ou
              cadastro com e-mail e senha.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">2. Dados coletados</h2>
            <p>Coletamos apenas os dados necessários para o funcionamento do bolão:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Nome completo</li>
              <li>Endereço de e-mail</li>
              <li>Número de WhatsApp</li>
              <li>Palpites e apostas registrados na plataforma</li>
              <li>Apresentação de perfil (opcional, fornecida pelo próprio usuário)</li>
            </ul>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">3. Como usamos os dados</h2>
            <p>Os dados são usados exclusivamente para:</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Identificar o participante e exibir seus palpites</li>
              <li>Calcular e divulgar a pontuação do bolão</li>
              <li>Enviar comunicações relacionadas ao bolão (prazos, resultados)</li>
            </ul>
            <p className="mt-2">Não compartilhamos seus dados com terceiros nem os utilizamos para fins comerciais.</p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">4. Login com Google</h2>
            <p>
              Ao entrar com sua conta Google, recebemos apenas nome e e-mail, conforme autorizado por
              você na tela de consentimento. Não acessamos outros dados da sua conta Google.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">5. Armazenamento e segurança</h2>
            <p>
              Os dados são armazenados no Supabase (infraestrutura em nuvem com criptografia em
              repouso e em trânsito). O acesso é restrito aos organizadores do bolão.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">6. Seus direitos (LGPD)</h2>
            <p>
              Você pode solicitar a qualquer momento a consulta, correção ou exclusão dos seus dados
              pessoais. Para isso, entre em contato pelo e-mail abaixo.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">7. Contato</h2>
            <p>
              Dúvidas ou solicitações relacionadas à privacidade:{' '}
              <a href="mailto:admin@melhorbolao.app.br" className="font-medium text-blue-600 hover:underline">
                admin@melhorbolao.app.br
              </a>
            </p>
          </div>

        </section>
      </div>
    </main>
  )
}
