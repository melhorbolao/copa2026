import { Navbar } from '@/components/layout/Navbar'
import { createClient } from '@/lib/supabase/server'
import { RegulamentoContent } from './RegulamentoContent'

export const metadata = { title: 'Regulamento — Melhor Bolão' }

const DEFAULT_CONTENT = `## 1. Participação

O bolão é restrito a convidados. Após cadastro via Google, o acesso aos palpites fica disponível somente após aprovação e confirmação de pagamento pelo administrador.

## 2. Prazos

O prazo para envio e edição de palpites é **23h59 (horário de Brasília) do dia anterior ao primeiro jogo de cada etapa**. Após o prazo, os campos ficam bloqueados.

| Etapa | Prazo |
|---|---|
| Rodada 1 + Bônus (classificados, G4, artilheiro) | 10/06 às 23h59 |
| Rodada 2 | 15/06 às 23h59 |
| Rodada 3 | 22/06 às 23h59 |
| 16 avos de final | 28/06 às 23h59 |
| Oitavas de final | 06/07 às 23h59 |
| Quartas de final | 10/07 às 23h59 |
| Semifinais | 13/07 às 23h59 |
| 3º lugar e Final | 17/07 às 23h59 |

## 3. Pontuação dos jogos

Para cada partida, o participante informa o placar exato ao final do tempo regulamentar (90 minutos). Nas fases eliminatórias, considera-se o placar incluindo prorrogação. Gols em disputa de pênaltis não são computados.

| Situação | Pontos |
|---|---|
| Placar exato + vencedor correto | 12 pts |
| Empate com placar exato | 12 pts |
| Empate com resultado correto (gols errados) | 7 pts |
| Vencedor correto + nº de gols do vencedor | 6 pts |
| Vencedor correto + diferença de gols | 5 pts |
| Vencedor correto + nº de gols do perdedor | 5 pts |
| Somente o vencedor correto | 4 pts |

**Exemplos:**
- Palpite Brasil 2×1 Argentina · Resultado Brasil 2×1 Argentina → **12 pts** (placar exato)
- Palpite Brasil 1×1 Argentina · Resultado França 0×0 Alemanha → **7 pts** (empate correto, gols errados)
- Palpite Brasil 2×0 Argentina · Resultado Brasil 2×1 Argentina → **6 pts** (vencedor + gols do vencedor)
- Palpite Brasil 1×0 Argentina · Resultado Brasil 3×2 Argentina → **5 pts** (vencedor + diferença de 1 gol)
- Palpite Brasil 4×1 Argentina · Resultado Brasil 2×1 Argentina → **5 pts** (vencedor + gols do perdedor)
- Palpite Brasil 3×0 Argentina · Resultado Brasil 2×1 Argentina → **4 pts** (somente o vencedor)

## 4. Jogos do Brasil — Peso 2

Em todos os jogos em que o Brasil participa, a **pontuação base é multiplicada por 2**.

Exemplo: acertar o placar exato de um jogo do Brasil vale **24 pts** (12 × 2). Acertar somente o vencedor vale **8 pts** (4 × 2). O bônus zebra (item 5) também é dobrado nos jogos do Brasil.

## 5. Bônus Zebra — Jogos

Quando um resultado (vitória de um time ou empate) tiver sido apostado por **15% ou menos dos participantes**, aquele resultado é considerado uma potencial zebra. Se o jogo der zebra, todos os participantes que pontuarem naquele jogo recebem **+6 pts extras** (dobrado nos jogos do Brasil).

> **Exemplos:**
> - Palpite Porto 0×1 Al Ahly · Resultado Porto 0×1 Al Ahly · apenas 10% apostaram em vitória do Al Ahly → 12 pts (placar exato) + 6 pts (zebra) = **18 pts**
> - Mesmo jogo com Brasil envolvido → **36 pts**

## 6. Bônus: Classificados por grupo

Para cada grupo (A a L), o participante aposta quais seleções terminarão em **1º e 2º lugar**. O prazo é o mesmo da Rodada 1. Não é permitido colocar o mesmo time em 1º e 2º.

| Acerto | Pontos |
|---|---|
| 1º e 2º lugares corretos na ordem certa | 12 pts |
| 1º e 2º lugares corretos em ordem invertida | 8 pts |
| Apenas 1º lugar correto (2º errado) | 6 pts |
| Apenas 2º lugar correto (1º errado) | 4 pts |
| Acertou 1 dos 2 classificados na ordem errada | 3 pts |

Na Copa 2026, os **8 melhores terceiros colocados** (de 12 grupos) também se classificam para a fase eliminatória. O participante aposta em quais seleções terminarão em 3º em cada grupo, e cada acerto entre os 8 classificados vale:

| Acerto | Pontos |
|---|---|
| Acertar 3º do grupo classificado | 2 pts |

> **Bônus zebra nos classificados:**
> - Se o 1º do grupo tiver sido apostado como 1º por 15% ou menos dos participantes → **+6 pts** para quem acertou
> - Se o 2º do grupo tiver sido apostado como classificado (1º ou 2º) por 15% ou menos → **+6 pts** para quem acertou em 2º

## 7. Bônus G4 e Artilheiro

Antes do início da Copa, o participante aposta nos quatro semifinalistas e no artilheiro. O prazo é o mesmo da Rodada 1.

| Acerto | Pontos |
|---|---|
| Cada semifinalista correto | +8 pts |
| Cada finalista correto (além do semi) | +4 pts |
| Vice-campeão correto | +6 pts |
| Campeão correto | +12 pts |
| Artilheiro correto | 12 pts |

**Os pontos são cumulativos. Exemplos:**
- Acertar os 4 semifinalistas + campeão + vice → 4×8 + 2×4 + 6 + 12 = **58 pts**
- Acertar apenas o campeão (errou os outros 3) → 8 + 4 + 12 = **24 pts**

> **Bônus zebra G4:** se um time tiver sido apostado no G4 por 15% ou menos dos participantes e chegar à semifinal → **+6 pts** para quem o apostou no G4.
>
> **Artilheiro:** em caso de mais de um artilheiro empatado em gols, todos os acertos pontuam. Gols em disputa de pênaltis não são contados. Não há bônus zebra no artilheiro.

## 8. Classificação geral

A classificação é determinada pela soma de todos os pontos. Em caso de empate, os critérios são:

1. Maior número de placares exatos (12 pts)
2. Maior número de resultados corretos (qualquer pontuação)
3. Maior pontuação nos bônus (grupos + G4 + artilheiro)
4. Sorteio entre os empatados

## 9. Premiação

A distribuição do prêmio será anunciada pelo administrador após encerramento das inscrições e confirmação dos pagamentos.

## 10. Disposições gerais

- O administrador é o árbitro final em caso de dúvidas.
- Resultados oficiais são os divulgados pela FIFA.
- Jogos cancelados ou suspensos não pontuam.
- O participante é responsável por enviar seus palpites dentro do prazo.
`

export default async function RegulamentoPage() {
  const supabase = await createClient()

  const [
    { data: { user } },
    { data: setting },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('settings').select('value').eq('key', 'regulamento').single(),
  ])

  let isAdmin = false
  if (user) {
    const { data: profile } = await supabase
      .from('users').select('is_admin').eq('id', user.id).single()
    isAdmin = profile?.is_admin ?? false
  }

  const content = setting?.value ?? DEFAULT_CONTENT

  return (
    <>
      <Navbar />
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-3xl font-black text-gray-900 mb-1">Regulamento</h1>
        <p className="text-sm text-gray-500 mb-8">Melhor Bolão · Copa 2026</p>
        <RegulamentoContent content={content} isAdmin={isAdmin} />
      </div>
    </>
  )
}
