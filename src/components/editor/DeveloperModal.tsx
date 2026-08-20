import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/shallow'
import { Link } from 'react-router-dom'
import { Modal, ModalFooter } from '../ui/Modal'
import { Button } from '../ui/Button'
import { useAuthStore } from '../../stores/authStore'
import { selectAllTemplateElements, useEditorStore } from '../../stores/editorStore'
import { API_BASE } from '../../lib/api'
import { stripSystemVariableKeysFromData } from '../../lib/systemTemplateVariables'
import { uniqueListDataKeys, uniqueTableDataKeys } from '../../lib/variables'
import { getTableColumnsForDataKey, parseTableRowsFromJson } from '../../lib/previewFormData'
import { parseTableVariableData, structuredToLegacyRows } from '../../lib/tableDataFormat'

/**
 * Editor's 3-dot menu → "Developer". Shows a ready-to-run cURL snippet for the
 * current template — template id, API host, and a copy-pasteable preview
 * `data` payload built from the user's current variableValues. The actual
 * secret is never embedded; the snippet references `$CRIXAA_API_KEY` and
 * points the user to Settings → Developer to create / retrieve one.
 */
export function DeveloperModal({
  open, onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const templateId = useEditorStore((s) => s.templateId)
  const variableValues = useEditorStore((s) => s.variableValues)
  const orgs = useAuthStore((s) => s.orgs)
  const orgId = useAuthStore((s) => s.org?.id ?? null)
  const isAdmin = useMemo(() => {
    if (!orgId) return false
    return orgs.find((o) => o.org.id === orgId)?.role === 'ADMIN'
  }, [orgs, orgId])

  const apiBase = useMemo(() => {
    if (API_BASE) return API_BASE.replace(/\/$/, '')
    // Fall back to same-origin when running in local dev with Vite proxy.
    return window.location.origin
  }, [])

  // useShallow: selectAllTemplateElements builds a new array on every call, so
  // passing it unwrapped re-renders forever. selectorStability.test.ts guards
  // this and caught it here.
  const elements = useEditorStore(useShallow(selectAllTemplateElements))

  const curl = useMemo(() => {
    if (!templateId) return ''
    // Strip system-computed keys (pageNumber / totalPages / currentDate /
    // …). The backend overrides whatever the API caller sends for these
    // anyway, and including them in the sample cURL misleads authors
    // into thinking they need to supply a value.
    const cleanedData = stripSystemVariableKeysFromData(variableValues ?? {})

    // Emit tables and lists as REAL arrays, not as the JSON strings we store.
    //
    // variableValues is a flat key-to-string map, so a table's rows live in it
    // as a stringified array. Serialising that map directly produced a snippet
    // where every quote inside the rows was escaped — and a rich-text cell,
    // whose value is itself JSON, came out escaped twice. It was technically
    // correct and nobody would hand-write it.
    //
    // This is a snippet for a person to read and edit, so it shows the shape a
    // person would write. The backend accepts it: VariableDataTree.tableRows
    // takes a real array as-is.
    const snippetData: Record<string, unknown> = { ...cleanedData }

    for (const key of uniqueTableDataKeys(elements)) {
      const raw = cleanedData[key]
      const columns = getTableColumnsForDataKey(elements, key)
      const structured = typeof raw === 'string' ? parseTableVariableData(raw) : null
      const parsed = structured
        ? structuredToLegacyRows(structured, columns)
        : typeof raw === 'string' && raw.trim()
          ? parseTableRowsFromJson(raw, columns.map((c) => c.key))
          : []
      // Blank rows are dropped, matching what the renderer does — and a table
      // the author has not filled in is stored as a grid of blank rows, so
      // this is what makes "unfilled" come out as [].
      const rows = parsed.filter((r) =>
        Object.values(r).some((v) => String(v ?? '').trim() !== '')
      )
      // ALWAYS assign, even when empty. Falling through on a table with no
      // usable rows left the raw stored STRING in the payload — the escaped
      // form this whole change exists to remove, showing up exactly on the
      // tables a new author is most likely to be looking at.
      snippetData[key] = rows
    }

    for (const key of uniqueListDataKeys(elements)) {
      const raw = cleanedData[key]
      let items: unknown[] = []
      if (typeof raw === 'string' && raw.trim()) {
        try {
          const parsed: unknown = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            items = parsed.filter((v) => String(v ?? '').trim() !== '')
          }
        } catch {
          /* unparseable — treat as unfilled rather than pasting broken JSON
             into a snippet the reader is meant to run */
        }
      }
      snippetData[key] = items
    }

    const jsonData = JSON.stringify({ data: snippetData }, null, 2)
      .split('\n')
      .map((line, i) => (i === 0 ? line : '    ' + line))
      .join('\n')
    return `curl -X POST ${apiBase}/api/v1/templates/${templateId}/generate \\
  -H "X-Api-Key: $CRIXAA_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${jsonData}'`
  }, [apiBase, templateId, variableValues, elements])

  function copyCurl() {
    navigator.clipboard.writeText(curl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Modal open={open} onClose={onClose} title="Developer — generate this template programmatically" size="lg">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Use this snippet from a server or CI job to render a PDF for the template you're editing.
        Replace <code className="rounded bg-zinc-100 px-1 text-[12px] dark:bg-zinc-800">$CRIXAA_API_KEY</code> with
        the key you create in{' '}
        {isAdmin ? (
          <Link to="/settings?tab=developer" onClick={onClose} className="font-medium text-violet-600 hover:underline dark:text-violet-400">
            Settings → Developer
          </Link>
        ) : (
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Settings → Developer</span>
        )}.
        {!isAdmin && (
          <span className="mt-1 block text-[12px] text-amber-700 dark:text-amber-300">
            Only admins can create API keys — ask an admin on your team to issue one.
          </span>
        )}
      </p>

      <div className="mt-3">
        <label className="mb-1 block text-xs font-medium text-zinc-700 dark:text-zinc-300">cURL</label>
        <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
{curl}
        </pre>
      </div>

      <details className="mt-4 rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-700">
        <summary className="cursor-pointer font-medium text-zinc-800 dark:text-zinc-200">
          What does this do?
        </summary>
        <ul className="mt-2 list-disc pl-5 text-[12px] text-zinc-600 dark:text-zinc-400">
          <li>Uses the template's latest committed version by default. Pass <code>"versionId"</code> in the body to pin a specific version.</li>
          <li>Returns <code>{'{documentId, fileUrl}'}</code>. Fetch <code>GET /api/v1/documents/:id/file</code> to stream the PDF.</li>
          <li>Requires the <code>documents:generate</code> scope on the API key.</li>
          <li>Respects the key's rate limit and IP allowlist; returns <code>429</code> or <code>401</code> respectively.</li>
        </ul>
      </details>

      <ModalFooter>
        <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
        <Button variant="primary" size="sm" onClick={copyCurl} disabled={!curl}>
          {copied ? 'Copied!' : 'Copy cURL'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
