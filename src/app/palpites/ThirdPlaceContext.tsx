'use client'

import { createContext, useContext, useEffect, useState } from 'react'

// group_name → team escolhido como 3º
type ThirdSelections = Record<string, string>

const Ctx = createContext<{
  thirdSelections: ThirdSelections
  setThirdSelections: (s: ThirdSelections) => void
}>({ thirdSelections: {}, setThirdSelections: () => {} })

export function ThirdPlaceProvider({
  children,
  initial,
}: {
  children: React.ReactNode
  initial: ThirdSelections
}) {
  const [thirdSelections, setThirdSelections] = useState<ThirdSelections>(initial)

  // Sincroniza quando o servidor revalida com novos dados (ex: auto-preenchimento)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setThirdSelections(initial) }, [JSON.stringify(initial)])

  return (
    <Ctx.Provider value={{ thirdSelections, setThirdSelections }}>
      {children}
    </Ctx.Provider>
  )
}

export function useThirdPlace() {
  return useContext(Ctx)
}
