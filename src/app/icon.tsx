import { ImageResponse } from 'next/og'

export const size        = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
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
          borderRadius:   '6px',
          fontSize:       '22px',
          lineHeight:     1,
        }}
      >
        ⚽
      </div>
    ),
    { ...size },
  )
}
