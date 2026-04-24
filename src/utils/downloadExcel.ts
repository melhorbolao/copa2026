/** Saves an Excel blob to disk. Uses File System Access API (folder picker) when
 *  available; falls back to a hidden <a> click otherwise.
 *  Returns 'saved' | 'downloaded' | 'cancelled'.
 */
export async function downloadExcel(
  blob: Blob,
  fileName: string,
): Promise<'saved' | 'downloaded' | 'cancelled'> {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window) {
    try {
      const handle = await (window as Window & typeof globalThis & {
        showSaveFilePicker: (opts: object) => Promise<FileSystemFileHandle>
      }).showSaveFilePicker({
        suggestedName: fileName,
        types: [{
          description: 'Planilha Excel',
          accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'] },
        }],
      })
      const writable = await handle.createWritable()
      await writable.write(blob)
      await writable.close()
      return 'saved'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // Fall through to traditional download on any other error
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  return 'downloaded'
}
