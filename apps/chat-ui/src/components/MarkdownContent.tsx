import React from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Components } from 'react-markdown'

interface Props {
  content: string
}

/**
 * Sanitize a URL to prevent XSS via javascript:/data:/vbscript: hrefs.
 * Returns the href unchanged if it uses a safe scheme, otherwise returns '#'.
 */
function sanitizeHref(href: string | undefined): string {
  if (!href) return '#'
  const trimmed = href.trim().toLowerCase()
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('vbscript:')
  ) {
    return '#'
  }
  return href
}

const markdownComponents: Components = {
  // Override `pre` to avoid double-wrapping: when a `code` block is detected and
  // SyntaxHighlighter is rendered (which generates its own <pre>), react-markdown
  // would otherwise wrap it in an additional <pre>. This makes the outer <pre>
  // transparent, letting SyntaxHighlighter control its own container.
  pre({ children }) {
    return <>{children}</>
  },
  code({ className, children }) {
    const match = /language-(\w+)/.exec(className ?? '')
    if (match) {
      return (
        <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div">
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      )
    }
    return (
      <code className={`bg-gray-700 px-1 py-0.5 rounded text-sm font-mono ${className ?? ''}`}>
        {children}
      </code>
    )
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full text-sm border border-gray-700">{children}</table>
      </div>
    )
  },
  thead({ children }) {
    return <thead className="bg-gray-800">{children}</thead>
  },
  th({ children }) {
    return <th className="px-3 py-2 text-left font-semibold border-b border-gray-700">{children}</th>
  },
  td({ children }) {
    return <td className="px-3 py-2 border-b border-gray-800">{children}</td>
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-4 border-blue-500 pl-4 italic text-gray-300 my-3">
        {children}
      </blockquote>
    )
  },
  a({ children, href }) {
    return (
      <a
        href={sanitizeHref(href)}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-400 underline hover:text-blue-300"
      >
        {children}
      </a>
    )
  },
  ul({ children }) {
    return <ul className="list-disc pl-5 my-2 space-y-1">{children}</ul>
  },
  ol({ children }) {
    return <ol className="list-decimal pl-5 my-2 space-y-1">{children}</ol>
  },
  p({ children }) {
    return <p className="my-2 leading-relaxed">{children}</p>
  },
}

const MarkdownContent = React.memo(function MarkdownContent({ content }: Props) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
      {content}
    </ReactMarkdown>
  )
})

export default MarkdownContent
