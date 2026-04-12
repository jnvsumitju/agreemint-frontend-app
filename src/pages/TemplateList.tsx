import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createTemplate, fetchTemplates, type TemplateDto } from '../lib/api'

export function TemplateList() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<TemplateDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [creating, setCreating] = useState(false)

  const load = () => {
    setLoading(true)
    setError(null)
    fetchTemplates()
      .then(setTemplates)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
  }, [])

  const onCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      const t = await createTemplate(name.trim())
      setName('')
      navigate(`/editor/${t.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      <h1 className="mb-2 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">Agreemint</h1>
      <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">
        Visual PDF templates with versioned layouts and iText rendering.
      </p>

      <form onSubmit={(e) => void onCreate(e)} className="mb-10 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">New template name</span>
          <input
            id="ag-template-new-name"
            name="ag-template-new-name"
            type="text"
            className="min-w-[240px] rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Invoice, NDA, …"
          />
        </label>
        <button
          type="submit"
          disabled={creating || !name.trim()}
          className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {creating ? 'Creating…' : 'Create'}
        </button>
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-zinc-500">No templates yet. Create one above.</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded-xl border border-zinc-200 bg-white dark:divide-zinc-700 dark:border-zinc-700 dark:bg-zinc-900">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                to={`/editor/${t.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-800/80"
              >
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.name}</span>
                <span className="text-xs text-zinc-500">
                  {new Date(t.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
