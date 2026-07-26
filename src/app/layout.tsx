import type { Metadata, Viewport } from 'next'
import { Plus_Jakarta_Sans } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import NextTopLoader from 'nextjs-toploader'
import { AdminViewProvider } from '@/contexts/AdminViewContext'
import { Sidebar } from '@/components/layout/Sidebar'
import { AlertBannerWrapper } from '@/components/AlertBannerWrapper'
import { PageTracker } from '@/components/analytics/PageTracker'
import { COPA2026_ARCHIVED } from '@/lib/tournament-lock'
import './globals.css'

const font = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-sans',
})

export const metadata: Metadata = {
  title: 'Melhor Bolão',
  description: '',
  keywords: ['bolão', 'copa do mundo', 'fifa 2026', 'palpites', 'futebol'],
  openGraph: {
    title: 'Melhor Bolão',
    description: '',
    locale: 'pt_BR',
    type: 'website',
  },
}

export const viewport: Viewport = {
  themeColor: '#001133',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="pt-BR" className={font.variable}>
      <head>
        {/* Sprite de bandeiras pré-carregado: 1 request cacheado para todas as 48 bandeiras */}
        <link rel="preload" as="image" href="/flags-sprite.png" type="image/png" />
      </head>
      <body className="min-h-screen bg-gray-50 font-sans">
        <NextTopLoader color="#009c3b" height={3} showSpinner={false} />
        <AdminViewProvider>
          <PageTracker />
          <Sidebar />
          <div className="sm:pl-48">
            {!COPA2026_ARCHIVED && (
              <div className="hidden sm:block sticky top-0 z-40">
                <AlertBannerWrapper />
              </div>
            )}
            {children}
          </div>
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
