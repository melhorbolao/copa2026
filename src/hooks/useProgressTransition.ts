'use client'

import { useTransition } from 'react'
import { useTopLoader } from 'nextjs-toploader'

export function useProgressTransition(): [boolean, (fn: () => Promise<unknown> | unknown) => void] {
  const [isPending, startTransition] = useTransition()
  const { start, done } = useTopLoader()

  function startWithProgress(fn: () => Promise<unknown> | unknown) {
    start()
    startTransition(async () => {
      try {
        await fn()
      } finally {
        done()
      }
    })
  }

  return [isPending, startWithProgress]
}
