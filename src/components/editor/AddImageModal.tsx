import { useEffect, useId, useState } from 'react'

const MAX_FILE_BYTES = 4 * 1024 * 1024

type TabId = 'upload' | 'url'

/** Load an image src and resolve its natural dimensions. */
function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 }) // fallback handled by caller
    img.src = src
  })
}

export function AddImageModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  /** Called with src + natural pixel dimensions (0×0 if unreadable). */
  onAdd: (src: string, naturalWidth: number, naturalHeight: number) => void
}) {
  const baseId = useId()
  const tabUploadId = `${baseId}-tab-upload`
  const tabUrlId = `${baseId}-tab-url`
  const panelUploadId = `${baseId}-panel-upload`
  const panelUrlId = `${baseId}-panel-url`

  const [tab, setTab] = useState<TabId>('upload')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Natural dimensions of the currently selected image
  const [imgDims, setImgDims] = useState<{ width: number; height: number } | null>(null)

  useEffect(() => {
    if (!open) return
    setTab('upload')
    setDataUrl(null)
    setFileName(null)
    setUrl('')
    setFileError(null)
    setSubmitting(false)
    setImgDims(null)
  }, [open])

  const handleClose = () => {
    onClose()
  }

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFileError(null)
    setDataUrl(null)
    setFileName(null)
    setImgDims(null)
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    if (!f.type.startsWith('image/')) {
      setFileError('Please choose an image file.')
      return
    }
    if (f.size > MAX_FILE_BYTES) {
      setFileError(`File is too large (max ${Math.round(MAX_FILE_BYTES / (1024 * 1024))} MB).`)
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        setDataUrl(result)
        setFileName(f.name)
        setTab('upload')
        // Read natural dimensions
        loadImageDimensions(result).then(setImgDims)
      }
    }
    reader.onerror = () => setFileError('Could not read the file.')
    reader.readAsDataURL(f)
  }

  const canAdd =
    tab === 'upload'
      ? Boolean(dataUrl?.trim())
      : Boolean(url.trim())

  const submit = async () => {
    if (!canAdd || submitting) return
    const src = tab === 'upload' ? (dataUrl ?? '').trim() : url.trim()
    if (!src) return

    setSubmitting(true)
    // For URL tab (or if upload dims weren't read yet), load dimensions now
    let dims = imgDims
    if (!dims || dims.width === 0) {
      dims = await loadImageDimensions(src)
    }
    onAdd(src, dims.width, dims.height)
    setSubmitting(false)
  }

  if (!open) return null

  const tabBtn = (active: boolean) =>
    `border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-violet-600 text-violet-700 dark:border-violet-400 dark:text-violet-300'
        : 'border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
    }`

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${baseId}-title`}
      onClick={handleClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-600 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-zinc-200 px-4 pt-3 dark:border-zinc-700">
          <h2 id={`${baseId}-title`} className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            Add image
          </h2>
          <p className="pb-2 text-xs text-zinc-500 dark:text-zinc-400">
            Upload a file (stored as base64 in the layout) or paste an image URL.
          </p>
          <div className="flex gap-1" role="tablist">
            <button
              type="button"
              role="tab"
              id={tabUploadId}
              aria-selected={tab === 'upload'}
              aria-controls={panelUploadId}
              className={tabBtn(tab === 'upload')}
              onClick={() => setTab('upload')}
            >
              Upload from computer
            </button>
            <button
              type="button"
              role="tab"
              id={tabUrlId}
              aria-selected={tab === 'url'}
              aria-controls={panelUrlId}
              className={tabBtn(tab === 'url')}
              onClick={() => setTab('url')}
            >
              URL
            </button>
          </div>
        </div>

        <div className="px-4 py-4">
          {tab === 'upload' ? (
            <div id={panelUploadId} role="tabpanel" aria-labelledby={tabUploadId} className="flex flex-col gap-3">
              <label
                className="flex cursor-pointer flex-col gap-2"
                htmlFor={`${baseId}-file-input`}
              >
                <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Choose file</span>
                <input
                  id={`${baseId}-file-input`}
                  name={`${baseId}-file-input`}
                  type="file"
                  accept="image/*"
                  className="block w-full text-xs text-zinc-600 file:mr-2 file:rounded file:border-0 file:bg-violet-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-violet-900 hover:file:bg-violet-200 dark:text-zinc-400 dark:file:bg-violet-950/60 dark:file:text-violet-100 dark:hover:file:bg-violet-900/50"
                  onChange={onFileChange}
                />
              </label>
              {fileError ? <p className="text-xs text-red-600 dark:text-red-400">{fileError}</p> : null}
              {dataUrl ? (
                <div className="flex items-start gap-3 rounded border border-zinc-200 p-2 dark:border-zinc-600">
                  <img src={dataUrl} alt="" className="h-16 w-16 shrink-0 rounded object-cover" />
                  <div className="min-w-0 text-xs text-zinc-600 dark:text-zinc-300">
                    <p className="font-medium text-zinc-800 dark:text-zinc-100">Ready to add</p>
                    <p className="truncate">{fileName ?? 'Image'}</p>
                    {imgDims && imgDims.width > 0 && (
                      <p className="text-zinc-500 dark:text-zinc-400">{imgDims.width} × {imgDims.height} px</p>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">No file selected yet.</p>
              )}
            </div>
          ) : (
            <div id={panelUrlId} role="tabpanel" aria-labelledby={tabUrlId} className="flex flex-col gap-2">
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300" htmlFor={`${baseId}-url-input`}>
                Image URL
              </label>
              <input
                id={`${baseId}-url-input`}
                name={`${baseId}-url-input`}
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                className="w-full rounded border border-zinc-300 px-2 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <button
            type="button"
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-200 dark:hover:bg-zinc-800"
            onClick={handleClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canAdd || submitting}
            onClick={submit}
          >
            {submitting ? 'Loading…' : 'Add'}
          </button>
        </div>
      </div>
    </div>
  )
}
