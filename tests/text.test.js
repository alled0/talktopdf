import { test } from 'node:test'
import assert from 'node:assert/strict'
import { estimateTokens, normalizeText, tokenize } from '../src/lib/text.js'

test('keeps non-Latin scripts searchable', () => {
  assert.deepEqual(tokenize('إيرادات الشركة'), ['ايراد', 'شرك'])
  assert.ok(tokenize('Привет мир').includes('привет'))
})

test('normalizes Arabic letter variants and diacritics', () => {
  assert.equal(normalizeText('أَحْمَد إلى مدرسة'), 'احمد الي مدرسه')
})

test('strips Latin accents and lowercases', () => {
  assert.deepEqual(tokenize('Café RÉSUMÉ'), ['cafe', 'resume'])
})

test('drops English and Arabic stopwords', () => {
  assert.deepEqual(tokenize('What is the revenue of the company'), ['revenue', 'company'])
  assert.deepEqual(tokenize('ما هي إيرادات'), ['ايراد'])
})

test('light English stemming matches plurals', () => {
  assert.deepEqual(tokenize('companies earnings policy'), ['company', 'earning', 'policy'])
  assert.deepEqual(tokenize('analysis status'), ['analysis', 'status'])
})

test('Arabic article prefixes are stripped for matching', () => {
  assert.equal(tokenize('الطلاب')[0], tokenize('طلاب')[0])
  assert.equal(tokenize('للطلاب')[0], tokenize('طلاب')[0])
})

test('indexes CJK text as character bigrams', () => {
  assert.deepEqual(tokenize('東京都'), ['東京', '京都'])
})

test('keeps numbers, including single digits', () => {
  assert.deepEqual(tokenize('Q3 2023 chapter 5'), ['q3', '2023', 'chapter', '5'])
})

test('estimates more tokens per character for non-ASCII text', () => {
  assert.equal(estimateTokens('abcd'.repeat(10)), 10)
  assert.equal(estimateTokens('مرحبا'), 3)
})
