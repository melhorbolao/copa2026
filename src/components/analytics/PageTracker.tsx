'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const PER_PATH_THROTTLE_MS = 60_000
const GLOBAL_THROTTLE_MS = 10_000

export function PageTracker() {
  const pathname = usePathname()
  const lastTrackedByPath = useRef<Record<string, number>>({})
  const lastTrackedAny = useRef<number>(0)

  useEffect(() => {
    const track = async () => {
      const now = Date.now()
      if (now - lastTrackedAny.current < GLOBAL_THROTTLE_MS) return
      if (now - (lastTrackedByPath.current[pathname] ?? 0) < PER_PATH_THROTTLE_MS) return
      lastTrackedByPath.current[pathname] = now
      lastTrackedAny.current = now

      const supabase = createClient()
      // getSession lê do cookie local (zero I/O de rede); getUser fazia HTTP ao servidor de auth
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user) return

      const device = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'
      // Ignoramos erro silenciosamente — telemetria nunca deve bloquear a UX
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any).from('page_views').insert({
        user_id: session.user.id,
        path: pathname,
        device_type: device,
      })
    }

    track()
  }, [pathname])

  return null
}
