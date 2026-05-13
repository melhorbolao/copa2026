import positions from '../../../public/flags-sprite.json'

interface FlagProps {
  /** ISO 3166-1 alpha-2 ou pseudo-código (ex: 'br', 'gb-eng'). */
  code: string
  /** Nome da seleção (acessibilidade). */
  name?: string
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
  title?: string
}

const SPRITE_TILE_W = positions.tile.w
const SPRITE_TILE_H = positions.tile.h
const SPRITE_COLS   = positions.cols
const SPRITE_ROWS   = positions.rows
const SPRITE_W = SPRITE_COLS * SPRITE_TILE_W
const SPRITE_H = SPRITE_ROWS * SPRITE_TILE_H

// Tamanhos em proporção 4:3 (mesma proporção dos tiles do sprite). Se você
// quiser uma bandeira menor que `sm` no bracket, use `xs` — NÃO sobrescreva
// width/height via className/!important, pois o backgroundSize do sprite é
// calculado a partir do width fixado aqui e descasaria, recortando o tile.
const sizes = {
  xs: { width: 16, height: 12 },
  sm: { width: 20, height: 15 },
  md: { width: 32, height: 24 },
  lg: { width: 48, height: 36 },
}

/**
 * Renderiza uma bandeira a partir do sprite único em /public/flags-sprite.png
 * (~68 KB, 48 bandeiras). Substitui o request individual ao flagcdn por
 * posicionamento CSS — 1 download cacheado vale para a página inteira.
 *
 * Fallback: se o `code` não estiver no sprite (caso extremo, ex: bandeira
 * adicionada depois), volta a buscar diretamente no flagcdn.
 */
export function Flag({ code, name = '', size = 'md', className = '', title }: FlagProps) {
  if (!code) return null
  const { width, height } = sizes[size]
  const lc = code.toLowerCase()
  const pos = (positions.positions as Record<string, { x: number; y: number }>)[lc]

  if (!pos) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={code.startsWith('http') ? code : `https://flagcdn.com/w80/${lc}.png`}
        width={width}
        height={height}
        alt={name ? `Bandeira ${name}` : `Bandeira ${code}`}
        title={title}
        className={`inline-block rounded-sm object-cover shadow-sm ${className}`}
      />
    )
  }

  // Escala o tile para o tamanho desejado: scale = width / SPRITE_TILE_W
  const scale = width / SPRITE_TILE_W
  const bgW   = SPRITE_W * scale
  const bgH   = SPRITE_H * scale
  const bgX   = -pos.x * scale
  const bgY   = -pos.y * scale

  return (
    <span
      role="img"
      aria-label={name ? `Bandeira ${name}` : `Bandeira ${code}`}
      title={title}
      style={{
        display: 'inline-block',
        width,
        height,
        backgroundImage: 'url(/flags-sprite.png)',
        backgroundSize: `${bgW}px ${bgH}px`,
        backgroundPosition: `${bgX}px ${bgY}px`,
        backgroundRepeat: 'no-repeat',
      }}
      className={`rounded-sm shadow-sm ${className}`}
    />
  )
}
