import { useCallback, useEffect, useState } from 'react'
import { fetchOrgEntitlements, type OrgEntitlementsDto } from '../lib/api'
import { useAuthStore } from '../stores/authStore'

/**
 * The workspace's resolved limits.
 *
 * Fetched from the server rather than derived from the plan, because
 * grandfathered free workspaces are exempt from the caps and the browser has no
 * way to know that. Returns null while loading — callers should treat null as
 * "no limit known" and show nothing, so a slow request never produces a
 * spurious upgrade prompt.
 */
export function useEntitlements() {
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const [data, setData] = useState<OrgEntitlementsDto | null>(null)

  const refresh = useCallback(async () => {
    if (!orgId) {
      setData(null)
      return
    }
    try {
      setData(await fetchOrgEntitlements(orgId))
    } catch {
      // Non-fatal: without this the UI simply shows no limit, and the server
      // still enforces it with a 402.
      setData(null)
    }
  }, [orgId])

  useEffect(() => { void refresh() }, [refresh])

  const atTemplateLimit =
    data != null &&
    data.freeRestricted &&
    data.maxTemplates > 0 &&
    data.templateCount >= data.maxTemplates

  return { entitlements: data, atTemplateLimit, refresh }
}
