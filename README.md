# TalkToPDF

Chat with your PDFs and get answers that cite the exact page they came from. Parsing, indexing and
search all run **in your browser**. Your files never leave your device. The only data sent anywhere
is your question and the few passages needed to answer it.

- **Hybrid search.** BM25 keyword search plus multilingual semantic embeddings, fused with
  Reciprocal Rank Fusion. Finds "how many days off do I get?" in a passage that only says
  "27 days of paid annual leave".
- **Clickable citations.** Every `[n]` in an answer opens the exact passage and page the model saw,
  with your search terms highlighted.
- **Multilingual, including Arabic.** Right-to-left PDF text is reconstructed correctly, and you can
  ask in Arabic about an English document (or the other way round).
- **Handles real documents.** Removes running headers, footers and page numbers, repairs hyphenation,
  splits text into sentence-aligned chunks that know their pages, and warns about scanned pages.
- **Smart context.**
  - Short files are sent whole.
  - Summary-type questions get passages sampled from across the document (k-means over embeddings).
  - Follow-up questions are rewritten into standalone searches.
- **Feels like a product.** Streaming answers with a stop button, retry, starter questions generated
  from your files, drag and drop anywhere, and a library and chat that survive a reload (IndexedDB).
  Works on mobile.
- **Free tier without a key.** A Vercel function proxies to Groq with a server-side per-IP daily
  quota. Users can add their own free Groq key for unlimited questions.

## How it works

```mermaid
flowchart LR
  subgraph Browser
    A["PDF / TXT / MD"] --> B["pdf.js text + layout cleanup"]
    B --> C["Sentence-aligned chunks<br/>with page ranges"]
    C --> D["BM25 index"]
    C --> E["multilingual-e5-small<br/>(Web Worker)"]
    E --> F[("IndexedDB")]
    D --> F
    Q["Question"] --> R["Rewrite follow-ups,<br/>broad or specific?"]
    R --> S{"Retrieve"}
    D --> S
    E --> S
    S -->|"RRF + MMR"| X["Numbered excerpts"]
  end
  X --> P["api/chat:<br/>quota + prompt"]
  P --> G["Groq · Llama 3.3 70B"]
  G -->|"streamed answer with citations"| UI["Chat UI"]
```

| Step | What happens | Code |
|---|---|---|
| Extract | pdf.js glyphs are rebuilt into lines (right to left where needed). Headers, footers and page numbers are removed. | [`pdfText.js`](src/lib/pdfText.js) |
| Chunk | About 200-word chunks on sentence boundaries, overlapping by about 35 words, each with a page range | [`chunker.js`](src/lib/chunker.js) |
| Keyword index | Incremental Okapi BM25. The tokenizer handles Arabic normalization, light stemming, stopwords and CJK bigrams. | [`bm25.js`](src/lib/bm25.js), [`text.js`](src/lib/text.js) |
| Semantic index | `Xenova/multilingual-e5-small` (q8, about 135 MB, downloaded once) in a Web Worker | [`embed.worker.js`](src/workers/embed.worker.js) |
| Retrieve | RRF fusion, then a relevance cutoff, then MMR diversity, then neighbor expansion. Whole-document mode for short files. Coverage sampling for broad questions. | [`retrieval.js`](src/lib/retrieval.js) |
| Answer | The same prompt builder serves the proxy and the own-key path, and answers stream over SSE | [`prompts.js`](src/lib/prompts.js), [`llm.js`](src/lib/llm.js), [`api/chat.js`](api/chat.js) |

## Retrieval benchmark

`npm run eval` runs the app's real extraction, chunking and retrieval code over a 12-page
handbook plus a 28-page distractor document. It asks 28 questions, most phrased differently from
the source text and three asked in Arabic about the English handbook. A hit means that the passage
containing the answer is among the excerpts sent to the model.

| Method | Recall@1 | Recall@3 | Recall@6 | MRR | English (25) | Arabic → English (3) |
|---|---|---|---|---|---|---|
| Original TF-IDF (before this upgrade) | 68% | 79% | 86% | 0.75 | 24/25 | 0/3 |
| BM25 only | 71% | 86% | 93% | 0.79 | 25/25 | 1/3 |
| Semantic only | 82% | 89% | 89% | 0.85 | 23/25 | 2/3 |
| **Hybrid (shipped)** | 75% | **93%** | **96%** | 0.84 | **25/25** | 2/3 |

The hybrid gives the best recall, which matters most because the model reads all the excerpts.
Semantic-only search ranks the right passage first more often but misses keyword-heavy questions.
The benchmark is small and synthetic, so treat it as a regression check, not a leaderboard.

## Getting started

```bash
npm install
cp .env.example .env      # add GROQ_API_KEY for the free tier (get one at console.groq.com/keys)
npm run dev               # serves the app and /api/chat locally
```

Without a server key you can still use the app by pasting your own Groq key in **Settings**.

| Script | |
|---|---|
| `npm run dev` | Vite dev server, including the `/api/chat` function |
| `npm test` | Unit tests (`node --test`, no extra dependencies) |
| `npm run lint` | ESLint, including the React Hooks rules |
| `npm run eval` | Retrieval benchmark (downloads the embedding model on the first run) |
| `npm run build` | Production build |

## Deploying to Vercel

1. Import the repository. The framework preset is Vite.
2. Set `GROQ_API_KEY`.
3. Optional: add an Upstash Redis or Vercel KV store and set `UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN` (or the `KV_REST_API_*` variables). This makes the per-IP daily limit
   persistent. Without it, the limit is kept in memory per server instance.

The free tier allows 10 answers and 40 helper calls (query rewrites, starter questions) per IP per
day. You can change these in [`src/lib/config.js`](src/lib/config.js). The proxy fixes the model,
builds the prompt itself and caps the payload size, so it can't be used as a general LLM relay.

## Privacy

- Files are read, chunked and embedded locally. They are never uploaded.
- The library (text, search index, embeddings) and the conversation are stored in the browser's
  IndexedDB. **Settings → Privacy** deletes all of it.
- Each question sends the question, recent chat turns and the selected excerpts to Groq, either
  directly with your key or through the proxy.
- A Groq key you add is stored in `localStorage` in your browser and sent only to Groq.

## Limitations

- Scanned PDFs have no text layer and are rejected. OCR isn't supported yet.
- The first use of semantic search downloads about 135 MB (cached afterwards). Until then, and on
  data-saver connections, search falls back to keywords.
- Answers can only be as good as the extracted text. Complex tables and multi-column layouts may
  read imperfectly.

## Built with

React 18, Vite, Tailwind CSS, pdf.js, Transformers.js (ONNX Runtime Web), Groq, and Vercel
Functions.

Built by [@alled0](https://github.com/alled0) ·
[LinkedIn](https://www.linkedin.com/in/alwaleed-meshal-almutairi-8a48ab263/)
