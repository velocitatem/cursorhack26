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
  private readonly touchMove = new THREE.Vector2()
  private readonly probe = new THREE.Vector2()

  private enabled = true
  private interactQueued = false
  private bounds: WorldBounds = {
    minX: -12,
    maxX: 12,
    minZ: -12,
    maxZ: 12,
  }
  private collisionCells = new Set<string>()

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
        if (!event.repeat) this.queueInteract()
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

  setMoveInput(x: number, y: number) {
    this.touchMove.set(
      THREE.MathUtils.clamp(x, -1, 1),
      THREE.MathUtils.clamp(y, -1, 1),
    )
  }

  clearMoveInput() {
    this.touchMove.set(0, 0)
  }

  queueInteract() {
    if (this.enabled) {
      this.interactQueued = true
    }
  }

  setBounds(bounds: WorldBounds) {
    this.bounds = bounds
  }

  setCollisionCells(cells: Set<string>) {
    this.collisionCells = cells
  }

  setEnabled(active: boolean) {
    this.enabled = active
    if (!active) {
      this.clearMovement()
      this.clearMoveInput()
    }
  }

  setPosition(position: THREE.Vector3Like) {
    this.group.position.set(position.x, position.y, position.z)
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

  update(delta: number, cameraForward: THREE.Vector3, elapsed: number) {
    if (!this.enabled) {
      this.rig.update(elapsed, 0)
      return
    }

    this.desiredMove.set(0, 0, 0)
    const forwardInput =
      (this.movement.forward ? 1 : 0) -
      (this.movement.back ? 1 : 0) +
      this.touchMove.y
    const lateralInput =
      (this.movement.right ? 1 : 0) -
      (this.movement.left ? 1 : 0) +
      this.touchMove.x

    if (forwardInput !== 0) this.desiredMove.addScaledVector(cameraForward, forwardInput)

    this.lateral.crossVectors(cameraForward, up).normalize()

    if (lateralInput !== 0) this.desiredMove.addScaledVector(this.lateral, lateralInput)

    const isMoving = this.desiredMove.lengthSq() > 0.0001

    if (isMoving) {
      this.desiredMove.normalize()
      const nextX = THREE.MathUtils.clamp(
        this.group.position.x + this.desiredMove.x * delta * 4.75,
        this.bounds.minX,
        this.bounds.maxX,
      )
      const nextZ = THREE.MathUtils.clamp(
        this.group.position.z + this.desiredMove.z * delta * 4.75,
        this.bounds.minZ,
        this.bounds.maxZ,
      )
      if (!this.hasCollision(nextX, this.group.position.z)) {
        this.group.position.x = nextX
      }
      if (!this.hasCollision(this.group.position.x, nextZ)) {
        this.group.position.z = nextZ
      }

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

  private hasCollision(x: number, z: number) {
    if (!this.collisionCells.size) {
      return false
    }
    const radius = 0.28
    const minX = Math.floor(x - radius - 0.5)
    const maxX = Math.ceil(x + radius + 0.5)
    const minZ = Math.floor(z - radius - 0.5)
    const maxZ = Math.ceil(z + radius + 0.5)
    for (let cx = minX; cx <= maxX; cx += 1) {
      for (let cz = minZ; cz <= maxZ; cz += 1) {
        if (!this.collisionCells.has(`${cx},${cz}`)) {
          continue
        }
        if (this.intersectsCell(x, z, radius, cx, cz)) {
          return true
        }
      }
    }
    return false
  }

  private intersectsCell(px: number, pz: number, radius: number, cellX: number, cellZ: number) {
    const nearestX = THREE.MathUtils.clamp(px, cellX - 0.5, cellX + 0.5)
    const nearestZ = THREE.MathUtils.clamp(pz, cellZ - 0.5, cellZ + 0.5)
    this.probe.set(px - nearestX, pz - nearestZ)
    return this.probe.lengthSq() < radius * radius
  }
}
