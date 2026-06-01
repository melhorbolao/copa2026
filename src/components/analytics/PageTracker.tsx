'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const THROTTLE_MS = 60_000

export function PageTracker() {
  const pathname = usePathname()
  const lastTracked = useRef<Record<string, number>>({})

  useEffect(() => {
    const track = async () => {
      const now = Date.now()
      if (now - (lastTracked.current[pathname] ?? 0) < THROTTLE_MS) return
      lastTracked.current[pathname] = now

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
