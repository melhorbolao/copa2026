import { getPageVisibility } from '@/lib/page-visibility'
import { PageVisibilityClient } from './PageVisibilityClient'

export const metadata = {}

export default async function PaginasAdminPage() {
  const rows = await getPageVisibility()

  return (
    <div>
      <h2 className="mb-1 text-lg font-bold text-gray-800">Visibilidade de Páginas</h2>
      <p className="mb-4 text-sm text-gray-500">
        Controle quais páginas aparecem no menu para admins e usuários.
      </p>
      <PageVisibilityClient rows={rows} />
    </div>
  )
}
