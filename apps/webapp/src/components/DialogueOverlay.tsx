import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SceneNpc } from '../game/story/types'

type DialogueOverlayProps = {
  npc: SceneNpc | null
  visibleLine: string
  isAdvancing: boolean
  onClose: () => void
}

export const DialogueOverlay = ({ npc, visibleLine, isAdvancing, onClose }: DialogueOverlayProps) => {
  const closeRef = useRef(onClose)

  useLayoutEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        closeRef.current()
      }
    }
    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  if (!npc) return null

  const isLineComplete = visibleLine.length >= npc.openingLine.length

  return (
    <aside className="dialogue-overlay">
      <div className="dialogue-card">
        <div className="dialogue-header">
          <div>
            <p className="eyebrow">incoming message</p>
            <h2>{npc.name}</h2>
          </div>
          <button className="ghost-button" onClick={onClose} type="button" disabled={isAdvancing}>
            Esc
          </button>
        </div>

        <p className="dialogue-email">{npc.emailId}</p>
        <p className="dialogue-copy">{visibleLine}</p>

        {isLineComplete && !isAdvancing && (
          <p className="door-hint">Walk to a glowing portal and press E to choose your reply</p>
        )}

        {isAdvancing && <p className="dialogue-status">Sealing your reply through the portal...</p>}
      </div>
    </aside>
  )
}
