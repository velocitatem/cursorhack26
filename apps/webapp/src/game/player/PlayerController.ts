import * as THREE from 'three'
import { createCharacterRig } from '../characters/createCharacterRig'
import type { CharacterAnimationState } from '../characters/types'
import type { WorldBounds } from '../world/terrain'

const up = new THREE.Vector3(0, 1, 0)
const normalizeAngle = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle))

type MovementKey = 'forward' | 'back' | 'left' | 'right'

export class PlayerController {
  readonly group = new THREE.Group()
  private readonly rig = createCharacterRig('player', {
    name: 'You',
    shirtColor: 0x4d7fff,
    pantsColor: 0x1a2436,
    accentColor: 0xcfe0ff,
  })

  private readonly movement = {
    forward: false,
    back: false,
    left: false,
    right: false,
  }
  private readonly desiredMove = new THREE.Vector3()
  private readonly lateral = new THREE.Vector3()
  private readonly facing = new THREE.Vector3(0, 0, 1)

  private enabled = true
  private dialogueOpen = false
  private interactQueued = false
  private interactAnimationQueued = false
  private interactAnimationUntil = 0
  private moveStartUntil = 0
  private turnAnimationUntil = 0
  private turnAnimationState: CharacterAnimationState = 'idle'
  private wasMoving = false
  private lastFacingAngle: number | null = null
  private bounds: WorldBounds = {
    minX: -12,
    maxX: 12,
    minZ: -12,
    maxZ: 12,
  }

  constructor() {
    this.group.add(this.rig.group)
    this.group.position.set(0, 0, 8)

    window.addEventListener('keydown', this.handleKeyDown)
    window.addEventListener('keyup', this.handleKeyUp)
  }

  private setMovement(key: MovementKey, active: boolean) {
    this.movement[key] = active
  }

  private handleKeyDown = (event: KeyboardEvent) => {
    switch (event.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        event.preventDefault()
        this.setMovement('forward', true)
        break
      case 's':
      case 'arrowdown':
        event.preventDefault()
        this.setMovement('back', true)
        break
      case 'a':
      case 'arrowleft':
        event.preventDefault()
        this.setMovement('left', true)
        break
      case 'd':
      case 'arrowright':
        event.preventDefault()
        this.setMovement('right', true)
        break
      case 'e':
        if (this.enabled && !event.repeat) {
          this.interactQueued = true
          this.interactAnimationQueued = true
        }
        break
      default:
        break
    }
  }

  private handleKeyUp = (event: KeyboardEvent) => {
    switch (event.key.toLowerCase()) {
      case 'w':
      case 'arrowup':
        event.preventDefault()
        this.setMovement('forward', false)
        break
      case 's':
      case 'arrowdown':
        event.preventDefault()
        this.setMovement('back', false)
        break
      case 'a':
      case 'arrowleft':
        event.preventDefault()
        this.setMovement('left', false)
        break
      case 'd':
      case 'arrowright':
        event.preventDefault()
        this.setMovement('right', false)
        break
      default:
        break
    }
  }

  private clearMovement() {
    this.movement.forward = false
    this.movement.back = false
    this.movement.left = false
    this.movement.right = false
  }

  setBounds(bounds: WorldBounds) {
    this.bounds = bounds
  }

  setEnabled(active: boolean) {
    this.enabled = active
    if (!active) {
      this.clearMovement()
    }
  }

  setDialogueOpen(active: boolean) {
    this.dialogueOpen = active
  }

  setPosition(position: THREE.Vector3Like) {
    this.group.position.set(position.x, position.y, position.z)
    this.wasMoving = false
    this.lastFacingAngle = null
    this.moveStartUntil = 0
    this.turnAnimationUntil = 0
    this.turnAnimationState = 'idle'
    this.interactAnimationUntil = 0
    this.interactAnimationQueued = false
  }

  getPosition(target = new THREE.Vector3()) {
    return target.copy(this.group.position)
  }

  getFocusPoint(target = new THREE.Vector3()) {
    return target.copy(this.group.position).add(new THREE.Vector3(0, 0.9, 0))
  }

  getForwardVector(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y))
  }

  consumeInteract() {
    const value = this.interactQueued
    this.interactQueued = false
    return value
  }

  private resolveAnimationState(now: number, isMoving: boolean): CharacterAnimationState {
    if (now < this.interactAnimationUntil) {
      return 'interact'
    }

    if (this.dialogueOpen) {
      return 'dialogue'
    }

    if (isMoving && now < this.turnAnimationUntil && this.turnAnimationState !== 'idle') {
      return this.turnAnimationState
    }

    if (isMoving && now < this.moveStartUntil) {
      return 'moveStart'
    }

    if (isMoving) {
      return 'moveLoop'
    }

    return 'idle'
  }

  update(delta: number, cameraForward: THREE.Vector3, elapsed: number) {
    if (this.interactAnimationQueued) {
      this.interactAnimationQueued = false
      this.interactAnimationUntil = Math.max(this.interactAnimationUntil, elapsed + 0.72)
    }

    if (!this.enabled) {
      this.rig.setAnimationState(this.resolveAnimationState(elapsed, false))
      this.rig.update(delta, elapsed)
      return
    }

    this.desiredMove.set(0, 0, 0)

    if (this.movement.forward) {
      this.desiredMove.add(cameraForward)
    }
    if (this.movement.back) {
      this.desiredMove.sub(cameraForward)
    }

    this.lateral.crossVectors(cameraForward, up).normalize()

    if (this.movement.right) {
      this.desiredMove.add(this.lateral)
    }
    if (this.movement.left) {
      this.desiredMove.sub(this.lateral)
    }

    const isMoving = this.desiredMove.lengthSq() > 0.0001

    if (isMoving) {
      this.desiredMove.normalize()
      this.group.position.addScaledVector(this.desiredMove, delta * 4.75)
      this.group.position.x = THREE.MathUtils.clamp(
        this.group.position.x,
        this.bounds.minX,
        this.bounds.maxX,
      )
      this.group.position.z = THREE.MathUtils.clamp(
        this.group.position.z,
        this.bounds.minZ,
        this.bounds.maxZ,
      )

      this.facing.copy(this.desiredMove)
      this.group.rotation.y = Math.atan2(this.facing.x, this.facing.z)

      const heading = this.group.rotation.y
      if (!this.wasMoving) {
        this.moveStartUntil = elapsed + 0.46
      } else if (this.lastFacingAngle !== null) {
        const angleDelta = normalizeAngle(heading - this.lastFacingAngle)
        const absAngleDelta = Math.abs(angleDelta)

        if (absAngleDelta > 2.2) {
          this.turnAnimationState = 'turnAround'
          this.turnAnimationUntil = elapsed + 0.64
        } else if (angleDelta > 0.72) {
          this.turnAnimationState = 'turnRight'
          this.turnAnimationUntil = elapsed + 0.42
        } else if (angleDelta < -0.72) {
          this.turnAnimationState = 'turnLeft'
          this.turnAnimationUntil = elapsed + 0.42
        }
      }

      this.lastFacingAngle = heading
    } else {
      this.lastFacingAngle = null
    }

    this.rig.setAnimationState(this.resolveAnimationState(elapsed, isMoving))
    this.rig.update(delta, elapsed)
    this.wasMoving = isMoving
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.rig.dispose()
  }
}
