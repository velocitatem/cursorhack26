import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'

type MobileControlsProps = {
  canInteract: boolean
  interactLabel: string
  disabled?: boolean
  onMoveInput: (x: number, y: number) => void
  onMoveEnd: () => void
  onInteract: () => void
}

type StickOffset = {
  x: number
  y: number
  active: boolean
}

const idleOffset: StickOffset = { x: 0, y: 0, active: false }

export const MobileControls = ({
  canInteract,
  interactLabel,
  disabled = false,
  onMoveInput,
  onMoveEnd,
  onInteract,
}: MobileControlsProps) => {
  const pointerIdRef = useRef<number | null>(null)
  const radiusRef = useRef(1)
  const centerRef = useRef({ x: 0, y: 0 })
  const [offset, setOffset] = useState<StickOffset>(idleOffset)

  const endMove = useCallback(() => {
    pointerIdRef.current = null
    setOffset(idleOffset)
    onMoveEnd()
  }, [onMoveEnd])

  const updateOffset = useCallback(
    (clientX: number, clientY: number) => {
      const dx = clientX - centerRef.current.x
      const dy = clientY - centerRef.current.y
      const distance = Math.hypot(dx, dy)
      const radius = radiusRef.current
      const scale = distance > radius ? radius / distance : 1
      const clampedX = dx * scale
      const clampedY = dy * scale

      setOffset({ x: clampedX, y: clampedY, active: true })
      onMoveInput(clampedX / radius, -clampedY / radius)
    },
    [onMoveInput],
  )

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (disabled) {
        return
      }

      const bounds = event.currentTarget.getBoundingClientRect()
      centerRef.current = {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.height / 2,
      }
      radiusRef.current = Math.max(bounds.width / 2 - 28, 1)
      pointerIdRef.current = event.pointerId
      event.currentTarget.setPointerCapture(event.pointerId)
      updateOffset(event.clientX, event.clientY)
    },
    [disabled, updateOffset],
  )

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== pointerIdRef.current || disabled) {
        return
      }

      updateOffset(event.clientX, event.clientY)
    },
    [disabled, updateOffset],
  )

  const handlePointerEnd = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.pointerId !== pointerIdRef.current) {
        return
      }

      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      endMove()
    },
    [endMove],
  )

  useEffect(() => onMoveEnd, [onMoveEnd])

  return (
    <div className="mobile-controls" aria-label="Mobile controls">
      <div className="mobile-controls-cluster">
        <div
          aria-label="Movement joystick"
          className="mobile-joystick"
          onContextMenu={event => event.preventDefault()}
          onPointerCancel={handlePointerEnd}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          role="presentation"
        >
          <div className={`mobile-joystick-base${offset.active ? ' mobile-joystick-base-active' : ''}`}>
            <div
              className="mobile-joystick-thumb"
              style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
            />
          </div>
        </div>
      </div>

      <div className="mobile-controls-cluster mobile-controls-cluster-end">
        <button
          className="mobile-talk-button"
          disabled={disabled || !canInteract}
          onClick={onInteract}
          type="button"
        >
          <span className="mobile-control-kicker">Action</span>
          <strong>{canInteract ? interactLabel : 'Move closer'}</strong>
        </button>
      </div>
    </div>
  )
}
