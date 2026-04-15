import { useEffect } from 'react'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'

// Auth pages
import { Login } from './pages/auth/Login'
import { Register } from './pages/auth/Register'
import { ForgotPassword } from './pages/auth/ForgotPassword'
import { ResetPassword } from './pages/auth/ResetPassword'
import { OAuthCallback } from './pages/auth/OAuthCallback'

// Layout
import { ProtectedRoute } from './components/layout/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'

// Pages
import { TemplateList } from './pages/TemplateList'
import { TemplateEditor } from './pages/TemplateEditor'
import { Dashboard } from './pages/Dashboard'
import { Profile } from './pages/Profile'
import { Settings } from './pages/Settings'
import { Marketplace } from './pages/Marketplace'

export default function App() {
  useEffect(() => {
    useAuthStore.getState().init()
  }, [])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public auth routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/oauth/callback" element={<OAuthCallback />} />

        {/* Protected routes */}
        <Route element={<ProtectedRoute />}>
          {/* With AppLayout (nav bar) */}
          <Route element={<AppLayout />}>
            <Route path="/" element={<TemplateList />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/marketplace" element={<Marketplace />} />
          </Route>

          {/* Full-screen (no nav bar) */}
          <Route path="/editor/:templateId" element={<TemplateEditor />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
