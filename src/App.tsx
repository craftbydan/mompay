import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { HomePage } from './pages/HomePage'
import { MePage } from './pages/MePage'
import { MomPage } from './pages/MomPage'
import { ReportDetailPage } from './pages/ReportDetailPage'
import { ReportPage } from './pages/ReportPage'
import { MerchantsPage } from './pages/MerchantsPage'
import { MeGuard } from './components/MeGuard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/me" element={<MeGuard><MePage /></MeGuard>} />
        <Route path="/me/merchants" element={<MeGuard><MerchantsPage /></MeGuard>} />
        <Route path="/me/report/:id" element={<MeGuard><ReportDetailPage /></MeGuard>} />
        <Route path="/mom" element={<MomPage />} />
        <Route path="/report/:token" element={<ReportPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
