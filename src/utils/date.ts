import { formatInTimeZone, toZonedTime } from 'date-fns-tz'
import { ptBR } from 'date-fns/locale'

export const BRASILIA_TZ = 'America/Sao_Paulo'

/** Formata uma data para exibição no fuso de Brasília */
export function formatBrasilia(
  date: string | Date,
  fmt = "dd/MM/yyyy 'às' HH:mm"
): string {
  return formatInTimeZone(new Date(date), BRASILIA_TZ, fmt, { locale: ptBR })
}

/** Retorna se o prazo de apostas já passou */
export function isDeadlinePassed(deadline: string | Date): boolean {
  return new Date() > new Date(deadline)
}

/** Segundos restantes até um prazo */
export function secondsUntil(deadline: string | Date): number {
  return Math.max(0, Math.floor((new Date(deadline).getTime() - Date.now()) / 1000))
}

/** Converte UTC para objeto Date no fuso de Brasília */
export function toBrasilia(date: string | Date): Date {
  return toZonedTime(new Date(date), BRASILIA_TZ)
}
