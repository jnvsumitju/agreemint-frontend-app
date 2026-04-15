import type { ReactNode } from 'react'

/**
 * Split-panel layout for auth pages.
 * Left: Brand panel with illustration.
 * Right: Auth form content.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* ── Left: Brand Panel (hidden on mobile) ── */}
      <div className="hidden w-1/2 items-center justify-center bg-gradient-to-br from-violet-600 via-violet-700 to-indigo-800 p-12 lg:flex">
        <div className="max-w-md">
          {/* Logo */}
          <div className="mb-10 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/20 backdrop-blur">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <span className="text-2xl font-bold text-white">Agreemint</span>
          </div>

          {/* Tagline */}
          <h1 className="text-3xl font-bold leading-tight text-white">
            Create, collaborate, and manage agreements effortlessly
          </h1>
          <p className="mt-4 text-base leading-relaxed text-violet-200">
            Design beautiful templates, generate PDFs, and collaborate with your team in real-time.
          </p>

          {/* Features */}
          <div className="mt-10 space-y-4">
            {features.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/15">
                  <svg className="h-3.5 w-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-white">{f.title}</p>
                  <p className="text-sm text-violet-200/80">{f.desc}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Social proof */}
          <div className="mt-12 flex items-center gap-3">
            <div className="flex -space-x-2">
              {['bg-pink-400', 'bg-sky-400', 'bg-amber-400', 'bg-emerald-400'].map((c, i) => (
                <div key={i} className={`h-8 w-8 rounded-full ${c} ring-2 ring-violet-700`} />
              ))}
            </div>
            <p className="text-sm text-violet-200">
              Join <span className="font-semibold text-white">1,000+</span> teams already using Agreemint
            </p>
          </div>
        </div>
      </div>

      {/* ── Right: Form Panel ── */}
      <div className="flex w-full flex-1 items-center justify-center bg-zinc-50 px-4 py-12 dark:bg-zinc-950 lg:w-1/2">
        <div className="w-full max-w-[420px]">
          {/* Mobile logo */}
          <div className="mb-8 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600">
              <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
              </svg>
            </div>
            <span className="text-xl font-bold text-violet-600 dark:text-violet-400">Agreemint</span>
          </div>

          {children}
        </div>
      </div>
    </div>
  )
}

const features = [
  { title: 'Visual template builder', desc: 'Drag-and-drop editor with real-time preview' },
  { title: 'Team collaboration', desc: 'Work together with roles and real-time presence' },
  { title: 'One-click PDF generation', desc: 'Generate professional documents instantly' },
]
