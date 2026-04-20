import { createContext, useContext } from 'react'

import type { ElementMeasurement } from '../../lib/api'

/**
 * React context for Phase 1.5's layout measurements. The editor canvas
 * provides the {@link useLayoutMeasurement} store's `byId` map at the top
 * level; every nested element preview reads the measurement for its own id
 * and switches to absolute-positioned line rendering when it's present.
 *
 * Consumers outside the editor canvas (e.g. preview-only viewers that don't
 * drive the measurement hook) read the default empty object — they continue
 * to use the CSS-flow renderer.
 */
const MeasurementContext = createContext<Record<string, ElementMeasurement>>({})

export const MeasurementProvider = MeasurementContext.Provider

export function useElementMeasurement(id: string | undefined): ElementMeasurement | undefined {
  const byId = useContext(MeasurementContext)
  if (!id) return undefined
  return byId[id]
}
