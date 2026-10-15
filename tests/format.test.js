import { test } from 'node:test'
import assert from 'node:assert/strict'
import { formatPages, tidyMarkdown } from '../src/lib/format.js'

test('formats page ranges', () => {
  assert.equal(formatPages(4, 4), 'p. 4')
  assert.equal(formatPages(4, 6), 'pp. 4–6')
  assert.equal(formatPages(null, null), null)
})

test('turns HTML line breaks into Markdown that renders', () => {
  assert.equal(tidyMarkdown('| Region | Europe 52%<br>Americas 29% |'), '| Region | Europe 52% · Americas 29% |')
  assert.equal(tidyMarkdown('First line<br/>Second line'), 'First line  \nSecond line')
  assert.equal(tidyMarkdown('No breaks here'), 'No breaks here')
})
