import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { TemplateList } from './pages/TemplateList'
import { TemplateEditor } from './pages/TemplateEditor'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<TemplateList />} />
        <Route path="/editor/:templateId" element={<TemplateEditor />} />
      </Routes>
    </BrowserRouter>
  )
}
