import { useMemo, useState } from 'react'
import { API_BASE } from '../../lib/api'
import { Button } from '../ui/Button'

/**
 * Copy-pasteable code snippets for the two languages most integration teams
 * ask for first. The snippets hydrate the `API_BASE` with whatever the user's
 * env has, so they can literally paste + run.
 */
export function SdkSnippets() {
  const [lang, setLang] = useState<'python' | 'node' | 'curl'>('python')
  const apiBase = useMemo(() => (API_BASE ? API_BASE.replace(/\/$/, '') : window.location.origin), [])

  const snippets: Record<typeof lang, string> = {
    python: `import os, requests

API_BASE = "${apiBase}"
API_KEY  = os.environ["AGREEMINT_API_KEY"]

resp = requests.post(
    f"{API_BASE}/api/v1/templates/TEMPLATE_ID/generate",
    headers={"X-Api-Key": API_KEY, "Content-Type": "application/json"},
    json={"data": {"customerName": "Alice"}},
    timeout=30,
)
resp.raise_for_status()
print(resp.json())  # {"documentId": "...", "fileUrl": "/api/..."}`,
    node: `const API_BASE = '${apiBase}'
const API_KEY  = process.env.AGREEMINT_API_KEY

const res = await fetch(\`\${API_BASE}/api/v1/templates/TEMPLATE_ID/generate\`, {
  method: 'POST',
  headers: { 'X-Api-Key': API_KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ data: { customerName: 'Alice' } }),
})
const body = await res.json()
console.log(body)  // { documentId, fileUrl }`,
    curl: `curl -X POST ${apiBase}/api/v1/templates/TEMPLATE_ID/generate \\
  -H "X-Api-Key: $AGREEMINT_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"data":{"customerName":"Alice"}}'`,
  }

  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(snippets[lang])
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <section className="rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">SDK snippets</h3>
          <p className="mt-1 text-[12px] text-zinc-500 dark:text-zinc-400">
            Copy a minimal working example in your language of choice.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 text-[11px] dark:bg-zinc-800">
          {(['python', 'node', 'curl'] as const).map((l) => (
            <button
              key={l}
              type="button"
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                lang === l
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-100'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
              }`}
              onClick={() => setLang(l)}
            >
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="relative mt-3">
        <pre className="overflow-x-auto rounded-md bg-zinc-900 p-3 font-mono text-[11px] leading-relaxed text-zinc-100">
{snippets[lang]}
        </pre>
        <div className="absolute right-2 top-2">
          <Button size="xs" variant="secondary" onClick={copy}>{copied ? 'Copied!' : 'Copy'}</Button>
        </div>
      </div>
    </section>
  )
}
