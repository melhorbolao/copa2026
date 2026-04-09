import { ImageResponse } from 'next/og'
import { readFileSync } from 'fs'
import { join } from 'path'

export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  const logoData   = readFileSync(join(process.cwd(), 'public/logo.png'))
  const logoBase64 = `data:image/png;base64,${logoData.toString('base64')}`

  return new ImageResponse(
    (
      <div
        style={{
          background:     '#009c3b',
          width:          '100%',
          height:         '100%',
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          borderRadius:   '5px',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoBase64}
          width={24}
          height={24}
          style={{ objectFit: 'contain' }}
          alt=""
        />
      </div>
    ),
    { ...size },
  )
}
