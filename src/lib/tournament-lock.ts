// Trava de escrita exclusiva do ciclo "Copa 2026". A próxima edição deve
// criar sua PRÓPRIA constante (ex.: COPA2027_ARCHIVED) em vez de reaproveitar
// esta — as rotas em /copa2026 continuam congeladas para sempre, independente
// do estado do torneio seguinte.
export const COPA2026_ARCHIVED: boolean =
  (process.env.COPA2026_ARCHIVED ?? 'true') !== 'false'

export function assertNotArchived(action?: string): void {
  if (COPA2026_ARCHIVED) {
    throw new Error(
      'O Melhor Bolão Copa 2026 foi encerrado. Esta página é somente histórico' +
      (action ? ` (ação bloqueada: ${action})` : '') + '.'
    )
  }
}
