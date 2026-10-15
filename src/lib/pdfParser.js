import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { itemsToLines, joinLines, stripRepeatedLines } from './pdfText.js'
import { extensionOf } from './files.js'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

async function extractPDF(file, onProgress) {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjsLib.getDocument({ data }).promise
  try {
    const raw = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      raw.push({ page: i, lines: itemsToLines(content.items) })
      page.cleanup()
      onProgress?.({ page: i, total: pdf.numPages })
    }

    const pages = stripRepeatedLines(raw)
      .map(p => ({ page: p.page, text: joinLines(p.lines) }))
      .filter(p => p.text)

    if (pages.length === 0) {
      throw new Error('No selectable text found. This looks like a scanned PDF.')
    }
    return { pages, pageCount: pdf.numPages, emptyPages: pdf.numPages - pages.length }
  } finally {
    pdf.destroy()
  }
}

/** Extracts text as pages: [{page, text}]. Plain-text files are a single page with page = null. */
export async function extractFile(file, { onProgress } = {}) {
  const ext = extensionOf(file.name)
  if (ext === 'pdf') return extractPDF(file, onProgress)
  if (ext === 'txt' || ext === 'md') {
    const text = (await file.text()).trim()
    if (!text) throw new Error('The file is empty.')
    return { pages: [{ page: null, text }], pageCount: null, emptyPages: 0 }
  }
  throw new Error(`Unsupported file type: .${ext}`)
}
