import { useEffect, useRef, useState } from 'react'
import {
  GlobalWorkerOptions,
  PDFWorker,
  PasswordResponses,
  getDocument,
  type PDFDocumentProxy,
} from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = pdfWorkerUrl

/**
 * One worker for the whole app, created on first use.
 *
 * <p>Every `getDocument` call without an explicit `worker` spawns its own Worker
 * (`pdf.mjs:11409`), and the preview pane calls it again on every refresh — so
 * a user iterating on a template was starting a fresh worker thread per preview.
 *
 * <p>It is deliberately never destroyed. `loadingTask.destroy()` does not
 * terminate a worker it did not create (`pdf.mjs:11553`), and tearing this one
 * down when the last viewer unmounts would mean paying worker startup again the
 * next time one opens. One idle worker for the session is the cheaper trade.
 */
let sharedWorker: PDFWorker | null = null

function getSharedWorker(): PDFWorker {
  sharedWorker ??= new PDFWorker()
  return sharedWorker
}

/**
 * Why a document failed to open, in terms a reader can act on.
 *
 * <p>pdf.js reports these as exception *names* rather than as importable
 * classes — `PasswordException` is not exported from the package root in
 * 4.10.38, so `instanceof` is silently always false. Matching on `name` is the
 * only correct check.
 */
export type PdfErrorKind = 'password' | 'corrupt' | 'network' | 'unknown'

export interface PdfError {
  kind: PdfErrorKind
  /** Short, human sentence. Never the raw pdf.js message. */
  message: string
}

export interface PdfDocumentInfo {
  /** Raw metadata dictionary from the PDF's info dictionary. */
  info: Record<string, unknown>
  /** Size of the file in bytes. */
  byteLength: number
}

export interface UsePdfDocumentResult {
  pdf: PDFDocumentProxy | null
  numPages: number
  meta: PdfDocumentInfo | null
  loading: boolean
  error: PdfError | null
  /** Re-fetch and re-parse. Used by the error state's "Try again". */
  reload: () => void
}

function classify(e: unknown): PdfError {
  const name = (e as { name?: string })?.name
  const code = (e as { code?: number })?.code

  if (name === 'PasswordException') {
    return {
      kind: 'password',
      message: code === PasswordResponses.INCORRECT_PASSWORD
        ? 'That password did not open this document.'
        : 'This document is password-protected.',
    }
  }
  if (name === 'InvalidPDFException') {
    return { kind: 'corrupt', message: 'This file is not a valid PDF, or it is damaged.' }
  }
  if (name === 'MissingPDFException' || name === 'UnexpectedResponseException') {
    return { kind: 'network', message: 'The document could not be downloaded.' }
  }
  if (e instanceof TypeError) {
    // fetch() rejects with a TypeError for network-layer failures.
    return { kind: 'network', message: 'The document could not be downloaded.' }
  }
  return { kind: 'unknown', message: 'This document could not be opened.' }
}

/**
 * Load a PDF from a blob URL, with its metadata, and tear it down on unmount.
 *
 * <p>Keeps the whole async lifecycle — fetch, parse, metadata, destroy, and the
 * cancellation flag that stops a superseded load from publishing its result — in
 * one place, so the viewer component deals only in rendered state.
 */
export function usePdfDocument(blobUrl: string): UsePdfDocumentResult {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [numPages, setNumPages] = useState(0)
  const [meta, setMeta] = useState<PdfDocumentInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PdfError | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Reset synchronously on a new URL rather than in the effect, so a render
  // between the prop change and the effect never shows the previous document's
  // page count against the new document.
  const lastUrl = useRef(blobUrl)
  if (lastUrl.current !== blobUrl) {
    lastUrl.current = blobUrl
    if (pdf !== null) setPdf(null)
    if (numPages !== 0) setNumPages(0)
    if (meta !== null) setMeta(null)
    if (!loading) setLoading(true)
    if (error !== null) setError(null)
  }

  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const buffer = await fetch(blobUrl).then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`)
          return r.arrayBuffer()
        })
        if (cancelled) return

        // Read the size BEFORE getDocument: pdf.js transfers the ArrayBuffer to
        // the worker (`pdf.mjs:11459`), which detaches it and leaves byteLength
        // permanently 0.
        const byteLength = buffer.byteLength

        const task = getDocument({ data: buffer, worker: getSharedWorker() })
        const doc = await task.promise
        if (cancelled) {
          void doc.destroy()
          return
        }
        loaded = doc
        setPdf(doc)
        setNumPages(doc.numPages)

        let info: Record<string, unknown> = {}
        try {
          const { info: raw } = await doc.getMetadata()
          if (raw && typeof raw === 'object') info = { ...(raw as Record<string, unknown>) }
        } catch {
          // Metadata is a nicety; a document with an unreadable info dictionary
          // still renders perfectly well.
        }
        if (!cancelled) setMeta({ info, byteLength })
      } catch (e) {
        if (!cancelled) setError(classify(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
      // Destroying the document aborts any render still in flight against it,
      // which is why tiles must treat a rejected render as ordinary.
      if (loaded) void loaded.destroy()
    }
  }, [blobUrl, attempt])

  return {
    pdf,
    numPages,
    meta,
    loading,
    error,
    reload: () => setAttempt((n) => n + 1),
  }
}
