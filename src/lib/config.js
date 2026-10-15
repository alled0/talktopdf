// Shared by the browser app and the /api/chat serverless function.

export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'

// Output budgets, in tokens (gpt-oss models count their short reasoning here too).
export const ANSWER_MAX_TOKENS = 1500
export const FAST_MAX_TOKENS = 600

// Fair-use guard for the shared free tier, per IP per UTC day. The real ceiling is the
// provider's account-wide daily quota; this only stops one visitor from using it all.
// Override on the server with DAILY_QUESTIONS_PER_IP (0 = no per-person limit).
export const DAILY_QUESTIONS_PER_IP = 25
export const DAILY_HELPER_CALLS_PER_IP = 100 // query rewrites + starter questions
export const SHOW_REMAINING_BELOW = 5 // only show the counter when a visitor is nearly out

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
