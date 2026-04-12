const API_BASE = ''

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

export async function fetchTemplates(): Promise<TemplateDto[]> {
  const res = await fetch(`${API_BASE}/api/templates`)
  return parseJson<TemplateDto[]>(res)
}

export async function fetchTemplate(id: string): Promise<TemplateDto> {
  const res = await fetch(`${API_BASE}/api/templates/${id}`)
  return parseJson<TemplateDto>(res)
}

export async function createTemplate(name: string, createdBy?: string): Promise<TemplateDto> {
  const res = await fetch(`${API_BASE}/api/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, createdBy: createdBy ?? null }),
  })
  return parseJson<TemplateDto>(res)
}

export async function fetchVersions(templateId: string): Promise<TemplateVersionDto[]> {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/versions`)
  return parseJson<TemplateVersionDto[]>(res)
}

export async function createVersion(
  templateId: string,
  layout: Record<string, unknown>,
  variables: Record<string, unknown> | null
): Promise<TemplateVersionDto> {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/versions`, {
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
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/draft`)
  if (res.status === 404) return null
  return parseJson<TemplateDraftDto>(res)
}

export async function putDraft(
  templateId: string,
  layout: Record<string, unknown>,
  variables: Record<string, string>
): Promise<TemplateDraftDto> {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/draft`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout, variables }),
  })
  return parseJson<TemplateDraftDto>(res)
}

export async function commitDraft(templateId: string): Promise<TemplateVersionDto> {
  const res = await fetch(`${API_BASE}/api/templates/${templateId}/draft/commit`, {
    method: 'POST',
  })
  return parseJson<TemplateVersionDto>(res)
}

export async function generatePreviewPdf(
  layout: Record<string, unknown>,
  data: Record<string, unknown>
): Promise<Blob> {
  const res = await fetch(`${API_BASE}/api/generate/preview`, {
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
  const res = await fetch(`${API_BASE}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ templateId, versionId, data }),
  })
  return parseJson<GenerateResultDto>(res)
}

export function pdfFileUrl(fileUrl: string): string {
  if (fileUrl.startsWith('http')) return fileUrl
  return `${API_BASE}${fileUrl}`
}
