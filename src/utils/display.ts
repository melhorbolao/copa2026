/**
 * Retorna o nome de exibição do participante.
 * Usa o apelido se preenchido, senão o nome completo.
 */
export function getDisplayName(user: {
  name: string
  apelido?: string | null
}): string {
  return user.apelido?.trim() || user.name
}
