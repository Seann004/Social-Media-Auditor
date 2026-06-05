import { Navigate, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'

export default function ProtectedRoute() {
  const isAuthenticated = useStore((s) => s.isAuthenticated)
  return isAuthenticated ? <Outlet /> : <Navigate to="/" replace />
}
