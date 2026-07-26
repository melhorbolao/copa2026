'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface Props {
  content: string
}

export function RegulamentoContent({ content }: Props) {
  return <MarkdownRenderer content={content} />
}

function MarkdownRenderer({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-3xl font-black text-gray-900 mb-1">{children}</h1>
        ),
        h2: ({ children }) => (
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm mb-6">
            <h2 className="mb-3 text-base font-black text-gray-900">{children}</h2>
          </section>
        ),
        p: ({ children }) => (
          <p className="text-sm text-gray-700 leading-relaxed mb-3">{children}</p>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900">{children}</strong>
        ),
        ul: ({ children }) => (
          <ul className="list-disc list-inside space-y-1 text-gray-700 text-sm mb-3">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal list-inside space-y-1 text-gray-700 text-sm mb-3">{children}</ol>
        ),
        li: ({ children }) => <li>{children}</li>,
        table: ({ children }) => (
          <div className="overflow-x-auto rounded-lg border border-gray-100 mb-3">
            <table className="w-full text-sm">{children}</table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-gray-50 text-xs font-semibold uppercase tracking-wide text-gray-400">
            {children}
          </thead>
        ),
        tbody: ({ children }) => <tbody>{children}</tbody>,
        tr: ({ children }) => (
          <tr className="border-t border-gray-100">{children}</tr>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left">{children}</th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-gray-700">{children}</td>
        ),
        blockquote: ({ children }) => (
          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-3 text-sm text-gray-600 mb-3">
            {children}
          </div>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  )
}
