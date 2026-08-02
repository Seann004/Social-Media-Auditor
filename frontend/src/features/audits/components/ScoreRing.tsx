import { useEffect, useState } from 'react'
import { scoreColor, formatPercent } from '../../../lib/scoreColor'

interface Props {
  percentage: number
  size?: number
  strokeWidth?: number
  showLabel?: boolean
}

export default function ScoreRing({ percentage, size = 72, strokeWidth = 6, showLabel = true }: Props) {
  const [displayed, setDisplayed] = useState(0)

  useEffect(() => {
    const id = requestAnimationFrame(() => setDisplayed(percentage))
    return () => cancelAnimationFrame(id)
  }, [percentage])

  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - displayed / 100)
  const color = scoreColor(percentage).hex

  return (
    <div className="flex flex-col items-center gap-0.5">
      <svg
        width={size}
        height={size}
        style={{ transform: 'rotate(-90deg)' }}
        aria-label={`Compliance score: ${formatPercent(percentage)}%`}
        role="img"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 1.1s cubic-bezier(0.16,1,0.3,1)' }}
        />
      </svg>
      {showLabel && (
        <p className="font-mono text-sm font-semibold text-slate-800 tabular-nums">
          {formatPercent(percentage)}%
        </p>
      )}
    </div>
  )
}