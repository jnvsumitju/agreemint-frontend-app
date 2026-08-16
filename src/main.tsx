import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { initDarkMode } from './lib/darkMode'
import { ToastProvider } from './components/ui/Toast'
import { ConfirmProvider } from './components/ui/ConfirmDialog'
import App from './App.tsx'

initDarkMode()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <App />
      </ConfirmProvider>
    </ToastProvider>
  </StrictMode>,
)
