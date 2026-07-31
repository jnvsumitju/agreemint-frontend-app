import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { ErrorBoundary } from './components/ErrorBoundary'
import { PageLoader } from './components/ui/PageLoader'

// Auth pages (small — keep eager for instant load)
import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { OAuthCallback } from './pages/auth/OAuthCallback'
import { VerifyEmail } from './pages/auth/VerifyEmail'
import { OtpLogin } from './pages/auth/OtpLogin'
import { ImpersonateHandoff } from './pages/ImpersonateHandoff'
import { ImpersonationBanner } from './components/ImpersonationBanner'

// Layout (always needed)
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { RequireAdmin } from './components/layout/RequireAdmin'
import { AppLayout } from './components/layout/AppLayout'

// Lazy-loaded pages (code-split per route)
const TemplateList = lazy(() => import('./pages/TemplateList').then((m) => ({ default: m.TemplateList })))
const TemplateEditor = lazy(() => import('./pages/TemplateEditor').then((m) => ({ default: m.TemplateEditor })))
const Dashboard = lazy(() => import('./pages/Dashboard').then((m) => ({ default: m.Dashboard })))
const Profile = lazy(() => import('./pages/Profile').then((m) => ({ default: m.Profile })))
const Settings = lazy(() => import('./pages/Settings').then((m) => ({ default: m.Settings })))
const Marketplace = lazy(() => import('./pages/Marketplace').then((m) => ({ default: m.Marketplace })))
const Documents = lazy(() => import('./pages/Documents').then((m) => ({ default: m.Documents })))
const DocumentDetail = lazy(() => import('./pages/DocumentDetail').then((m) => ({ default: m.DocumentDetail })))
const Products = lazy(() => import('./pages/Products').then((m) => ({ default: m.Products })))
const ReviewsInbox = lazy(() => import('./pages/ReviewsInbox').then((m) => ({ default: m.ReviewsInbox })))
const Notifications = lazy(() => import('./pages/Notifications').then((m) => ({ default: m.Notifications })))
const Documentation = lazy(() => import('./pages/Documentation').then((m) => ({ default: m.Documentation })))
const NotFound = lazy(() => import('./pages/NotFound').then((m) => ({ default: m.NotFound })))

export default function App() {
  useEffect(() => {
    useAuthStore.getState().init()
  }, [])

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <Suspense fallback={<PageLoader />}>
          <Routes>
            {/* Public auth routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/oauth/callback" element={<OAuthCallback />} />
            <Route path="/verify-email" element={<VerifyEmail />} />
            <Route path="/otp-login" element={<OtpLogin />} />
            <Route path="/impersonate" element={<ImpersonateHandoff />} />

            {/* Protected routes */}
            <Route element={<ProtectedRoute />}>
              {/* With AppLayout (nav bar) */}
              <Route element={<AppLayout />}>
                {/* Dashboard is the landing page; "/" is kept as a redirect so
                    existing links and post-login navigate('/') still work. */}
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/templates" element={<TemplateList />} />
                <Route path="/profile" element={<Profile />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/documents" element={<Documents />} />
                <Route path="/documents/:documentId" element={<DocumentDetail />} />
                <Route path="/products" element={<Products />} />
                <Route path="/reviews" element={<ReviewsInbox />} />
                <Route path="/notifications" element={<Notifications />} />

                {/* Org ADMIN only — the nav entry is hidden for everyone else,
                    and this guard blocks the deep link too. */}
                <Route element={<RequireAdmin />}>
                  <Route path="/documentation" element={<Documentation />} />
                </Route>

                {/* Catch-all: keep the nav bar so a bad URL isn't a dead end. */}
                <Route path="*" element={<NotFound />} />
              </Route>

              {/* Full-screen (no nav bar). The impersonation banner is mounted
                  explicitly because this route sits outside AppLayout — and it
                  is precisely where impersonated edits get made, so it is the
                  last screen that should be missing it. It also carries the TTL
                  countdown and auto-logout, which otherwise stopped running the
                  moment the operator opened a template. */}
              <Route
                path="/editor/:templateId"
                element={
                  <div className="flex h-screen flex-col overflow-hidden">
                    <ImpersonationBanner />
                    {/* h-full, not h-screen: TemplateEditor's own root used to
                        claim 100vh, so with the banner above it the page grew
                        taller than the viewport and the status bar fell off the
                        bottom — taking the deliberately-permanent banner out of
                        view whenever you scrolled to reach it. */}
                    <div className="min-h-0 flex-1"><TemplateEditor /></div>
                  </div>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  )
}
