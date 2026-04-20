import { useCallback, useEffect, useRef, useState } from 'react'

import { measureLayout, type ElementMeasurement } from './api'
import { pixelParityEnabled } from './features'

/**
 * Client-side cache + debounced fetch for the backend measurement endpoint.
 *
 * Phase 1.5 consumer: the canvas uses these measurements to absolute-position
 * each text line (`RichTextAbsoluteLines`), replaying iText's line breaks
 * instead of letting CSS flow decide. Phase 1 (already shipped) consumer: the
 * overflow soft-assist on save, which only reads `measuredHeight`.
 *
 * Debounce: 250ms after the last `requestMeasurement` call. Multiple rapid
 * calls coalesce into one network round-trip. The `elementIds` hint is passed
 * through so a single-element edit only remeasures that element — the rest
 * of the cache stays warm.
 *
 * Flag-off: hook returns empty measurements and never hits the network. The
 * legacy CSS-flow preview path continues working untouched.
 */

export interface MeasurementState {
  /** Map of elementId → latest measurement. Entries missing when not yet measured. */
  byId: Record<string, ElementMeasurement>
  /** True while a fetch is in flight. Callers can show a subtle spinner if desired. */
  isLoading: boolean
  /** Last error, if any. Non-fatal — callers fall back to CSS flow. */
  error: unknown
  /**
   * Enqueue a measurement fetch, debounced 250ms. When `elementIds` is
   * provided, the request only measures that subset; other cache entries
   * are preserved. Omit `elementIds` to remeasure everything.
   */
  requestMeasurement: (
    layout: Record<string, unknown>,
    data: Record<string, unknown>,
    elementIds?: string[],
  ) => void
  /** Drop every cached measurement (e.g. when layout loads from scratch). */
  reset: () => void
}

const DEBOUNCE_MS = 250

export function useLayoutMeasurement(): MeasurementState {
  const [byId, setById] = useState<Record<string, ElementMeasurement>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inflightRef = useRef<AbortController | null>(null)
  const pendingRef = useRef<
    { layout: Record<string, unknown>; data: Record<string, unknown>; elementIds?: string[] } | null
  >(null)

  const flush = useCallback(async () => {
    const pending = pendingRef.current
    if (!pending) return
    pendingRef.current = null
    // Abort any in-flight call — the newer request supersedes it.
    inflightRef.current?.abort()
    const ac = new AbortController()
    inflightRef.current = ac
    setIsLoading(true)
    setError(null)
    try {
      const resp = await measureLayout(pending.layout, pending.data, pending.elementIds)
      if (ac.signal.aborted) return
      setById((prev) => {
        // Merge so a subset fetch doesn't wipe un-touched ids.
        if (!pending.elementIds || pending.elementIds.length === 0) return resp.measurements
        return { ...prev, ...resp.measurements }
      })
    } catch (e) {
      if (ac.signal.aborted) return
      setError(e)
    } finally {
      if (!ac.signal.aborted) setIsLoading(false)
    }
  }, [])

  const requestMeasurement = useCallback(
    (layout: Record<string, unknown>, data: Record<string, unknown>, elementIds?: string[]) => {
      if (!pixelParityEnabled()) return
      pendingRef.current = { layout, data, elementIds }
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => {
        void flush()
      }, DEBOUNCE_MS)
    },
    [flush],
  )

  const reset = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    inflightRef.current?.abort()
    pendingRef.current = null
    setById({})
    setError(null)
    setIsLoading(false)
  }, [])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      inflightRef.current?.abort()
    },
    [],
  )

  return { byId, isLoading, error, requestMeasurement, reset }
}
