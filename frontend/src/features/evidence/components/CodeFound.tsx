import { useEffect, useState } from 'react'
import { getCode } from '../api'
import { isHttpUrl } from '../safeUrl'
import type { CodeEvidence, CodePieceView } from '../types'

const GITHUB_PREFIX = 'https://github.com/'
const LOAD_ERROR = "The code couldn't be loaded. Try again."

type Loaded = { state: 'loading' } | { state: 'failed' } | { state: 'ready'; data: CodeEvidence }

/** A link is shown only for a real https GitHub address. */
const isGithubUrl = (value: string): boolean => isHttpUrl(value) && value.startsWith(GITHUB_PREFIX)

function Piece({ piece }: { piece: CodePieceView }) {
  const lines = piece.code.split('\n')
  return (
    <li className="space-y-1.5 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="break-all font-medium text-slate-800">{piece.path}</span>
        <span className="text-slate-500">{`lines ${piece.startLine}–${piece.endLine}`}</span>
        {piece.quoted && <span className="rounded bg-emerald-50 px-1.5 py-0.5 font-medium text-emerald-700">Quoted</span>}
        {isGithubUrl(piece.url) && (
          <a
            href={piece.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded text-blue-600 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            Open on GitHub
          </a>
        )}
      </div>
      <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-5 text-slate-100">
        {lines.map((line, i) => (
          <span key={i} className="flex gap-3">
            <span className="w-8 shrink-0 select-none text-right text-slate-500">
              {piece.startLine + i}
            </span>
            <code className="whitespace-pre">{line}</code>
          </span>
        ))}
      </pre>
    </li>
  )
}

/** The pieces of code the AI looked at for one suggestion, loaded when it opens. */
export default function CodeFound({ suggestionId }: { suggestionId: string }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })

  useEffect(() => {
    let alive = true
    setLoaded({ state: 'loading' })
    getCode(suggestionId)
      .then((data) => {
        if (alive) setLoaded({ state: 'ready', data })
      })
      .catch(() => {
        // The reader sees the error sentence below; the detail has no use in the page.
        if (alive) setLoaded({ state: 'failed' })
      })
    return () => {
      alive = false
    }
  }, [suggestionId])

  if (loaded.state === 'loading') return <p className="text-xs text-slate-500">Loading the code…</p>
  if (loaded.state === 'failed') {
    return (
      <p role="alert" className="text-xs text-rose-600">
        {LOAD_ERROR}
      </p>
    )
  }
  if (loaded.data.pieces.length === 0) return <p className="text-xs text-slate-500">No code was kept for this suggestion.</p>
  return (
    <ul className="divide-y divide-slate-100">
      {loaded.data.pieces.map((piece) => (
        <Piece key={piece.id} piece={piece} />
      ))}
    </ul>
  )
}
