import { Navigate, Outlet } from 'react-router-dom'
import { useStore } from '../store/useStore'

interface RoleRouteProps {
  allowedRoles: string[]
}

export default function RoleRoute({ allowedRoles }: RoleRouteProps) {
  const { users, currentUserId, isAuthenticated } = useStore()
  const user = users.find((u) => u.id === currentUserId)

  if (!isAuthenticated) {
    return <Navigate to="/" replace />
  }

  if (!user || !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return <Outlet />
}
