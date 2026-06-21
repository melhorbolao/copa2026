import { streamText, convertToModelMessages, stepCountIs } from 'ai'
import { google } from '@ai-sdk/google'
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/server'
import { getPageVisibility, isPageVisible } from '@/lib/page-visibility'
import type { UIMessage } from 'ai'

export const dynamic = 'force-dynamic'

const SYSTEM_PROMPT = `Você é o Assistente do Melhor Bolão (MB). Responda em português, de forma objetiva e amigável.
Nunca invente dados. Sempre use uma das ferramentas disponíveis para buscar informações antes de responder.
Ferramentas disponíveis: get_top_ranking, list_matches, get_bets_by_match, search_participant_by_name.`

const MAX_MESSAGES = 10 // 5 interações = 10 mensagens (usuário + assistente)

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })

  const { data: profile } = await supabase
    .from('users').select('role').eq('id', user.id).single()
  const role = profile?.role ?? 'user'

  const rows = await getPageVisibility()
  if (!isPageVisible(rows, 'chatbot', role)) {
    return NextResponse.json({ error: 'Funcionalidade indisponível' }, { status: 403 })
  }

  const body = await req.json()
  const allMessages: UIMessage[] = body.messages ?? []

  // Descartar mensagens antigas — mantém apenas as últimas MAX_MESSAGES
  const recentMessages = allMessages.slice(-MAX_MESSAGES)
  const modelMessages = await convertToModelMessages(recentMessages)

  try {
  const result = streamText({
    model: google('gemini-2.0-flash'),
    system: SYSTEM_PROMPT,
    messages: modelMessages,
    stopWhen: stepCountIs(2),
    tools: {
      get_top_ranking: {
        description: 'Retorna os N primeiros colocados da classificação geral (máximo 10).',
        inputSchema: z.object({
          limite: z.number().int().min(1).max(10).default(5),
        }),
        execute: async ({ limite }: { limite: number }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any).rpc('fn_chatbot_top_ranking', { p_limit: limite })
          if (error) return { erro: error.message }
          return data ?? []
        },
      },

      list_matches: {
        description: 'Lista partidas da Copa (máx. 20), opcionalmente filtradas por fase. Use para encontrar match_id antes de consultar palpites.',
        inputSchema: z.object({
          fase: z.enum(['group', 'round_of_32', 'round_of_16', 'quarterfinal', 'semifinal', 'third_place', 'final']).optional(),
        }),
        execute: async ({ fase }: { fase?: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let query = (supabase as any)
            .from('matches')
            .select('id, match_number, team_home, team_away, phase, score_home, score_away')
            .order('match_number', { ascending: true })
            .limit(20)
          if (fase) query = query.eq('phase', fase)
          const { data, error } = await query
          if (error) return { erro: error.message }
          return data ?? []
        },
      },

      get_bets_by_match: {
        description: 'Retorna estatísticas agregadas dos palpites de um jogo específico. Nunca expõe dados individuais.',
        inputSchema: z.object({
          match_id: z.string().uuid(),
        }),
        execute: async ({ match_id }: { match_id: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any).rpc('fn_chatbot_bets_summary', { p_match_id: match_id })
          if (error) return { erro: error.message }
          return data ?? { total_palpites: 0, placar_mais_votado: null, top_5_placares: [] }
        },
      },

      search_participant_by_name: {
        description: 'Busca participante pelo apelido. Retorna apenas ID e apelido (máximo 5 resultados).',
        inputSchema: z.object({
          termo: z.string().min(2).max(50),
        }),
        execute: async ({ termo }: { termo: string }) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data, error } = await (supabase as any)
            .from('participants')
            .select('id, apelido')
            .ilike('apelido', `%${termo}%`)
            .limit(5)
          if (error) return { erro: error.message }
          return data ?? []
        },
      },
    },
  })

  return result.toUIMessageStreamResponse({
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('[chatbot/chat stream error]', msg)
      return msg
    },
  })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[chatbot/chat]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
