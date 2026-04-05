'use client'

import { useState, useTransition } from 'react'
import { autoFillGroupBets } from './actions'

interface Props {
  enabled: boolean
  alreadyFilled: boolean
}

export function AutoFillButton({ enabled, alreadyFilled }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, startTransition] = useTransition()

  function handleClick() {
    if (alreadyFilled) {
      setShowConfirm(true)
    } else {
      doFill()
    }
  }

  function doFill() {
    startTransition(async () => {
      await autoFillGroupBets()
      setShowConfirm(false)
    })
  }

  return (
    <tr>
      <td colSpan={7} className="border-t border-verde-100 bg-verde-50 px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-verde-800">
              Preencher classificados com base nos placares
            </p>
            {!enabled && (
              <p className="mt-0.5 text-xs text-gray-500">
                Preencha todos os jogos da fase de grupos para habilitar.
              </p>
            )}
          </div>
          <button
            onClick={handleClick}
            disabled={!enabled || pending}
            className="rounded-lg bg-verde-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-verde-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pending ? 'Preenchendo…' : 'Preencher automaticamente'}
          </button>
        </div>

        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
            <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
              <h3 className="text-base font-bold text-gray-900">Sobrescrever classificações?</h3>
              <p className="mt-2 text-sm text-gray-600">
                Você já tem classificações preenchidas. Deseja substituí-las pelos resultados
                calculados com base nos seus placares?
              </p>
              <div className="mt-4 flex justify-end gap-3">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={doFill}
                  disabled={pending}
                  className="rounded-lg bg-verde-600 px-4 py-2 text-sm font-semibold text-white hover:bg-verde-700 disabled:opacity-40"
                >
                  {pending ? 'Preenchendo…' : 'Sim, substituir'}
                </button>
              </div>
            </div>
          </div>
        )}
      </td>
    </tr>
  )
}
