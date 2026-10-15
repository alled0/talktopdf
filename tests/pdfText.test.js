import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemsToLines, joinLines, stripRepeatedLines } from '../src/lib/pdfText.js'

const item = (str, x, y, { width = str.length * 5, height = 10, hasEOL = false, dir = 'ltr' } = {}) =>
  ({ str, transform: [height, 0, 0, height, x, y], width, height, hasEOL, dir })

test('rebuilds lines and only adds spaces at gaps', () => {
  const lines = itemsToLines([
    item('Hel', 0, 700), item('lo', 15, 700), item('world', 30, 700, { hasEOL: true }),
    item('Second', 0, 686), item('line', 40, 686)
  ])
  assert.deepEqual(lines, ['Hello world', 'Second line'])
})

test('starts a new line when the baseline moves', () => {
  assert.deepEqual(itemsToLines([item('Top', 0, 700), item('Bottom', 0, 650)]), ['Top', 'Bottom'])
})

test('joins hyphenated words across lines', () => {
  assert.equal(joinLines(['The infor-', 'mation is here', 'Next']), 'The information is here Next')
  assert.equal(joinLines(['Well-', 'Known']), 'Well- Known')
})

test('removes running headers, footers and page numbers', () => {
  const pages = Array.from({ length: 6 }, (_, i) => ({
    page: i + 1,
    lines: ['ACME Annual Report 2023', `Body text unique to page ${i + 1}`, 'More body', `Page ${i + 1} of 6`]
  }))
  for (const p of stripRepeatedLines(pages)) {
    assert.deepEqual(p.lines, [`Body text unique to page ${p.page}`, 'More body'])
  }
})

test('keeps short documents untouched', () => {
  const pages = [{ page: 1, lines: ['Title', 'Body'] }]
  assert.deepEqual(stripRepeatedLines(pages), pages)
})

test('reads right-to-left lines stored in visual order', () => {
  // "سياسة الإجازات" as positioned presentation-form glyphs, left to right on the page.
  const glyphs = ['ﺕ', 'ا', 'ز', 'ﺎ', 'ﺟ', 'الإ', ' ', 'ﺔ', 'ﺳ', 'ﺎ', 'ﻴ', 'ﺳ']
  let x = 0
  const items = glyphs.map(str => {
    const it = item(str, x, 700, { width: 8, dir: str === ' ' ? 'ltr' : 'rtl' })
    x += 8
    return it
  })
  assert.deepEqual(itemsToLines(items), ['سياسة الإجازات'])
})

test('keeps Latin words and numbers readable inside right-to-left lines', () => {
  // "التقرير السنوي لشركة Northwind 2023" laid out right to left; items listed left to right.
  const words = ['Northwind', ' ', '2023', ' ', 'لشركة', ' ', 'السنوي', ' ', 'التقرير']
  let x = 0
  const items = words.map(str => {
    const width = str === ' ' ? 4 : str.length * 5
    const it = item(str, x, 700, { width, dir: /[a-z0-9 ]/i.test(str) ? 'ltr' : 'rtl' })
    x += width
    return it
  })
  assert.deepEqual(itemsToLines(items), ['التقرير السنوي لشركة Northwind 2023'])
})

test('attaches isolated Arabic marks to their letter', () => {
  const items = [item('ﹰ', 0, 700, { width: 4, dir: 'rtl' }), item('ﻳﻮﻣﺎ', 4, 700, { width: 20, dir: 'rtl' })]
  assert.deepEqual(itemsToLines(items), ['يوماً'])
})
