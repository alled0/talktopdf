// Detects questions about a document as a whole, which need coverage rather than a few top hits.
const BROAD_PATTERNS = [
  /\b(summar(y|ise|ize|ies|izing|ising)|overview|tl;?dr|gist|recap)\b/i,
  /\bmain (point|idea|argument|theme|topic|message|takeaway)s?\b/i,
  /\bkey (point|idea|takeaway|finding|theme)s?\b/i,
  /\bwhat('s| is| are)( this| these| the)? (document|doc|file|paper|pdf|report|book|article)s? about\b/i,
  /\b(outline|structure) of\b/i,
  /ملخص|لخص|تلخيص|خلاصة|الفكرة الرئيسية|الأفكار الرئيسية|النقاط الرئيسية|عن ماذا يتحدث|ماذا يتناول/
]

export const isBroadQuestion = text => BROAD_PATTERNS.some(re => re.test(text))
