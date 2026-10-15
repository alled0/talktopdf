// Persists the library (document metadata, chunks and their embedding vectors) and the chat in
// IndexedDB, so everything is still there after a reload. Nothing leaves the browser.
// Every function rejects if storage is unavailable; callers treat persistence as best effort.

import { EMBED_MODEL } from './config.js'

const DB_NAME = 'talktopdf'
const DB_VERSION = 1
let dbPromise = null

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'))
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('docs', { keyPath: 'id' })
        db.createObjectStore('chunks', { keyPath: 'id' }).createIndex('docId', 'docId')
        db.createObjectStore('chat', { keyPath: 'id' })
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    dbPromise.catch(() => { dbPromise = null })
  }
  return dbPromise
}

// Runs `work(stores)` in one transaction and resolves with its return value when it commits.
async function transact(storeNames, mode, work) {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode)
    const stores = Object.fromEntries(storeNames.map(name => [name, tx.objectStore(name)]))
    let result
    Promise.resolve(work(stores)).then(value => { result = value }, reject)
    tx.oncomplete = () => resolve(result)
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error)
  })
}

const requestValue = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error)
})

const toRecord = chunk => ({ ...chunk, vecModel: chunk.vec ? EMBED_MODEL : null })

/** @returns {Promise<{doc: object, chunks: object[]}[]>} in the order documents were added */
export async function loadLibrary() {
  const [docs, chunks] = await transact(['docs', 'chunks'], 'readonly', ({ docs, chunks }) =>
    Promise.all([requestValue(docs.getAll()), requestValue(chunks.getAll())])
  )
  const byDoc = new Map(docs.map(d => [d.id, []]))
  for (const record of chunks) {
    const { vecModel, ...chunk } = record
    if (vecModel !== EMBED_MODEL) delete chunk.vec // embeddings from another model are useless
    byDoc.get(chunk.docId)?.push(chunk)
  }
  return docs
    .sort((a, b) => a.addedAt - b.addedAt)
    .map(doc => ({ doc, chunks: byDoc.get(doc.id).sort((a, b) => a.index - b.index) }))
}

export function saveDocument(doc, chunks) {
  return transact(['docs', 'chunks'], 'readwrite', stores => {
    stores.docs.put(doc)
    for (const chunk of chunks) stores.chunks.put(toRecord(chunk))
  })
}

export function saveChunks(chunks) {
  return transact(['chunks'], 'readwrite', ({ chunks: store }) => {
    for (const chunk of chunks) store.put(toRecord(chunk))
  })
}

export function deleteDocument(docId) {
  return transact(['docs', 'chunks'], 'readwrite', async ({ docs, chunks }) => {
    docs.delete(docId)
    const keys = await requestValue(chunks.index('docId').getAllKeys(docId))
    for (const key of keys) chunks.delete(key)
  })
}

export async function loadChat() {
  const record = await transact(['chat'], 'readonly', ({ chat }) => requestValue(chat.get('current')))
  return record?.messages || []
}

export function saveChat(messages) {
  return transact(['chat'], 'readwrite', ({ chat }) => { chat.put({ id: 'current', messages }) })
}

export function clearAll() {
  return transact(['docs', 'chunks', 'chat'], 'readwrite', stores => {
    for (const store of Object.values(stores)) store.clear()
  })
}
