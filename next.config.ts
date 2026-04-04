import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // exceljs não deve ser bundlado pelo Turbopack — carrega do node_modules em runtime
  serverExternalPackages: ['exceljs'],
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'flagcdn.com',
      },
      {
        protocol: 'https',
        hostname: 'upload.wikimedia.org',
      },
    ],
  },
}

export default nextConfig
