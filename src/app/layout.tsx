import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { AdminViewProvider } from '@/contexts/AdminViewContext'
import './globals.css'

const font = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Melhor Bolão',
  description: 'Faça seus palpites para a Copa do Mundo FIFA 2026 e dispute com seus amigos!',
  keywords: ['bolão', 'copa do mundo', 'fifa 2026', 'palpites', 'futebol'],
  openGraph: {
    title: 'Melhor Bolão',
    description: 'Faça seus palpites para a Copa do Mundo FIFA 2026!',
    locale: 'pt_BR',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#009c3b',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className={font.variable}>
      <body className="min-h-screen bg-gray-50 font-sans">
        <AdminViewProvider>
          {children}
        </AdminViewProvider>
        <Toaster
          position="top-right"
          toastOptions={{
            duration: 3000,
            style: {
              borderRadius: '8px',
              background: '#1f2937',
              color: '#f9fafb',
              fontSize: '14px',
            },
            success: {
              iconTheme: { primary: '#009c3b', secondary: '#fff' },
            },
            error: {
              iconTheme: { primary: '#ef4444', secondary: '#fff' },
            },
          }}
        />
      </body>
    </html>
  )
}
