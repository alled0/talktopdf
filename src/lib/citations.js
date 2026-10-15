// Finds "[n]" style citations in model answers: [2], [1, 3], [2-4], [1][3].
const CITATION = /\[(\d{1,2}(?:\s*[,–-]\s*\d{1,2})*)\](?!\()/g
const CODE = /(```[\s\S]*?```|`[^`\n]*`)/
// gpt-oss models sometimes fall back to OpenAI's citation style: 【1】 or 【1†source】.
const ALT_CITATION = /【(\d{1,2})(?:†[^】]*)?】/g

/** Rewrites alternative citation styles as [n]. */
export const normalizeCitations = text => text.replace(ALT_CITATION, '[$1]')

export function expandCitation(inner) {
  const numbers = []
  for (const part of inner.split(',')) {
    const [a, b] = part.split(/[–-]/).map(s => Number(s.trim()))
    if (b !== undefined && b >= a && b - a < 10) for (let n = a; n <= b; n++) numbers.push(n)
    else numbers.push(a)
  }
  return numbers
}

/** Source numbers cited in `text`, in order of first appearance, limited to 1..max. */
export function citedNumbers(text, max) {
  const seen = []
  for (const segment of normalizeCitations(text).split(CODE).filter((_, i) => i % 2 === 0)) {
    for (const match of segment.matchAll(CITATION)) {
      for (const n of expandCitation(match[1])) {
        if (n >= 1 && n <= max && !seen.includes(n)) seen.push(n)
      }
    }
  }
  return seen
}

/** Rewrites citations as Markdown links (#cite-n) so the renderer can turn them into buttons. */
export function linkCitations(markdown, max) {
  return normalizeCitations(markdown)
    .split(CODE)
    .map((segment, i) => (i % 2 === 1 ? segment : segment.replace(CITATION, (whole, inner) => {
      const numbers = expandCitation(inner).filter(n => n >= 1 && n <= max)
      return numbers.length ? numbers.map(n => `[${n}](#cite-${n})`).join('') : whole
    })))
    .join('')
}

/** Removes citation markers, e.g. for copying an answer as plain text. */
export const stripCitations = text => normalizeCitations(text).replace(CITATION, '').replace(/ +([.,;:!?])/g, '$1')
