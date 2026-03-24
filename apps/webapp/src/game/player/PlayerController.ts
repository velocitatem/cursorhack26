import * as THREE from 'three'
import { createVoxelCharacter } from '../characters/createVoxelCharacter'
import type { WorldBounds } from '../world/terrain'

const up = new THREE.Vector3(0, 1, 0)

type MovementKey = 'forward' | 'back' | 'left' | 'right'

export class PlayerController {
  readonly group = new THREE.Group()
  private readonly rig = createVoxelCharacter({
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
  private interactQueued = false
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

  setPosition(position: THREE.Vector3Like) {
    this.group.position.set(position.x, position.y, position.z)
  }

  getPosition(target = new THREE.Vector3()) {
    return target.copy(this.group.position)
  }

  getFocusPoint(target = new THREE.Vector3()) {
    return target.copy(this.group.position).add(new THREE.Vector3(0, 1.4, 0))
  }

  getForwardVector(target = new THREE.Vector3()) {
    return target.set(Math.sin(this.group.rotation.y), 0, Math.cos(this.group.rotation.y))
  }

  consumeInteract() {
    const value = this.interactQueued
    this.interactQueued = false
    return value
  }

  update(delta: number, cameraForward: THREE.Vector3, elapsed: number) {
    if (!this.enabled) {
      this.rig.update(elapsed, 0)
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
    }

    this.rig.update(elapsed, isMoving ? 1 : 0)
  }

  destroy() {
    window.removeEventListener('keydown', this.handleKeyDown)
    window.removeEventListener('keyup', this.handleKeyUp)
    this.rig.dispose()
  }
}
