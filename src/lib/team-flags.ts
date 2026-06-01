// ISO 3166-1 alpha-2 codes para uso com flagcdn.com
export const TEAM_CODES: Record<string, string> = {
  'África do Sul':  'za',
  'Alemanha':       'de',
  'Arábia Saudita': 'sa',
  'Argélia':        'dz',
  'Argentina':      'ar',
  'Austrália':      'au',
  'Áustria':        'at',
  'Bélgica':        'be',
  'Bósnia':         'ba',
  'Brasil':         'br',
  'Cabo Verde':     'cv',
  'Canadá':         'ca',
  'Catar':          'qa',
  'Colômbia':       'co',
  'RD Congo':       'cd',
  'Coreia do Sul':  'kr',
  'Costa do Marfim':'ci',
  'Croácia':        'hr',
  'Curaçao':        'cw',
  'Egito':          'eg',
  'Equador':        'ec',
  'Escócia':        'gb-sct',
  'Espanha':        'es',
  'EUA':            'us',
  'França':         'fr',
  'Gana':           'gh',
  'Haiti':          'ht',
  'Holanda':        'nl',
  'Inglaterra':     'gb-eng',
  'Irã':            'ir',
  'Iraque':         'iq',
  'Japão':          'jp',
  'Jordânia':       'jo',
  'Marrocos':       'ma',
  'México':         'mx',
  'Noruega':        'no',
  'Nova Zelândia':  'nz',
  'Panamá':         'pa',
  'Paraguai':       'py',
  'Portugal':       'pt',
  'Senegal':        'sn',
  'Suécia':         'se',
  'Suíça':          'ch',
  'Tchéquia':       'cz',
  'Tunísia':        'tn',
  'Turquia':        'tr',
  'Uruguai':        'uy',
  'Uzbequistão':    'uz',
}

// Mantido por retrocompatibilidade (pode remover quando não houver mais uso de TEAM_FLAGS)
export const TEAM_FLAGS = TEAM_CODES

export const TEAM_NAMES = Object.keys(TEAM_CODES).sort((a, b) =>
  a.localeCompare(b, 'pt-BR')
)

export function flagUrl(team: string): string | null {
  const code = TEAM_CODES[team]
  if (!code) return null
  return `https://flagcdn.com/20x15/${code}.png`
}

