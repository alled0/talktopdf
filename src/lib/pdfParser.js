import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker

async function extractPDF(file) {
  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  const pages = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const text = content.items.map(item => item.str).join(' ').replace(/\s+/g, ' ').trim()
    if (text) pages.push(`[Page ${i}]\n${text}`)
  }

  return pages.join('\n\n')
}

export async function extractFile(file) {
  const ext = file.name.split('.').pop().toLowerCase()
  if (ext === 'pdf') return extractPDF(file)
  if (ext === 'txt' || ext === 'md') return file.text()
  throw new Error(`Unsupported file type: .${ext}`)
}
