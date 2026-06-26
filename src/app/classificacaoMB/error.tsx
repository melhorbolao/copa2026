'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center px-4 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-50 text-4xl">
        ⚽
      </div>
      <h2 className="mt-4 text-xl font-bold text-gray-800">Algo deu errado</h2>
      <p className="mt-2 max-w-xs text-sm text-gray-500">
        Ocorreu um erro ao carregar a classificação. Você pode tentar novamente ou navegar para outra seção.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <button
          onClick={reset}
          className="rounded-lg bg-verde-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          Tentar Novamente
        </button>
        <Link
          href="/"
          className="rounded-lg border border-gray-200 bg-white px-5 py-2.5 text-sm font-semibold text-gray-700 transition hover:bg-gray-50"
        >
          Ir ao início
        </Link>
      </div>
      {error.digest && (
        <p className="mt-4 text-xs text-gray-400">Ref: {error.digest}</p>
      )}
    </div>
  )
}
