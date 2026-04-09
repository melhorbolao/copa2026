export const metadata = { title: 'Termos de Uso' }

export default function TermosPage() {
  return (
    <main className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-2xl rounded-2xl bg-white p-8 shadow-sm">
        <h1 className="mb-1 text-2xl font-black text-gray-900">Termos de Uso</h1>
        <p className="mb-8 text-sm text-gray-400">Melhor Bolão — última atualização: abril de 2026</p>

        <section className="space-y-6 text-sm leading-relaxed text-gray-700">

          <div>
            <h2 className="mb-2 font-bold text-gray-900">1. Aceitação</h2>
            <p>
              Ao se cadastrar e utilizar o Melhor Bolão, você concorda com estes Termos de Uso. O acesso
              é restrito a participantes convidados e aprovados pelos organizadores.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">2. Funcionamento</h2>
            <p>
              O Melhor Bolão é uma competição privada e amigável de palpites para a Copa do Mundo 2026.
              Os palpites são registrados pelo site dentro dos prazos estabelecidos. Após o prazo, os
              campos ficam bloqueados e não é possível alterar os palpites.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">3. Responsabilidades do participante</h2>
            <ul className="list-disc space-y-1 pl-5">
              <li>Manter seus dados de acesso em sigilo</li>
              <li>Registrar seus palpites dentro dos prazos</li>
              <li>Respeitar as regras do regulamento publicado na plataforma</li>
              <li>Não compartilhar acesso com terceiros</li>
            </ul>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">4. Inscrição e pagamento</h2>
            <p>
              A participação implica o pagamento da inscrição de R$ 250,00 via PIX, conforme informado
              pelos organizadores. O não pagamento pode resultar no cancelamento do acesso.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">5. Prêmios</h2>
            <p>
              A distribuição dos prêmios segue o regulamento vigente, disponível em{' '}
              <a href="/regulamento" className="font-medium text-blue-600 hover:underline">
                melhorbolao.app.br/regulamento
              </a>
              . Os organizadores se reservam o direito de ajustar o regulamento mediante comunicação
              prévia aos participantes.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">6. Limitação de responsabilidade</h2>
            <p>
              Os organizadores não se responsabilizam por falhas de conectividade que impeçam o envio
              de palpites dentro do prazo. Em caso de indisponibilidade do site, será comunicado um
              canal alternativo.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">7. Encerramento de conta</h2>
            <p>
              Os organizadores podem suspender ou remover o acesso de qualquer participante que viole
              estas regras. O participante também pode solicitar a exclusão de sua conta a qualquer
              momento pelo e-mail abaixo.
            </p>
          </div>

          <div>
            <h2 className="mb-2 font-bold text-gray-900">8. Contato</h2>
            <p>
              Dúvidas sobre os termos:{' '}
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
