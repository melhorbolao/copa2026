'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'

// group_name → team escolhido como 3º
type ThirdSelections = Record<string, string>
// group_name → { first, second } apostados (estado vivo do GroupBetRow)
type GroupBetSelections = Record<string, { first: string; second: string }>

const Ctx = createContext<{
  thirdSelections: ThirdSelections
  setThirdSelections: (s: ThirdSelections) => void
  groupBetSelections: GroupBetSelections
  setGroupBetSelection: (group: string, first: string, second: string) => void
}>({ thirdSelections: {}, setThirdSelections: () => {}, groupBetSelections: {}, setGroupBetSelection: () => {} })

function hashSelections(s: ThirdSelections): string {
  const keys = Object.keys(s).sort()
  let out = ''
  for (const k of keys) out += k + '=' + s[k] + ';'
  return out
}

function hashGroupBets(s: GroupBetSelections): string {
  const keys = Object.keys(s).sort()
  let out = ''
  for (const k of keys) out += k + '=' + s[k].first + '/' + s[k].second + ';'
  return out
}

export function ThirdPlaceProvider({
  children,
  initial,
  initialGroupBets = {},
}: {
  children: React.ReactNode
  initial: ThirdSelections
  initialGroupBets?: GroupBetSelections
}) {
  const [thirdSelections, setThirdSelections] = useState<ThirdSelections>(initial)
  const [groupBetSelections, setGroupBetSelections] = useState<GroupBetSelections>(initialGroupBets)

  const initialHash = useMemo(() => hashSelections(initial), [initial])
  const lastHash = useRef(initialHash)

  // Sincroniza quando o servidor revalida (ex: auto-preenchimento)
  useEffect(() => {
    if (initialHash === lastHash.current) return
    lastHash.current = initialHash
    setThirdSelections(initial)
  }, [initialHash, initial])

  const groupHash = useMemo(() => hashGroupBets(initialGroupBets), [initialGroupBets])
  const lastGroupHash = useRef(groupHash)

  // Sincroniza groupBetSelections quando o servidor revalida
  useEffect(() => {
    if (groupHash === lastGroupHash.current) return
    lastGroupHash.current = groupHash
    setGroupBetSelections(initialGroupBets)
  }, [groupHash, initialGroupBets])

  const setGroupBetSelection = useCallback((group: string, first: string, second: string) => {
    setGroupBetSelections(prev => ({ ...prev, [group]: { first, second } }))
  }, [])

  return (
    <Ctx.Provider value={{ thirdSelections, setThirdSelections, groupBetSelections, setGroupBetSelection }}>
      {children}
    </Ctx.Provider>
  )
}

export function useThirdPlace() {
  return useContext(Ctx)
}
