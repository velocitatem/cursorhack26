import { useEffect, useLayoutEffect, useRef } from 'react'
import type { SceneNpc } from '../game/story/types'

type DialogueOverlayProps = {
  npc: SceneNpc | null
  visibleLine: string
  isAdvancing: boolean
  onClose: () => void
  onChoose: (choiceId: string) => void
}

type DialogueState = {
  npc: SceneNpc | null
  isAdvancing: boolean
  onClose: () => void
  onChoose: (choiceId: string) => void
}

export const DialogueOverlay = ({
  npc,
  visibleLine,
  isAdvancing,
  onClose,
  onChoose,
}: DialogueOverlayProps) => {
  const stateRef = useRef<DialogueState>({ npc, isAdvancing, onClose, onChoose })

  useLayoutEffect(() => {
    stateRef.current = { npc, isAdvancing, onClose, onChoose }
  })

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const { npc: current, isAdvancing: busy, onClose: close, onChoose: choose } =
        stateRef.current

      if (!current || busy) return

      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        close()
        return
      }

      const digit = e.key.charCodeAt(0) - 48
      if (digit >= 1 && digit <= current.choices.length && e.key.length === 1) {
        e.preventDefault()
        e.stopImmediatePropagation()
        choose(current.choices[digit - 1].id)
      }
    }

    window.addEventListener('keydown', handler, true)
    return () => window.removeEventListener('keydown', handler, true)
  }, [])

  if (!npc) {
    return null
  }

  return (
    <aside className="dialogue-overlay">
      <div className="dialogue-card">
        <div className="dialogue-header">
          <div>
            <p className="eyebrow">NPC dialogue</p>
            <h2>{npc.name}</h2>
          </div>
          <button
            className="ghost-button"
            onClick={onClose}
            type="button"
            disabled={isAdvancing}
          >
            Esc
          </button>
        </div>

        <p className="dialogue-email">Email thread: {npc.emailId}</p>
        <p className="dialogue-copy">{visibleLine}</p>

        {npc.choices.length ? (
          <div className="choice-list">
            {npc.choices.map((choice, index) => (
              <button
                className="choice-card"
                key={choice.id}
                onClick={() => onChoose(choice.id)}
                type="button"
                disabled={isAdvancing}
              >
                <span className="choice-key">{index + 1}</span>
                <div className="choice-body">
                  <span className="choice-title">{choice.label}</span>
                  <span className="choice-preview">{choice.previewReply}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <p className="dialogue-status">No more branching choices here. Use the HUD to resolve the draft bundle.</p>
        )}

        {isAdvancing ? (
          <p className="dialogue-status">Locking in the route...</p>
        ) : null}
      </div>
    </aside>
  )
}
