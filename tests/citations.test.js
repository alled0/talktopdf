import { test } from 'node:test'
import assert from 'node:assert/strict'
import { citedNumbers, expandCitation, linkCitations, stripCitations } from '../src/lib/citations.js'

test('expands lists and ranges', () => {
  assert.deepEqual(expandCitation('1, 3'), [1, 3])
  assert.deepEqual(expandCitation('2-4'), [2, 3, 4])
  assert.deepEqual(expandCitation('2–3'), [2, 3])
})

test('collects cited numbers in order of appearance and ignores out-of-range ones', () => {
  assert.deepEqual(citedNumbers('A [3] and B [1][3], C [2-4], D [9]', 4), [3, 1, 2, 4])
})

test('ignores markdown links and code', () => {
  assert.deepEqual(citedNumbers('[see docs](http://x) and `arr[1]` and [2]', 5), [2])
})

test('turns citations into anchor links', () => {
  assert.equal(linkCitations('Leave is 27 days [1][2].', 3), 'Leave is 27 days [1](#cite-1)[2](#cite-2).')
  assert.equal(linkCitations('Range [1-2] and bad [7]', 3), 'Range [1](#cite-1)[2](#cite-2) and bad [7]')
  assert.equal(linkCitations('```\nx[1]\n``` [1]', 1), '```\nx[1]\n``` [1](#cite-1)')
})

test('strips citations for plain-text copies', () => {
  assert.equal(stripCitations('Leave is 27 days [1][2]. Revenue grew [3, 4].'), 'Leave is 27 days. Revenue grew.')
})

test('accepts the 【n】 citation style some models use', () => {
  assert.deepEqual(citedNumbers('Leave is 27 days【1†source】 and meals €55【2】.', 3), [1, 2])
  assert.equal(linkCitations('Leave【1†L3-L5】.', 2), 'Leave[1](#cite-1).')
})
