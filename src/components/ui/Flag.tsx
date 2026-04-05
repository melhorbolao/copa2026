import Image from 'next/image'

interface FlagProps {
  code: string       // ISO 3166-1 alpha-2 (ex: 'BR', 'AR')
  name?: string      // nome da seleção (usado no alt)
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const sizes = {
  sm: { width: 20, height: 15 },
  md: { width: 32, height: 24 },
  lg: { width: 48, height: 36 },
}

export function Flag({ code, name = '', size = 'md', className = '' }: FlagProps) {
  const { width, height } = sizes[size]

  if (!code) return null

  // Aceita URL completa (ex: https://flagcdn.com/w40/de.png) ou código ISO (ex: 'de')
  const isUrl = code.startsWith('http')
  const src    = isUrl ? code : `https://flagcdn.com/w80/${code.toLowerCase()}.png`

  return (
    <Image
      src={src}
      width={width}
      height={height}
      alt={name ? `Bandeira ${name}` : `Bandeira ${code}`}
      className={`inline-block rounded-sm object-cover shadow-sm ${className}`}
      unoptimized
    />
  )
}
