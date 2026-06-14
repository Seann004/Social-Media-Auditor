import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './layouts/Layout'
import ProtectedRoute from './layouts/ProtectedRoute'
import RoleRoute from './layouts/RoleRoute'
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
        {/* Public Routes */}
        <Route path="/" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        
        {/* Base Protected Route (Just checks if logged in) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout />}>
            {/* Everyone gets a Dashboard */}
            <Route path="/dashboard" element={<DashboardPage />} />
            
            {/* Admin Only Routes */}
            <Route element={<RoleRoute allowedRoles={['admin']} />}>
              <Route path="/generator" element={<GeneratorPage />} />
            </Route>
            
            {/* Head Auditor & Auditor Routes */}
            <Route element={<RoleRoute allowedRoles={['head_auditor', 'auditor']} />}>
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/:id" element={<AuditPage />} />
              <Route path="/reports" element={<ReportsPage />} />
            </Route>
            
            {/* Head Auditor ONLY Routes */}
            <Route element={<RoleRoute allowedRoles={['head_auditor']} />}>
              <Route path="/projects/new" element={<CreateProjectPage />} />
              <Route path="/guidelines" element={<GuidelinesPage />} />
            </Route>
          </Route>
        </Route>
        
        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
