import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Badge, useToast } from '../components/ui'

/* ── Building blocks ── */

const SECTIONS = [
  { id: 'overview', label: 'Overview' },
  { id: 'api-keys', label: 'Creating an API key' },
  { id: 'authentication', label: 'Authentication' },
  { id: 'scopes', label: 'Scopes' },
  { id: 'generate', label: 'Generate a PDF' },
  { id: 'fetch', label: 'Fetch a document' },
  { id: 'list', label: 'List documents' },
  { id: 'templates', label: 'Templates' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'rate-limits', label: 'Rate limits' },
  { id: 'errors', label: 'Errors' },
]

function CodeBlock({ code, language = 'bash' }: { code: string; language?: string }) {
  const toast = useToast()
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  return (
    <div className="group relative my-3">
      <pre className="overflow-x-auto rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-[13px] leading-relaxed text-zinc-800 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy code"
        className="absolute right-2 top-2 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-600 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <span className="sr-only">{language}</span>
    </div>
  )
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-zinc-200 pt-8 first:border-0 first:pt-0 dark:border-zinc-800">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">{children}</div>
    </section>
  )
}

function Endpoint({ method, path }: { method: string; path: string }) {
  const tone =
    method === 'POST'
      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300'
      : 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2">
      <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${tone}`}>{method}</span>
      <code className="font-mono text-sm text-zinc-800 dark:text-zinc-200">{path}</code>
    </div>
  )
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="my-3 overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            {head.map((h) => (
              <th key={h} className="px-4 py-2 font-medium">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((cell, j) => (
                <td key={j} className="px-4 py-2 text-zinc-600 dark:text-zinc-400">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const C = ({ children }: { children: ReactNode }) => (
  <code className="rounded bg-zinc-100 px-1 py-0.5 font-mono text-[13px] text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200">
    {children}
  </code>
)

/* ── Page ── */

/**
 * Developer documentation for the public API. Org-ADMIN only — gated both by
 * the nav (AppLayout) and the RequireAdmin route guard, since only admins can
 * mint the API keys these docs describe.
 */
export function Documentation() {
  return (
    <div className="page-enter mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8">
        <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">Documentation</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Generate documents, fetch them, and receive events — programmatically.
        </p>
      </header>

      <div className="flex gap-10">
        {/* Sticky table of contents */}
        <nav className="hidden w-52 shrink-0 lg:block">
          <div className="sticky top-6">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
              On this page
            </p>
            <ul className="space-y-1">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className="block rounded px-2 py-1 text-sm text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </nav>

        <div className="min-w-0 flex-1 space-y-10">
          {/* ── Overview ── */}
          <Section id="overview" title="Overview">
            <p>
              The Crixaa API lets you generate PDFs from your templates and pull them back down, without
              opening the console. Every endpoint below lives under <C>/api/v1</C> and is authenticated
              with an API key.
            </p>
            <Table
              head={['', '']}
              rows={[
                [<strong key="a">Base URL</strong>, <C key="b">https://api.crixaa.com</C>],
                [<strong key="c">Auth</strong>, <span key="d">An <C>X-Api-Key</C> header on every request</span>],
                [<strong key="e">Content type</strong>, <C key="f">application/json</C>],
              ]}
            />
            <p>
              Keys are scoped to a single organization — a key issued in one workspace can never read
              another workspace's templates or documents.
            </p>
          </Section>

          {/* ── API keys ── */}
          <Section id="api-keys" title="Creating an API key">
            <p>
              API keys are managed per workspace in{' '}
              <Link to="/settings?tab=developer" className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                Settings → Developer
              </Link>
              . Only workspace admins can see that tab.
            </p>
            <ol className="ml-5 list-decimal space-y-1">
              <li>Open <strong>Settings → Developer</strong> and click <strong>Create API key</strong>.</li>
              <li>Give it a name you'll recognise later (e.g. "Billing service — production").</li>
              <li>Select only the scopes it needs — see <a href="#scopes" className="text-violet-600 hover:underline dark:text-violet-400">Scopes</a> below.</li>
              <li>Optionally set an expiry, an IP allowlist, and a per-minute rate limit.</li>
              <li>
                Copy the key immediately. It looks like <C>ak_live_…</C> and is{' '}
                <strong className="text-zinc-800 dark:text-zinc-200">shown only once</strong> — we store a hash,
                so it cannot be retrieved later.
              </li>
            </ol>
            <p>
              <strong className="text-zinc-800 dark:text-zinc-200">Rotating.</strong> Use <strong>Rotate</strong> to
              issue a replacement while keeping the old key valid for a grace period (1–30 days), so you can deploy
              the new key without downtime. <strong>Revoke</strong> kills a key immediately.
            </p>
            <p>Treat keys like passwords: keep them server-side, never in frontend code or a public repo.</p>
          </Section>

          {/* ── Authentication ── */}
          <Section id="authentication" title="Authentication">
            <p>Pass your key in the <C>X-Api-Key</C> header. There is no OAuth flow and no bearer token for the public API.</p>
            <CodeBlock code={`curl 'https://api.crixaa.com/api/v1/documents' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE'`} />
            <p>
              A missing or invalid key returns <C>401</C>. A valid key that lacks the scope for the endpoint
              returns <C>403</C>.
            </p>
          </Section>

          {/* ── Scopes ── */}
          <Section id="scopes" title="Scopes">
            <p>Each key carries an explicit set of scopes. Grant the minimum a given integration needs.</p>
            <Table
              head={['Scope', 'Grants']}
              rows={[
                [<C key="1">documents:generate</C>, 'Generate a PDF from a template'],
                [<C key="2">documents:read</C>, 'Read document metadata, download files, list documents'],
                [<C key="3">templates:read</C>, 'Read template metadata and version history'],
                [
                  <C key="4">webhooks:read</C>,
                  <span key="4b">
                    Reserved — <Badge size="sm">not yet used</Badge> Manage webhooks in the console for now.
                  </span>,
                ],
                [
                  <C key="5">webhooks:write</C>,
                  <span key="5b">
                    Reserved — <Badge size="sm">not yet used</Badge>
                  </span>,
                ],
              ]}
            />
          </Section>

          {/* ── Generate ── */}
          <Section id="generate" title="Generate a PDF">
            <p>
              Renders a template into a PDF and stores it. The response comes back as soon as the document
              is generated.
            </p>
            <Endpoint method="POST" path="/api/v1/templates/{templateId}/generate" />
            <p className="mt-3">
              Requires <C>documents:generate</C>. The <C>data</C> object supplies the values for your
              template's placeholders. <C>versionId</C> is optional — omit it and the{' '}
              <strong className="text-zinc-800 dark:text-zinc-200">latest committed version</strong> is used.
            </p>
            <CodeBlock code={`curl --location 'https://api.crixaa.com/api/v1/templates/{templateId}/generate' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE' \\
  --header 'Content-Type: application/json' \\
  --data '{
    "data": {
      "company.name": "Acme Corp",
      "invoice.number": "INV-2026-0042",
      "invoice.total": 2400
    }
  }'`} />
            {/*
              Dotted keys in the sample on purpose. Most variables in a real
              template are dotted, the editor prints the placeholder exactly
              that way, and a flat sample here taught people to send a shape
              that used to render every field blank without complaining.
            */}
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <p>
                <strong className="text-zinc-800 dark:text-zinc-200">
                  Use the key exactly as the canvas shows it.
                </strong>{' '}
                A placeholder written <C>{'{{company.name}}'}</C> is sent as{' '}
                <C>"company.name"</C>. Nested objects are equivalent —{' '}
                <C>{'{ "company": { "name": "Acme" } }'}</C> — and the two can be mixed in one
                payload. Extra keys the template doesn't reference are ignored.
              </p>
              <p className="mt-2">
                <C>currentDate</C>, <C>pageNumber</C> and <C>totalPages</C> are computed by the
                renderer; sending them has no effect.
              </p>
            </div>
            <p>Returns <C>201 Created</C>:</p>
            <CodeBlock language="json" code={`{
  "documentId": "1f2dd3b4-0420-4710-8a09-77b72372a9ce",
  "fileUrl": "/api/v1/documents/1f2dd3b4-0420-4710-8a09-77b72372a9ce/file"
}`} />
            <p>
              <C>fileUrl</C> is relative — prefix it with the base URL to download. See{' '}
              <a href="#fetch" className="text-violet-600 hover:underline dark:text-violet-400">Fetch a document</a>.
            </p>
            <p>
              Documents created through the API skip the review/approval lifecycle that console-generated
              documents go through — they're final the moment they're generated.
            </p>
            <p>
              If the template has no committed versions yet, you'll get a <C>400</C>. Commit a version in the
              editor first.
            </p>
          </Section>

          {/* ── Fetch ── */}
          <Section id="fetch" title="Fetch a document">
            <p>Two endpoints: one for the metadata, one for the file itself. Both require <C>documents:read</C>.</p>

            <Endpoint method="GET" path="/api/v1/documents/{documentId}" />
            <p className="mt-3">Returns the document's status and file URL.</p>
            <CodeBlock code={`curl 'https://api.crixaa.com/api/v1/documents/{documentId}' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE'`} />
            <CodeBlock language="json" code={`{
  "id": "1f2dd3b4-0420-4710-8a09-77b72372a9ce",
  "templateId": "f5040b56-3fcf-497b-a0a4-25653f1f2400",
  "versionId": "9c2e1b77-1a4f-4f0e-bb02-3d5e6a7c8901",
  "fileUrl": "/api/v1/documents/1f2dd3b4-0420-4710-8a09-77b72372a9ce/file",
  "status": "COMPLETED",
  "createdAt": "2026-07-27T10:15:32Z"
}`} />
            <p>
              <C>status</C> is one of <C>PENDING</C>, <C>COMPLETED</C>, or <C>FAILED</C>. Only download the
              file once it reads <C>COMPLETED</C>.
            </p>

            <Endpoint method="GET" path="/api/v1/documents/{documentId}/file" />
            <p className="mt-3">
              Responds <C>302 Found</C> with a short-lived pre-signed storage URL in the <C>Location</C> header —
              the PDF bytes do not come back on this request.{' '}
              <strong className="text-zinc-800 dark:text-zinc-200">Follow redirects</strong> (curl needs <C>-L</C>);
              most HTTP libraries do so by default.
            </p>
            <CodeBlock code={`curl -L 'https://api.crixaa.com/api/v1/documents/{documentId}/file' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE' \\
  --output document.pdf`} />
            <p>
              The pre-signed link expires after a few minutes, so fetch it when you need it rather than
              caching the redirect target.
            </p>
          </Section>

          {/* ── List ── */}
          <Section id="list" title="List documents">
            <p>Returns your organization's documents, newest first. Requires <C>documents:read</C>.</p>
            <Endpoint method="GET" path="/api/v1/documents" />
            <Table
              head={['Parameter', 'Default', 'Description']}
              rows={[
                [<C key="1">page</C>, <C key="1b">0</C>, 'Zero-based page index.'],
                [<C key="2">size</C>, <C key="2b">20</C>, 'Results per page. Capped at 100 — larger values are clamped, not rejected.'],
                [
                  <C key="3">source</C>,
                  '—',
                  <span key="3b">
                    Filter by origin: <C>API_GENERATED</C> or <C>UI_GENERATED</C>. Omit for both.
                  </span>,
                ],
              ]}
            />
            <CodeBlock code={`curl 'https://api.crixaa.com/api/v1/documents?source=API_GENERATED&size=50' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE'`} />
            <p>Returns a JSON array of the same objects described in <a href="#fetch" className="text-violet-600 hover:underline dark:text-violet-400">Fetch a document</a>. An empty page means you've reached the end.</p>
          </Section>

          {/* ── Templates ── */}
          <Section id="templates" title="Templates">
            <p>Read-only access to template metadata and version history. Both require <C>templates:read</C>.</p>
            <Endpoint method="GET" path="/api/v1/templates/{templateId}" />
            <Endpoint method="GET" path="/api/v1/templates/{templateId}/versions" />
            <p className="mt-3">
              Versions come back newest first. Use a version's <C>id</C> as <C>versionId</C> when generating
              to pin output to a specific revision instead of always tracking the latest.
            </p>
            <CodeBlock code={`curl 'https://api.crixaa.com/api/v1/templates/{templateId}/versions' \\
  --header 'X-Api-Key: ak_live_YOUR_KEY_HERE'`} />
          </Section>

          {/* ── Webhooks ── */}
          <Section id="webhooks" title="Webhooks">
            <p>
              Webhooks push events to your server as they happen, so you don't have to poll. Add one in{' '}
              <Link to="/settings?tab=developer" className="font-medium text-violet-600 hover:underline dark:text-violet-400">
                Settings → Developer
              </Link>{' '}
              → <strong>Add webhook</strong>, with the HTTPS URL to deliver to and the events you want.
            </p>

            <h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Events</h3>
            <Table
              head={['Event', 'Fires when']}
              rows={[
                [<C key="1">document.generated</C>, 'A document finishes generating (from the API or the console).'],
                [<C key="2">template.version.committed</C>, 'A new template version is committed.'],
                [<C key="3">review.requested</C>, 'Someone requests review of a template version.'],
                [<C key="4">review.decided</C>, 'A reviewer approves or requests changes.'],
              ]}
            />

            <h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Request format</h3>
            <p>Each delivery is a <C>POST</C> with a JSON body and these headers:</p>
            <Table
              head={['Header', 'Value']}
              rows={[
                [<C key="1">X-Crixaa-Event</C>, 'The event name, e.g. document.generated'],
                [<C key="2">X-Crixaa-Delivery</C>, 'Unique delivery id — use it to de-duplicate retries'],
                [<C key="3">X-Crixaa-Signature</C>, <span key="3b">Signature, e.g. <C>t=1769510400,v1=9f86d0…</C></span>],
              ]}
            />
            <p>A <C>document.generated</C> body looks like:</p>
            <CodeBlock language="json" code={`{
  "documentId": "1f2dd3b4-0420-4710-8a09-77b72372a9ce",
  "templateId": "f5040b56-3fcf-497b-a0a4-25653f1f2400",
  "versionId": "9c2e1b77-1a4f-4f0e-bb02-3d5e6a7c8901",
  "status": "COMPLETED",
  "fileUrl": "/api/documents/1f2dd3b4-0420-4710-8a09-77b72372a9ce/file",
  "createdAt": "2026-07-27T10:15:32Z"
}`} />
            <p>
              Note the <C>fileUrl</C> in webhook payloads is the console path. To download with an API key,
              use <C>{'/api/v1/documents/{documentId}/file'}</C> — build it from <C>documentId</C>.
            </p>

            <h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Verifying the signature</h3>
            <p>
              Your endpoint is public, so verify every request before trusting it. At creation you're given a
              signing secret (<C>whsec_…</C>), shown once. The signature header holds a timestamp <C>t</C> and an
              HMAC-SHA256 <C>v1</C> computed over <C>{'{t}.{raw body}'}</C>.
            </p>
            <p>
              Sign the <strong className="text-zinc-800 dark:text-zinc-200">raw request body</strong>, before any
              JSON parsing — re-serializing changes the bytes and the signature won't match.
            </p>
            <CodeBlock language="javascript" code={`import crypto from 'node:crypto'

function verify(rawBody, header, secret) {
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.split('='))
  )
  const expected = crypto
    .createHmac('sha256', secret)
    .update(\`\${parts.t}.\${rawBody}\`)
    .digest('hex')

  // Constant-time compare to avoid leaking the signature via timing.
  const a = Buffer.from(expected)
  const b = Buffer.from(parts.v1 ?? '')
  if (a.length !== b.length) return false
  if (!crypto.timingSafeEqual(a, b)) return false

  // Reject anything older than 5 minutes to blunt replay attacks.
  return Math.abs(Date.now() / 1000 - Number(parts.t)) < 300
}`} />
            <CodeBlock language="java" code={`Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(secret.getBytes(UTF_8), "HmacSHA256"));
String expected = HexFormat.of().formatHex(
        mac.doFinal((timestamp + "." + rawBody).getBytes(UTF_8)));
boolean ok = MessageDigest.isEqual(
        expected.getBytes(UTF_8), receivedV1.getBytes(UTF_8));`} />

            <h3 className="pt-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">Retries</h3>
            <p>
              Any <C>2xx</C> counts as success. Anything else is retried with exponential backoff (2s, 4s, 8s …
              up to an hour) until the attempt limit, after which the delivery is abandoned. Respond quickly and
              do the real work asynchronously — the request times out after 10 seconds.
            </p>
            <p>
              Retries mean an event can arrive more than once. Make your handler idempotent, keyed on{' '}
              <C>X-Crixaa-Delivery</C>. You can inspect past attempts and their responses via{' '}
              <strong>Deliveries</strong> on each webhook in Settings → Developer.
            </p>
          </Section>

          {/* ── Rate limits ── */}
          <Section id="rate-limits" title="Rate limits">
            <p>Two limits apply to every API-key request — a per-key burst limit and a per-workspace daily limit.</p>
            <Table
              head={['Limit', 'Default', 'Set in']}
              rows={[
                ['Per key, per minute', '120 requests', 'Settings → Developer, when creating the key'],
                ['Per workspace, per day', '10,000 requests', 'Contact us to change'],
              ]}
            />
            <p>Every response carries what's left in each bucket:</p>
            <CodeBlock language="http" code={`X-RateLimit-Remaining-key: 118
X-RateLimit-Remaining-org: 9982`} />
            <p>
              Exceed either and you get <C>429 Too Many Requests</C> with a <C>Retry-After</C> header in seconds.
              Back off for that long rather than retrying immediately.
            </p>
          </Section>

          {/* ── Errors ── */}
          <Section id="errors" title="Errors">
            <p>Errors use standard HTTP status codes with a JSON body: <C>{'{ "error": "..." }'}</C>.</p>
            <Table
              head={['Status', 'Meaning', 'What to do']}
              rows={[
                [<C key="1">400</C>, 'Bad request — malformed body, or the template has no committed version.', 'Fix the request; retrying as-is will fail again.'],
                [<C key="2">401</C>, 'Missing, invalid, revoked, or expired API key.', 'Check the X-Api-Key header; rotate if needed.'],
                [<C key="3">403</C>, 'Key lacks the required scope, or the resource belongs to another workspace.', 'Grant the scope, or verify you are using the right key.'],
                [<C key="4">404</C>, 'No such template or document.', 'Check the id.'],
                [<C key="5">429</C>, 'Rate limit exceeded.', 'Wait for Retry-After, then retry.'],
                [<C key="6">5xx</C>, 'Something broke on our side.', 'Retry with backoff; contact support if it persists.'],
              ]}
            />
          </Section>
        </div>
      </div>
    </div>
  )
}
