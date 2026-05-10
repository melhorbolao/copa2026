/**
 * Variante PNG do sprite de bandeiras: gera /public/flags-sprite.png
 * (atlas 6x8 de 32×24 px) + /public/flags-sprite.json com offsets.
 *
 * Tradeoff vs SVG: ~30 KB vs 784 KB, mas perde escalonamento livre
 * (renderiza em 32×24 nominal; via CSS pode ampliar para 40×30 com
 * leve perda de nitidez em retina).
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const CODES = [
  'ar','at','au','ba','be','br','ca','cd','ch','ci','co','cv','cw','cz',
  'de','dz','ec','eg','es','fr','gb-eng','gb-sct','gh','hr','ht','iq','ir',
  'jo','jp','kr','ma','mx','nl','no','nz','pa','pt','py','qa','sa','se',
  'sn','tn','tr','us','uy','uz','za',
]

const TILE_W = 80   // 80×60 retina-friendly (renderizado em 20×15 css)
const TILE_H = 60
const COLS   = 8
const ROWS   = Math.ceil(CODES.length / COLS)

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT_PNG = resolve(__dirname, '..', 'public', 'flags-sprite.png')
const OUT_JSON = resolve(__dirname, '..', 'public', 'flags-sprite.json')

console.log(`Baixando ${CODES.length} bandeiras em ${TILE_W}×${TILE_H}…`)
const tiles = await Promise.all(CODES.map(async code => {
  const url = `https://flagcdn.com/w${TILE_W}/${code}.png`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Falha ${code}: ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  // Algumas bandeiras vêm em proporção diferente — força para 80×60
  const resized = await sharp(buf).resize(TILE_W, TILE_H, { fit: 'fill' }).png().toBuffer()
  return { code, buf: resized }
}))

console.log(`Combinando em atlas ${COLS}×${ROWS}…`)
const compositeOps = tiles.map((t, i) => ({
  input: t.buf,
  left: (i % COLS) * TILE_W,
  top:  Math.floor(i / COLS) * TILE_H,
}))
const positions = Object.fromEntries(tiles.map((t, i) => [
  t.code,
  { x: (i % COLS) * TILE_W, y: Math.floor(i / COLS) * TILE_H },
]))

const sprite = await sharp({
  create: { width: COLS * TILE_W, height: ROWS * TILE_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite(compositeOps)
  .png({ compressionLevel: 9, palette: false })
  .toBuffer()

mkdirSync(dirname(OUT_PNG), { recursive: true })
writeFileSync(OUT_PNG, sprite)
writeFileSync(OUT_JSON, JSON.stringify({ tile: { w: TILE_W, h: TILE_H }, cols: COLS, rows: ROWS, positions }, null, 2))

const sizeKb = (sprite.length / 1024).toFixed(1)
console.log(`✓ ${OUT_PNG} (${sizeKb} KB, ${COLS * TILE_W}×${ROWS * TILE_H})`)
console.log(`✓ ${OUT_JSON}`)
