// Shared browser-side helpers for the sidepanel. (May touch DOM/chrome.)

/**
 * Trigger a browser download of `content` as a Blob of the given mime type.
 * Extracted from the 3 inline copies that used to live in App.tsx
 * (highlights MD, glossary JSON, sentences JSON).
 */
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Read a File's text and parse it with the injected `parse` callback. The two
 * import sites (glossary, sentences) have different parse/validation logic, so
 * parse is injected; this helper just centralizes the file.text() boilerplate.
 */
export async function readJsonFile<T>(file: File, parse: (text: string) => T): Promise<T> {
  const text = await file.text()
  return parse(text)
}
