// Shared by the browser app and the /api/chat serverless function.

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

export const ANSWER_MODEL = 'llama-3.3-70b-versatile'
export const FAST_MODEL = 'llama-3.1-8b-instant'
export const ANSWER_MAX_TOKENS = 1200

// Free tier served through the proxy (per IP, per UTC day).
export const FREE_DAILY_ANSWERS = 10
export const FREE_DAILY_AUX = 40 // query rewrites + starter questions

// Context budgets, in characters.
export const RETRIEVAL_CHAR_BUDGET = 9000 // excerpts sent for a normal question
export const FULL_DOC_CHAR_LIMIT = 14000 // below this, send the whole library instead of searching
export const MAX_SOURCES_CHARS = 16000 // hard cap enforced by the proxy
export const MAX_QUESTION_CHARS = 2000
export const MAX_HISTORY_MESSAGES = 6
export const MAX_HISTORY_CHARS = 2000 // per message

// In-browser semantic search.
export const EMBED_MODEL = 'Xenova/multilingual-e5-small'
export const EMBED_MODEL_SIZE_MB = 135
