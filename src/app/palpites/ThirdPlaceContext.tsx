'use client'

import { createContext, useContext, useState } from 'react'

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
  return (
    <Ctx.Provider value={{ thirdSelections, setThirdSelections }}>
      {children}
    </Ctx.Provider>
  )
}

export function useThirdPlace() {
  return useContext(Ctx)
}
