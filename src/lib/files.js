export const SUPPORTED_EXTENSIONS = ['pdf', 'txt', 'md']

export const ACCEPT_ATTRIBUTE = SUPPORTED_EXTENSIONS.map(ext => `.${ext}`).join(',')

export const extensionOf = name => name.split('.').pop().toLowerCase()

export function filterSupported(fileList) {
  return Array.from(fileList || []).filter(f => SUPPORTED_EXTENSIONS.includes(extensionOf(f.name)))
}
