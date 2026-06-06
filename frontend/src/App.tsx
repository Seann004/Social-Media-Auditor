import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './layouts/Layout'
import ProtectedRoute from './layouts/ProtectedRoute'
import LoginPage from './features/auth/pages/LoginPage'
import RegisterPage from './features/auth/pages/RegisterPage'
import DashboardPage from './features/dashboard/pages/DashboardPage'
import ProjectsPage from './features/projects/pages/ProjectsPage'
import CreateProjectPage from './features/projects/pages/CreateProjectPage'
import AuditPage from './features/audits/pages/AuditPage'
import GuidelinesPage from './features/guidelines/pages/GuidelinesPage'
import ReportsPage from './features/reports/pages/ReportsPage'
import GeneratorPage from './features/generator/pages/GeneratorPage'

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/new" element={<CreateProjectPage />} />
            <Route path="/projects/:id" element={<AuditPage />} />
            <Route path="/guidelines" element={<GuidelinesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/generator" element={<GeneratorPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
