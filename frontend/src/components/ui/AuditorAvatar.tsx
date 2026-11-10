import type { User } from '../../types'

interface Props {
  user: User
  size?: 'xs' | 'sm' | 'md'
  showName?: boolean
}

const SIZES = {
  xs: 'w-6 h-6 text-2xs',
  sm: 'w-7 h-7 text-2xs',
  md: 'w-9 h-9 text-2xs',
}

export default function AuditorAvatar({ user, size = 'sm', showName = false }: Props) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <div
        title={user.name}
        className={`${SIZES[size]} ${user.color} rounded-full flex items-center justify-center shrink-0`}
      >
        <span className="text-white font-bold">{user.initials}</span>
      </div>
      {showName && (
        <span className="text-slate-700 text-sm truncate">{user.name}</span>
      )}
    </div>
  )
}