/**
 * Skeleton renderizado enquanto o servidor carrega os dados pesados de
 * /palpites. Mantém o layout estável (zero CLS) e dá uma sensação de
 * carregamento progressivo enquanto os 8 queries terminam.
 */
export function PalpitesSkeleton() {
  return (
    <>
      {/* Sticky stats placeholder */}
      <div className="sticky z-40 border-b border-white/10 bg-gray-950/90 backdrop-blur-md" style={{ top: 'var(--sticky-top)' }}>
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 w-12 animate-pulse rounded bg-white/10" />
          ))}
        </div>
        <div className="h-[3px] w-full bg-white/5" />
      </div>

      <div className="mx-auto max-w-5xl px-4 py-6">
        {/* Tabs */}
        <div className="mb-4">
          <div className="h-7 w-48 animate-pulse rounded bg-gray-200" />
          <div className="mt-3 flex gap-1 border-b border-gray-200">
            <div className="h-9 w-24 animate-pulse rounded-t bg-gray-100" />
            <div className="h-9 w-28 animate-pulse rounded-t bg-gray-100" />
          </div>
        </div>

        {/* Excel buttons row */}
        <div className="mt-4 mb-4 flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded bg-gray-100" />
          <div className="h-7 w-24 animate-pulse rounded bg-gray-100" />
          <div className="h-7 w-20 animate-pulse rounded bg-gray-100" />
        </div>

        {/* Stage filter pills */}
        <div className="mb-2 flex flex-wrap gap-1.5">
          {Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className="h-8 w-20 animate-pulse rounded-lg bg-gray-100" />
          ))}
        </div>

        {/* Table skeleton */}
        <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div className="bg-gray-800 px-3 py-1.5">
            <div className="h-3 w-40 animate-pulse rounded bg-gray-700" />
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2 border-b border-gray-100 px-3 py-3">
              <div className="h-4 w-4 animate-pulse rounded bg-gray-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
              <div className="h-7 w-20 animate-pulse rounded bg-gray-100" />
              <div className="h-4 flex-1 animate-pulse rounded bg-gray-100" />
              <div className="hidden sm:block h-4 w-24 animate-pulse rounded bg-gray-100" />
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
