'use client'

import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'

// group_name → team escolhido como 3º
type ThirdSelections = Record<string, string>

const Ctx = createContext<{
  thirdSelections: ThirdSelections
  setThirdSelections: (s: ThirdSelections) => void
}>({ thirdSelections: {}, setThirdSelections: () => {} })

/**
 * Hash determinístico (e barato) das seleções iniciais — usado como dep do
 * useEffect para sincronizar quando o servidor revalida. Mais leve do que
 * `JSON.stringify` em cada render do pai.
 */
function hashSelections(s: ThirdSelections): string {
  const keys = Object.keys(s).sort()
  let out = ''
  for (const k of keys) out += k + '=' + s[k] + ';'
  return out
}

export function ThirdPlaceProvider({
  children,
  initial,
}: {
  children: React.ReactNode
  initial: ThirdSelections
}) {
  const [thirdSelections, setThirdSelections] = useState<ThirdSelections>(initial)
  const initialHash = useMemo(() => hashSelections(initial), [initial])
  const lastHash = useRef(initialHash)

  useEffect(() => {
    if (initialHash === lastHash.current) return
    lastHash.current = initialHash
    setThirdSelections(initial)
  }, [initialHash, initial])

  return (
    <Ctx.Provider value={{ thirdSelections, setThirdSelections }}>
      {children}
    </Ctx.Provider>
  )
}

export function useThirdPlace() {
  return useContext(Ctx)
}
