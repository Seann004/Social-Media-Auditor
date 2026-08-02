import { Navigate, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'

interface RoleRouteProps {
  allowedRoles: string[]
}

export default function RoleRoute({ allowedRoles }: RoleRouteProps) {
  const { users, currentUserId, isAuthenticated } = useStore()
  const user = users.find((u) => u.id === currentUserId)

  // 1. Kick out completely if not logged in
  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  // 2. Kick back to dashboard if they don't have the right role
  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  // 3. Let them through!
  return <Outlet />
}
