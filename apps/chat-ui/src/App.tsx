import { Routes, Route } from 'react-router-dom'
import ChatPage from './pages/ChatPage'
import HealthPage from './pages/HealthPage'

export default function App() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <Routes>
        <Route path="/" element={<ChatPage />} />
        <Route path="/health" element={<HealthPage />} />
      </Routes>
    </div>
  )
}
