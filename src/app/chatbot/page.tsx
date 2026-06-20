export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requirePageAccess } from '@/lib/page-visibility'
import { Navbar } from '@/components/layout/Navbar'
import { ChatbotClient } from './ChatbotClient'

export const metadata = { title: 'Assistente MB | Melhor Bolão' }

export default async function ChatbotPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()

  await requirePageAccess('chatbot', profile?.role ?? 'user')

  return (
    <>
      <Navbar />
      <ChatbotClient />
    </>
  )
}
