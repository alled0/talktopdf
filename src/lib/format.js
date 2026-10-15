export function formatPages(pageStart, pageEnd) {
  if (pageStart == null) return null
  return pageEnd != null && pageEnd !== pageStart ? `pp. ${pageStart}–${pageEnd}` : `p. ${pageStart}`
}

export const stripExtension = name => name.replace(/\.[^.]+$/, '')

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function formatCount(n) {
  return n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)
}

/** "report · p. 4" for a retrieved source. */
export const sourceShortLabel = source =>
  `${stripExtension(source.docName)} · ${formatPages(source.pageStart, source.pageEnd) || `part ${source.part}`}`

/**
 * Models sometimes write HTML line breaks inside Markdown, which is shown as raw text.
 * In table rows they become " · " (a newline would end the row); elsewhere real line breaks.
 */
export function tidyMarkdown(markdown) {
  return markdown
    .split('\n')
    .map(line => line.replace(/<br\s*\/?>/gi, /^\s*\|/.test(line) ? ' · ' : '  \n'))
    .join('\n')
}
