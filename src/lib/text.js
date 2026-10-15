// Language-aware text normalization and tokenization for keyword search.
// Works for any script; adds light handling for English, Arabic and CJK.

const LATIN_MARKS = /[\u0300-\u036f]/g
const ARABIC_MARKS = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06ED\u0640]/g // tashkeel + tatweel
const TOKEN_SPLIT = /[^\p{L}\p{M}\p{N}]+/u
const CJK_RUN = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+|[^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+/gu
const CJK_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u

export function normalizeText(text) {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .normalize('NFD').replace(LATIN_MARKS, '').normalize('NFC')
    .replace(ARABIC_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
}

const STOPWORDS_EN = `a about above after again against all also am an and any are as at be because been before being
below between both but by can could did do does doing down during each few for from further had has have having
he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not
now of off on once only or other our ours ourselves out over own same she should so some such than that the their
theirs them themselves then there these they this those through to too under until up very was we were what when
where which while who whom why will with would you your yours yourself yourselves per via etc`

const STOPWORDS_AR = `في من على إلى الى عن أن ان إن لا ما ماذا لم لن هذا هذه ذلك تلك هو هي هم هن أنا نحن أنت انت كان كانت
يكون التي الذي الذين اللذين التى قد مع عند بين كل أو او ثم حتى إذا اذا لكن بل غير بعد قبل حول ضد منذ أي اي كما لقد هل
ف و ب ل ك عليه عليها فيه فيها منه منها له لها لهم به بها ايضا أيضا`

const STOPWORDS = new Set(
  `${STOPWORDS_EN} ${STOPWORDS_AR}`.split(/\s+/).filter(Boolean).map(normalizeText)
)

function stemEnglish(w) {
  if (w.length <= 3) return w
  if (w.endsWith('ies') && w.length > 4) return w.slice(0, -3) + 'y'
  if (w.endsWith('sses')) return w.slice(0, -2)
  if (w.endsWith('ss') || w.endsWith('us') || w.endsWith('is')) return w
  if (w.endsWith('s')) return w.slice(0, -1)
  return w
}

const AR_PREFIXES = ['وال', 'بال', 'كال', 'فال', 'لل', 'ال']
const AR_SUFFIXES = ['ها', 'ان', 'ات', 'ون', 'ين', 'يه', 'ه', 'ي']

// Light10-style stemmer: strips one article prefix and one suffix.
function stemArabic(w) {
  for (const p of AR_PREFIXES) {
    if (w.startsWith(p) && w.length - p.length >= 3) { w = w.slice(p.length); break }
  }
  for (const s of AR_SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) { w = w.slice(0, -s.length); break }
  }
  return w
}

function stem(token) {
  if (/^[a-z]+$/.test(token)) return stemEnglish(token)
  if (/^[\u0621-\u064A]+$/.test(token)) return stemArabic(token)
  return token
}

export function tokenize(text) {
  const tokens = []
  for (const word of normalizeText(text).split(TOKEN_SPLIT)) {
    if (!word) continue
    for (const run of word.match(CJK_RUN)) {
      if (CJK_CHAR.test(run)) {
        // CJK has no spaces between words: index character bigrams.
        if (run.length === 1) tokens.push(run)
        for (let i = 0; i < run.length - 1; i++) tokens.push(run.slice(i, i + 2))
      } else {
        if (run.length < 2 && !/\p{N}/u.test(run)) continue
        if (STOPWORDS.has(run)) continue
        tokens.push(stem(run))
      }
    }
  }
  return tokens
}

// Rough LLM token estimate: ~4 chars/token for ASCII, ~2 for other scripts.
export function estimateTokens(text) {
  let ascii = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++
    else other++
  }
  return Math.ceil(ascii / 4 + other / 2)
}
