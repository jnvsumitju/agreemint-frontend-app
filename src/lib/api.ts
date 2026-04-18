import { useAuthStore } from '../stores/authStore'

export const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

/**
 * Singleton guard — prevents concurrent refresh attempts from racing.
 */
let refreshPromise: Promise<boolean> | null = null

/**
 * Authenticated fetch wrapper. Attaches Bearer token + org context.
 * On 401, attempts one token refresh and retries. Uses singleton guard
 * to prevent concurrent refresh races.
 */
export async function authFetch(url: string, init?: RequestInit): Promise<Response> {
  const fullUrl = url.startsWith('http') ? url : `${API_BASE}${url}`
  const store = useAuthStore.getState()
  const headers = new Headers(init?.headers)
  if (store.accessToken) headers.set('Authorization', `Bearer ${store.accessToken}`)
  if (store.org?.id) headers.set('X-Org-Id', store.org.id)

  let res = await fetch(fullUrl, { ...init, headers })

  if (res.status === 401 && store.refreshToken) {
    // Use singleton promise to prevent concurrent refresh calls
    if (!refreshPromise) {
      refreshPromise = store.refreshTokens().finally(() => { refreshPromise = null })
    }
    const ok = await refreshPromise

    if (ok) {
      const retryHeaders = new Headers(init?.headers)
      retryHeaders.set('Authorization', `Bearer ${useAuthStore.getState().accessToken}`)
      if (useAuthStore.getState().org?.id) retryHeaders.set('X-Org-Id', useAuthStore.getState().org!.id)
      res = await fetch(fullUrl, { ...init, headers: retryHeaders })
    }

    // If still 401 after refresh attempt, log out
    if (res.status === 401) {
      store.logout()
      sessionStorage.setItem('redirectAfterLogin', window.location.pathname)
      window.location.replace('/login')
    }
  }

  return res
}

async function parseJson<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg || res.statusText)
  }
  if (!text) return {} as T
  return JSON.parse(text) as T
}

export interface TemplateDto {
  id: string
  name: string
  createdBy: string | null
  createdAt: string
  productId: string | null
  productName: string | null
}

/** An org's product catalog entry (see Settings → Products). */
export interface ProductDto {
  id: string
  orgId: string
  name: string
  description: string | null
  createdBy: string | null
  createdAt: string
  updatedAt: string
}

export async function fetchProducts(orgId: string): Promise<ProductDto[]> {
  const res = await authFetch(`${API_BASE}/api/orgs/${orgId}/products`)
  return parseJson<ProductDto[]>(res)
}

/** Per-product metrics rendered on the Products page. All counts are
 *  org-scoped and computed live server-side (no caching yet). */
export interface ProductMetricsDto {
  id: string
  name: string
  description: string | null
  templateCount: number
  documentCount: number
  uiDocumentCount: number
  apiDocumentCount: number
  lastDocumentAt: string | null
  createdAt: string
}

export async function fetchProductMetrics(orgId: string): Promise<ProductMetricsDto[]> {
  const res = await authFetch(`${API_BASE}/api/orgs/${orgId}/products/metrics`)
  return parseJson<ProductMetricsDto[]>(res)
}

export async function createProduct(
  orgId: string,
  name: string,
  description?: string,
): Promise<ProductDto> {
  const res = await authFetch(`${API_BASE}/api/orgs/${orgId}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, description: description ?? null }),
  })
  return parseJson<ProductDto>(res)
}

export async function updateProduct(
  orgId: string,
  productId: string,
  patch: { name?: string; description?: string | null },
): Promise<ProductDto> {
  const res = await authFetch(`${API_BASE}/api/orgs/${orgId}/products/${productId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  return parseJson<ProductDto>(res)
}

export interface TemplateVersionDto {
  id: string
  templateId: string
  versionNumber: number
  layout: Record<string, unknown>
  variables: Record<string, unknown> | null
  createdAt: string
}

export interface GenerateResultDto {
  documentId: string
  fileUrl: string
}

export async function fetchTemplates(productId?: string | null): Promise<TemplateDto[]> {
  const qs = productId ? `?productId=${encodeURIComponent(productId)}` : ''
  const res = await authFetch(`${API_BASE}/api/templates${qs}`)
  return parseJson<TemplateDto[]>(res)
}

export async function fetchTemplate(id: string): Promise<TemplateDto> {
  const res = await authFetch(`${API_BASE}/api/templates/${id}`)
  return parseJson<TemplateDto>(res)
}

export async function createTemplate(
  name: string,
  productId: string,
  createdBy?: string,
): Promise<TemplateDto> {
  const res = await authFetch(`${API_BASE}/api/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdBy: createdBy ?? null, productId }),
  })
  return parseJson<TemplateDto>(res)
}

export async function fetchVersions(templateId: string): Promise<TemplateVersionDto[]> {
  const res = await authFetch(`${API_BASE}/api/templates/${templateId}/versions`)
  return parseJson<TemplateVersionDto[]>(res)
}

export async function createVersion(
  templateId: string,
  layout: Record<string, unknown>,
  variables: Record<string, unknown> | null
): Promise<TemplateVersionDto> {
  const res = await authFetch(`${API_BASE}/api/templates/${templateId}/versions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, variables }),
  })
  return parseJson<TemplateVersionDto>(res)
}

export interface TemplateDraftDto {
  layout: Record<string, unknown>
  variables: Record<string, unknown> | null
  updatedAt: string
}

export async function fetchDraft(templateId: string): Promise<TemplateDraftDto | null> {
  const res = await authFetch(`${API_BASE}/api/templates/${templateId}/draft`)
  if (res.status === 404) return null
  return parseJson<TemplateDraftDto>(res)
}

export async function putDraft(
  templateId: string,
  layout: Record<string, unknown>,
  variables: Record<string, string>
): Promise<TemplateDraftDto> {
  const res = await authFetch(`${API_BASE}/api/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, variables }),
  })
  return parseJson<TemplateDraftDto>(res)
}

export async function commitDraft(templateId: string): Promise<TemplateVersionDto> {
  const res = await authFetch(`${API_BASE}/api/templates/${templateId}/draft/commit`, {
    method: 'POST',
  })
  if (!res.ok) {
    // Surface the full JSON body on non-OK so callers can detect REVIEW_BLOCK
    // via isReviewBlockError(). `parseJson` collapses to Error(msg) which loses
    // the structured blockers payload — handle it ourselves here.
    const text = await res.text()
    let parsed: unknown = null
    try { parsed = JSON.parse(text) } catch { /* ignore */ }
    const err = new Error(
      typeof parsed === 'object' && parsed !== null && 'error' in parsed
        ? String((parsed as { error?: unknown }).error ?? res.statusText)
        : text || res.statusText,
    ) as Error & { payload?: unknown }
    err.payload = parsed
    throw err
  }
  return res.json() as Promise<TemplateVersionDto>
}

export async function generatePreviewPdf(
  layout: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<Blob> {
  const res = await authFetch(`${API_BASE}/api/generate/preview`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, data }),
  })
  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text) as { error?: string }
      if (j.error) msg = j.error
    } catch {
      /* ignore */
    }
    throw new Error(msg || res.statusText)
  }
  return res.blob()
}

export async function generatePdf(
  templateId: string,
  versionId: string,
  data: Record<string, unknown>
): Promise<GenerateResultDto> {
  const res = await authFetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, versionId, data }),
  })
  return parseJson<GenerateResultDto>(res)
}

// ── Document Lifecycle ──

export type LifecycleStatus =
  | 'DRAFT'
  | 'PENDING_REVIEW'
  | 'APPROVED'
  | 'REJECTED'
  | 'SENT'
  | 'SIGNED'
  | 'ACTIVE'
  | 'EXPIRED'
  | 'ARCHIVED'

/**
 * Where a generated document came from.
 *  - {@code UI_GENERATED}: produced via the in-app editor; carries a lifecycle.
 *  - {@code API_GENERATED}: produced via the public developer API
 *    ({@code POST /api/v1/templates/.../generate}); has {@code lifecycleStatus === null}
 *    and is not managed by our review/lifecycle UI.
 */
export type DocumentSource = 'UI_GENERATED' | 'API_GENERATED'

export interface DocumentLifecycleDto {
  id: string
  templateId: string
  templateName: string | null
  productId: string | null
  productName: string | null
  versionId: string
  title: string | null
  description: string | null
  fileUrl: string | null
  generationStatus: 'PENDING' | 'COMPLETED' | 'FAILED'
  lifecycleStatus: LifecycleStatus | null
  source: DocumentSource
  createdBy: string | null
  orgId: string | null
  expiresAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TimelineEventDto {
  id: string
  fromStatus: LifecycleStatus | null
  toStatus: LifecycleStatus
  eventType: string
  actorName: string | null
  comment: string | null
  createdAt: string
}

export interface ApprovalStepDto {
  id: string
  stepOrder: number
  assigneeId: string
  assigneeName: string | null
  roleLabel: string | null
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
  comment: string | null
  decidedAt: string | null
}

export interface ApprovalWorkflowDto {
  id: string
  documentId: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SKIPPED'
  steps: ApprovalStepDto[]
  createdAt: string
  completedAt: string | null
}

export interface DocumentDetailDto {
  document: DocumentLifecycleDto
  timeline: TimelineEventDto[]
  workflow: ApprovalWorkflowDto | null
}

export interface LifecycleStatsDto {
  counts: Record<LifecycleStatus, number>
  total: number
}

export interface PendingApprovalDto {
  stepId: string
  documentId: string
  documentTitle: string
  roleLabel: string | null
  requestedAt: string
}

export async function fetchDocuments(
  status?: LifecycleStatus,
  source?: DocumentSource,
  page = 0,
  size = 20,
): Promise<DocumentLifecycleDto[]> {
  const params = new URLSearchParams({ page: String(page), size: String(size) })
  if (status) params.set('status', status)
  if (source) params.set('source', source)
  const res = await authFetch(`${API_BASE}/api/documents?${params}`)
  return parseJson<DocumentLifecycleDto[]>(res)
}

export async function fetchDocumentLifecycle(id: string): Promise<DocumentDetailDto> {
  const res = await authFetch(`${API_BASE}/api/documents/${id}/lifecycle`)
  return parseJson<DocumentDetailDto>(res)
}

export async function transitionDocumentStatus(
  id: string,
  targetStatus: LifecycleStatus,
  comment?: string,
): Promise<DocumentLifecycleDto> {
  const res = await authFetch(`${API_BASE}/api/documents/${id}/transition`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetStatus, comment: comment ?? null }),
  })
  return parseJson<DocumentLifecycleDto>(res)
}

export async function fetchLifecycleStats(): Promise<LifecycleStatsDto> {
  const res = await authFetch(`${API_BASE}/api/documents/stats`)
  return parseJson<LifecycleStatsDto>(res)
}

export async function fetchPendingApprovals(): Promise<PendingApprovalDto[]> {
  const res = await authFetch(`${API_BASE}/api/documents/pending-approvals`)
  return parseJson<PendingApprovalDto[]>(res)
}

export async function createApprovalWorkflow(
  documentId: string,
  steps: { assigneeId: string; roleLabel: string }[],
): Promise<ApprovalWorkflowDto> {
  const res = await authFetch(`${API_BASE}/api/approvals/workflows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ documentId, steps }),
  })
  return parseJson<ApprovalWorkflowDto>(res)
}

export async function fetchApprovalWorkflow(documentId: string): Promise<ApprovalWorkflowDto> {
  const res = await authFetch(`${API_BASE}/api/approvals/workflows/${documentId}`)
  return parseJson<ApprovalWorkflowDto>(res)
}

export async function approveStep(stepId: string, comment?: string): Promise<ApprovalWorkflowDto> {
  const res = await authFetch(`${API_BASE}/api/approvals/steps/${stepId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: comment ?? null }),
  })
  return parseJson<ApprovalWorkflowDto>(res)
}

export async function rejectStep(stepId: string, comment?: string): Promise<ApprovalWorkflowDto> {
  const res = await authFetch(`${API_BASE}/api/approvals/steps/${stepId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment: comment ?? null }),
  })
  return parseJson<ApprovalWorkflowDto>(res)
}

export function pdfFileUrl(fileUrl: string): string {
  if (fileUrl.startsWith('http')) return fileUrl
  return `${API_BASE}${fileUrl}`
}

/**
 * Upload a new avatar for the current user. The backend writes to R2's public
 * bucket and returns the permanent public URL, which is also written to
 * {@code users.avatar_url}. Caller should refresh the auth store's `user`
 * so navbar avatars reflect the new image.
 */
export async function uploadUserAvatar(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await authFetch(`${API_BASE}/api/users/me/avatar`, {
    method: 'POST',
    body: form,
  })
  const body = await parseJson<{ avatarUrl: string }>(res)
  return body.avatarUrl
}

/** Upload a new logo for an org. ADMIN only. Returns the new public URL. */
export async function uploadOrgLogo(orgId: string, file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await authFetch(`${API_BASE}/api/orgs/${orgId}/avatar`, {
    method: 'POST',
    body: form,
  })
  const body = await parseJson<{ logoUrl: string }>(res)
  return body.logoUrl
}

/**
 * Fetch a generated-document PDF as a Blob with the Bearer token attached.
 * Callers should turn the blob into an object URL via {@link URL.createObjectURL}
 * and {@link URL.revokeObjectURL} when done. Embedding the backend URL
 * directly in an {@code <iframe src>} doesn't work — the iframe request
 * carries no Authorization header and the backend responds with
 * {@code X-Frame-Options: DENY} anyway, so the browser shows a
 * {@code chrome-error://} frame.
 */
export async function fetchDocumentFileBlob(fileUrl: string): Promise<Blob> {
  const url = fileUrl.startsWith('http') ? fileUrl : `${API_BASE}${fileUrl}`
  const res = await authFetch(url)
  if (!res.ok) throw new Error(`Failed to load PDF (${res.status})`)
  return res.blob()
}

/**
 * Duplicate a template by creating a new one and copying the latest version's layout.
 * This is a frontend-only composition — no dedicated backend endpoint needed.
 * The copy inherits the source's {@code productId} so it lands in the same bucket.
 */
export async function duplicateTemplate(
  sourceTemplateId: string,
  sourceName: string,
  productId: string,
): Promise<TemplateDto> {
  // Create the new template
  const newTemplate = await createTemplate(`Copy of ${sourceName}`, productId)

  // Try to copy the latest committed version
  try {
    const versions = await fetchVersions(sourceTemplateId)
    if (versions.length > 0) {
      // Sort by versionNumber descending to get the latest
      const latest = versions.sort((a, b) => b.versionNumber - a.versionNumber)[0]
      const layout = latest.layout as Record<string, unknown>
      const variables = latest.variables as Record<string, unknown> | null
      // Save as draft on the new template and commit it
      await putDraft(newTemplate.id, layout, (variables as Record<string, string>) ?? {})
      await commitDraft(newTemplate.id)
    }
  } catch {
    // If version copy fails, the new template still exists (empty)
  }

  return newTemplate
}

// ── Org members (for Share modal autocomplete + reviewer picker) ─────────────

/** Shape returned directly by the backend (see OrgMembershipResponse.java). */
interface OrgMembershipRaw {
  id: string
  userId: string
  orgId: string
  role: 'ADMIN' | 'DESIGNER' | 'REVIEWER' | 'VIEWER'
  userName: string | null
  userEmail: string | null
  userAvatar: string | null
  createdAt: string
}

/** Normalised shape consumed by UI — name / email / avatarUrl, never undefined. */
export interface OrgMemberDto {
  id: string
  userId: string
  name: string
  email: string
  avatarUrl: string | null
  role: 'ADMIN' | 'DESIGNER' | 'REVIEWER' | 'VIEWER'
  createdAt: string
}

export async function fetchOrgMembers(orgId: string): Promise<OrgMemberDto[]> {
  const res = await authFetch(`/api/orgs/${orgId}/members`)
  const raw = await parseJson<OrgMembershipRaw[]>(res)
  return raw.map((m) => ({
    id: m.id,
    userId: m.userId,
    name: m.userName ?? m.userEmail ?? '',
    email: m.userEmail ?? '',
    avatarUrl: m.userAvatar ?? null,
    role: m.role,
    createdAt: m.createdAt,
  }))
}

// ── Template review workflow ────────────────────────────────────────────────

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'CHANGES_REQUESTED' | 'DISMISSED'

export interface ReviewUserInfo {
  id: string | null
  name: string
  email: string
  avatarUrl: string | null
}

export interface TemplateReviewDto {
  id: string
  templateId: string
  versionId: string
  versionNumber: number
  requester: ReviewUserInfo
  reviewer: ReviewUserInfo
  status: ReviewStatus
  message: string | null
  summary: string | null
  createdAt: string
  decidedAt: string | null
}

export async function fetchTemplateReviews(templateId: string, versionId?: string): Promise<TemplateReviewDto[]> {
  const q = versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''
  const res = await authFetch(`/api/templates/${templateId}/reviews${q}`)
  return parseJson<TemplateReviewDto[]>(res)
}

export async function requestReviews(
  templateId: string,
  versionId: string,
  reviewerIds: string[],
  message?: string,
): Promise<TemplateReviewDto[]> {
  const res = await authFetch(`/api/templates/${templateId}/versions/${versionId}/reviews`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reviewerIds, message: message ?? null }),
  })
  return parseJson<TemplateReviewDto[]>(res)
}

export async function decideReview(
  templateId: string,
  reviewId: string,
  status: Extract<ReviewStatus, 'APPROVED' | 'CHANGES_REQUESTED'>,
  summary?: string,
): Promise<TemplateReviewDto> {
  const res = await authFetch(`/api/templates/${templateId}/reviews/${reviewId}/decide`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, summary: summary ?? null }),
  })
  return parseJson<TemplateReviewDto>(res)
}

export async function reopenReview(templateId: string, reviewId: string): Promise<TemplateReviewDto> {
  const res = await authFetch(`/api/templates/${templateId}/reviews/${reviewId}/reopen`, { method: 'POST' })
  return parseJson<TemplateReviewDto>(res)
}

export async function dismissReview(templateId: string, reviewId: string): Promise<TemplateReviewDto> {
  const res = await authFetch(`/api/templates/${templateId}/reviews/${reviewId}/dismiss`, { method: 'POST' })
  return parseJson<TemplateReviewDto>(res)
}

export async function fetchReviewsAssignedToMe(limit = 50): Promise<TemplateReviewDto[]> {
  const res = await authFetch(`/api/reviews/assigned?limit=${limit}`)
  return parseJson<TemplateReviewDto[]>(res)
}

/**
 * The commit endpoint returns 409 with a structured body
 * `{ error, code: "REVIEW_BLOCK", blockers: TemplateReviewDto[] }`
 * when mandatory changes are outstanding. Use this to detect and surface the UI.
 */
export interface ReviewBlockPayload {
  error: string
  code: 'REVIEW_BLOCK'
  blockers: TemplateReviewDto[]
}

// ── API keys ─────────────────────────────────────────────────────────────────

export interface ApiKeyDto {
  id: string
  orgId: string
  name: string
  keyPrefix: string
  keyLast4: string
  scopes: string[]
  allowedIps: string | null
  rateLimitRpm: number
  createdAt: string
  expiresAt: string | null
  lastUsedAt: string | null
  lastUsedIp: string | null
  revokedAt: string | null
  rotatedToId: string | null
}

export interface ApiKeyCreatedDto {
  key: ApiKeyDto
  rawKey: string    // shown exactly once
}

export interface CreateApiKeyRequestDto {
  name: string
  scopes: string[]
  expiresInDays?: number | null
  allowedIps?: string | null
  rateLimitRpm?: number | null
}

export async function listApiKeys(orgId: string): Promise<ApiKeyDto[]> {
  const res = await authFetch(`/api/orgs/${orgId}/api-keys`)
  return parseJson<ApiKeyDto[]>(res)
}

export async function createApiKey(orgId: string, req: CreateApiKeyRequestDto): Promise<ApiKeyCreatedDto> {
  const res = await authFetch(`/api/orgs/${orgId}/api-keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  return parseJson<ApiKeyCreatedDto>(res)
}

export async function revokeApiKey(orgId: string, keyId: string): Promise<void> {
  await authFetch(`/api/orgs/${orgId}/api-keys/${keyId}`, { method: 'DELETE' })
}

export async function rotateApiKey(orgId: string, keyId: string, graceDays = 7): Promise<ApiKeyCreatedDto> {
  const res = await authFetch(
    `/api/orgs/${orgId}/api-keys/${keyId}/rotate?graceDays=${graceDays}`,
    { method: 'POST' },
  )
  return parseJson<ApiKeyCreatedDto>(res)
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export interface WebhookDto {
  id: string
  orgId: string
  url: string
  secretLast4: string
  events: string[]
  active: boolean
  createdAt: string
  revokedAt: string | null
}

export interface WebhookCreatedDto { webhook: WebhookDto; secret: string }

export interface WebhookDeliveryDto {
  id: string
  webhookId: string
  event: string
  attempt: number
  maxAttempts: number
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'ABANDONED'
  responseCode: number | null
  responseBody: string | null
  error: string | null
  nextRetryAt: string | null
  createdAt: string
  deliveredAt: string | null
}

export async function listWebhooks(orgId: string): Promise<WebhookDto[]> {
  const res = await authFetch(`/api/orgs/${orgId}/webhooks`)
  return parseJson<WebhookDto[]>(res)
}

export async function createWebhook(orgId: string, url: string, events: string[]): Promise<WebhookCreatedDto> {
  const res = await authFetch(`/api/orgs/${orgId}/webhooks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, events }),
  })
  return parseJson<WebhookCreatedDto>(res)
}

export async function revokeWebhook(orgId: string, webhookId: string): Promise<void> {
  await authFetch(`/api/orgs/${orgId}/webhooks/${webhookId}`, { method: 'DELETE' })
}

export async function listWebhookDeliveries(orgId: string, webhookId: string, limit = 50): Promise<WebhookDeliveryDto[]> {
  const res = await authFetch(`/api/orgs/${orgId}/webhooks/${webhookId}/deliveries?limit=${limit}`)
  return parseJson<WebhookDeliveryDto[]>(res)
}

export function isReviewBlockError(err: unknown): err is { payload: ReviewBlockPayload } {
  return typeof err === 'object' && err !== null &&
    'payload' in err &&
    typeof (err as { payload?: { code?: unknown } }).payload?.code === 'string' &&
    (err as { payload: ReviewBlockPayload }).payload.code === 'REVIEW_BLOCK'
}
