import { DadosAdminClient } from './DadosAdminClient'

export default function DadosAdminPage() {
  return (
    <>
      <h2 className="mb-2 text-lg font-bold text-gray-900">Gestão de Dados</h2>
      <p className="mb-6 text-sm text-gray-500">
        Exportar, importar e limpar palpites e resultados.
      </p>
      <DadosAdminClient />
    </>
  )
}
