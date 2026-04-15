import { useEffect, useId, useState } from 'react'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'

const MAX_FILE_BYTES = 4 * 1024 * 1024

type TabId = 'upload' | 'url'

/** Load an image src and resolve its natural dimensions. */
function loadImageDimensions(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ width: 0, height: 0 })
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
  onAdd: (src: string, naturalWidth: number, naturalHeight: number) => void
}) {
  const baseId = useId()

  const [tab, setTab] = useState<TabId>('upload')
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
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
        loadImageDimensions(result).then(setImgDims)
      }
    }
    reader.onerror = () => setFileError('Could not read the file.')
    reader.readAsDataURL(f)
  }

  const canAdd = tab === 'upload' ? Boolean(dataUrl?.trim()) : Boolean(url.trim())

  const submit = async () => {
    if (!canAdd || submitting) return
    const src = tab === 'upload' ? (dataUrl ?? '').trim() : url.trim()
    if (!src) return
    setSubmitting(true)
    let dims = imgDims
    if (!dims || dims.width === 0) {
      dims = await loadImageDimensions(src)
    }
    onAdd(src, dims.width, dims.height)
    setSubmitting(false)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add image"
      description="Upload a file or paste an image URL."
      size="md"
    >
      {/* Tabs */}
      <div className="mb-4 flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800">
        {(['upload', 'url'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                : 'text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200'
            }`}
          >
            {t === 'upload' ? 'Upload file' : 'From URL'}
          </button>
        ))}
      </div>

      {tab === 'upload' ? (
        <div className="flex flex-col gap-3">
          <label className="flex cursor-pointer flex-col gap-2" htmlFor={`${baseId}-file-input`}>
            <span className="text-xs font-medium text-zinc-600 dark:text-zinc-300">Choose file</span>
            <input
              id={`${baseId}-file-input`}
              name={`${baseId}-file-input`}
              type="file"
              accept="image/*"
              className="block w-full text-xs text-zinc-600 file:mr-2 file:rounded-md file:border-0 file:bg-violet-100 file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-violet-900 hover:file:bg-violet-200 dark:text-zinc-400 dark:file:bg-violet-950/60 dark:file:text-violet-100 dark:hover:file:bg-violet-900/50"
              onChange={onFileChange}
            />
          </label>
          {fileError && <p className="flex items-center gap-1 text-xs text-red-600 dark:text-red-400">
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            {fileError}
          </p>}
          {dataUrl ? (
            <div className="flex items-start gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
              <img src={dataUrl} alt="" className="h-16 w-16 shrink-0 rounded-md object-cover" />
              <div className="min-w-0 text-xs">
                <p className="font-medium text-zinc-800 dark:text-zinc-100">Ready to add</p>
                <p className="truncate text-zinc-500 dark:text-zinc-400">{fileName ?? 'Image'}</p>
                {imgDims && imgDims.width > 0 && (
                  <p className="mt-0.5 text-zinc-400 dark:text-zinc-500">{imgDims.width} × {imgDims.height} px</p>
                )}
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 py-8 text-center dark:border-zinc-700">
              <svg className="mb-2 h-8 w-8 text-zinc-300 dark:text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a2.25 2.25 0 002.25-2.25V5.25a2.25 2.25 0 00-2.25-2.25H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
              <p className="text-xs text-zinc-400 dark:text-zinc-500">No file selected</p>
            </div>
          )}
        </div>
      ) : (
        <Input
          label="Image URL"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://example.com/image.png"
        />
      )}

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="sm" disabled={!canAdd} loading={submitting} onClick={() => void submit()}>
          Add image
        </Button>
      </ModalFooter>
    </Modal>
  )
}
