// Pure helpers that turn pdf.js text items into clean page text.

const RTL_CHARS = /[֐-ࣿיִ-﷿ﹰ-﻿]/g
const LTR_CHARS = /[A-Za-z0-9À-ɏͰ-ϿЀ-ӿ]/g
const PRESENTATION_FORMS = /[ﭐ-﷿ﹰ-ﻼ]+/g

const count = (text, re) => text.match(re)?.length || 0
const strongType = str => (count(str, RTL_CHARS) ? 'R' : count(str, LTR_CHARS) ? 'L' : 'N')

// Horizontal distance between two boxes, regardless of which comes first (negative = overlap).
const gapBetween = (a, b) => Math.max(a.x, b.x) - Math.min(a.x + a.width, b.x + b.width)

// PDFs store right-to-left text in visual order. Read the line right to left, but keep
// embedded left-to-right runs (Latin words, numbers) in their own reading order.
function orderRightToLeft(items) {
  const ordered = []
  let run = []
  let neutrals = []
  const flushRun = () => { ordered.push(...run.reverse()); run = [] }

  for (const item of [...items].sort((a, b) => b.x - a.x)) {
    const type = strongType(item.str)
    if (type === 'N') {
      neutrals.push(item)
    } else if (type === 'L') {
      if (run.length) run.push(...neutrals)
      else ordered.push(...neutrals)
      neutrals = []
      run.push(item)
    } else {
      flushRun()
      ordered.push(...neutrals, item)
      neutrals = []
    }
  }
  flushRun()
  ordered.push(...neutrals)
  return ordered
}

function lineText(items) {
  const joined = items.map(i => i.str).join('')
  const rtl = count(joined, RTL_CHARS) > count(joined, LTR_CHARS)
  const ordered = rtl ? orderRightToLeft(items) : items

  let text = ''
  let previous = null
  for (const item of ordered) {
    const needsSpace = previous && text && !/\s$/.test(text) && !/^\s/.test(item.str) &&
      gapBetween(previous, item) > item.height * 0.12
    text += (needsSpace ? ' ' : '') + item.str
    previous = item
  }
  return text
    .replace(PRESENTATION_FORMS, s => s.normalize('NFKC'))
    .replace(/\s+([ً-ٰٟ])/g, '$1') // isolated harakat normalize to " " + mark
    .replace(/\s+/g, ' ')
    .trim()
}

// Groups pdf.js text items into visual lines and rebuilds each line's text.
export function itemsToLines(items) {
  const lines = []
  let current = []
  let lastY = null

  const pushLine = () => {
    const text = current.length ? lineText(current) : ''
    if (text) lines.push(text)
    current = []
  }

  for (const item of items) {
    if (typeof item.str !== 'string') continue
    const y = item.transform[5]
    const height = Math.abs(item.height) || Math.abs(item.transform[3]) || 10

    if (lastY !== null && Math.abs(y - lastY) > height * 0.6) pushLine()
    if (item.str) {
      current.push({ str: item.str, x: item.transform[4], width: item.width, height })
      lastY = y
    }
    if (item.hasEOL) pushLine()
  }
  pushLine()
  return lines
}

const exactKey = line => line.toLowerCase().replace(/\s+/g, ' ').trim()
const digitlessKey = line => exactKey(line).replace(/\d+/g, '#')
const PAGE_NUMBER = /^(page\s*)?#(\s*(of|\/)\s*#)?$/

// Drops running headers/footers: lines at the top or bottom of a page that repeat on many pages
// (ignoring digits for short lines, so "Report · 3" and "Report · 4" count as the same header).
export function stripRepeatedLines(pages) {
  if (pages.length < 4) return pages
  const edgeIndexes = p => {
    const n = p.lines.length
    const indexes = n >= 6 ? [0, 1, n - 2, n - 1] : [0, n - 1]
    return new Set(indexes.filter(i => i >= 0))
  }
  const keysOf = line => line.length <= 60 ? [exactKey(line), digitlessKey(line)] : [exactKey(line)]

  const counts = new Map()
  for (const p of pages) {
    const keys = new Set([...edgeIndexes(p)].flatMap(i => keysOf(p.lines[i])))
    for (const k of keys) counts.set(k, (counts.get(k) || 0) + 1)
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5))

  return pages.map(p => {
    const edges = edgeIndexes(p)
    return {
      ...p,
      lines: p.lines.filter((line, i) => {
        if (!edges.has(i)) return true
        if (PAGE_NUMBER.test(digitlessKey(line))) return false
        return !keysOf(line).some(k => counts.get(k) >= threshold)
      })
    }
  })
}

// Joins lines into running text, repairing words hyphenated across line breaks.
export function joinLines(lines) {
  let text = ''
  for (const line of lines) {
    if (!text) text = line
    else if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(line)) text = text.slice(0, -1) + line
    else text += ' ' + line
  }
  return text
}
