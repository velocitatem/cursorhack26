import * as THREE from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { createWorld, type WorldContext } from '../core/createWorld'
import { InteractionSystem } from '../interaction/InteractionSystem'
import { NpcManager } from '../npc/NpcManager'
import { PlayerController } from '../player/PlayerController'
import type { SceneNpc, ScenePayload } from '../story/types'
import type { WorldBounds } from '../world/terrain'
import { buildDemoMap } from '../world/buildDemoMap'

export type GameRuntimeCallbacks = {
  onNpcInteract?: (npc: SceneNpc) => void
  onInteractionTargetChange?: (npc: SceneNpc | null) => void
}

export class GameRuntime {
  private readonly world: WorldContext
  private readonly player = new PlayerController()
  private readonly followCamera: FollowCamera
  private readonly npcManager: NpcManager
  private readonly interactionSystem = new InteractionSystem()
  private readonly clock = new THREE.Clock()
  private readonly playerPosition = new THREE.Vector3()
  private readonly playerFocus = new THREE.Vector3()
  private readonly playerForward = new THREE.Vector3()
  private readonly cameraForward = new THREE.Vector3()

  private callbacks: GameRuntimeCallbacks
  private animationFrame = 0
  private mapGroup: THREE.Group | null = null
  private mapSignature: string | null = null
  private currentBounds: WorldBounds = {
    minX: -12,
    maxX: 12,
    minZ: -12,
    maxZ: 12,
  }
  private currentCollisionCells = new Set<string>()
  private dialogueOpen = false
  private activeNpcId: string | null = null
  private hoveredNpcId: string | null = null

  constructor(container: HTMLElement, callbacks: GameRuntimeCallbacks = {}) {
    this.callbacks = callbacks
    this.world = createWorld(container)
    this.followCamera = new FollowCamera(
      this.world.camera,
      this.world.renderer.domElement,
    )
    this.npcManager = new NpcManager(this.world.scene)

    this.world.scene.add(this.player.group)
    this.followCamera.syncToTarget(this.player.getFocusPoint(this.playerFocus))
    this.animate()
  }

  setCallbacks(callbacks: GameRuntimeCallbacks) {
    this.callbacks = callbacks
    this.callbacks.onInteractionTargetChange?.(
      this.hoveredNpcId ? this.npcManager.getById(this.hoveredNpcId)?.data ?? null : null,
    )
  }

  setScene(scene: ScenePayload) {
    this.world.setTheme(scene.environment.theme)

    const mapSignature = scene.environment.layout
      ? `${scene.environment.theme}:${scene.environment.layout.seed}:${scene.world?.locationId ?? scene.sceneId}`
      : `${scene.environment.theme}`
    const shouldResetPlayer = this.mapSignature !== mapSignature || !this.mapGroup
    if (shouldResetPlayer) {
      this.mapGroup?.removeFromParent()

      const map = buildDemoMap(scene.environment.theme, scene.environment.layout)
      this.mapGroup = map.group
      this.mapSignature = mapSignature
      this.currentBounds = map.bounds
      this.currentCollisionCells = map.collisionCells
      this.player.setBounds(this.currentBounds)
      this.player.setCollisionCells(this.currentCollisionCells)
      this.world.scene.add(map.group)
    }

    if (shouldResetPlayer) {
      this.player.setPosition(
        this.resolveSpawnPoint(
          scene.environment.spawn,
          this.currentBounds,
          this.currentCollisionCells,
        ),
      )
      this.followCamera.syncToTarget(this.player.getFocusPoint(this.playerFocus))
    }
    this.npcManager.setScene(
      this.arrangeNpcPositions(
        scene.npcs,
        this.currentBounds,
        this.currentCollisionCells,
      ),
    )
    this.activeNpcId = null
    this.hoveredNpcId = null
    this.callbacks.onInteractionTargetChange?.(null)
  }

  setDialogueOpen(active: boolean) {
    this.dialogueOpen = active
    this.player.setEnabled(!active)
    this.followCamera.setEnabled(!active)
    if (active) {
      this.setHoveredNpc(null)
    }
  }

  setActiveNpc(id: string | null) {
    this.activeNpcId = id
    this.npcManager.setHighlighted(id)
  }

  setMoveInput(x: number, y: number) {
    this.player.setMoveInput(x, y)
  }

  clearMoveInput() {
    this.player.clearMoveInput()
  }

  interact() {
    this.player.queueInteract()
  }

  private setHoveredNpc(npc: ReturnType<InteractionSystem['findTarget']>) {
    const nextId = npc?.data.id ?? null
    if (nextId === this.hoveredNpcId) {
      return
    }

    this.hoveredNpcId = nextId
    this.npcManager.setInteractHint(this.dialogueOpen ? null : nextId)
    this.callbacks.onInteractionTargetChange?.(npc?.data ?? null)
  }

  private hasSpawnCollision(collisionCells: Set<string>, x: number, z: number) {
    return collisionCells.has(`${Math.round(x)},${Math.round(z)}`)
  }

  private tileKey(x: number, z: number) {
    return `${Math.round(x)},${Math.round(z)}`
  }

  private isBlockedTile(
    collisionCells: Set<string>,
    occupied: Set<string>,
    x: number,
    z: number,
  ) {
    const key = this.tileKey(x, z)
    return collisionCells.has(key) || occupied.has(key)
  }

  private findNearestFreeTile(
    preferredX: number,
    preferredZ: number,
    bounds: WorldBounds,
    collisionCells: Set<string>,
    occupied: Set<string>,
  ) {
    const originX = THREE.MathUtils.clamp(Math.round(preferredX), bounds.minX, bounds.maxX)
    const originZ = THREE.MathUtils.clamp(Math.round(preferredZ), bounds.minZ, bounds.maxZ)

    if (!this.isBlockedTile(collisionCells, occupied, originX, originZ)) {
      return { x: originX, z: originZ }
    }

    const maxRadius = Math.max(
      3,
      Math.min(24, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)),
    )

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetZ = -radius; offsetZ <= radius; offsetZ += 1) {
          if (Math.abs(offsetX) !== radius && Math.abs(offsetZ) !== radius) {
            continue
          }

          const candidateX = THREE.MathUtils.clamp(originX + offsetX, bounds.minX, bounds.maxX)
          const candidateZ = THREE.MathUtils.clamp(originZ + offsetZ, bounds.minZ, bounds.maxZ)
          if (!this.isBlockedTile(collisionCells, occupied, candidateX, candidateZ)) {
            return { x: candidateX, z: candidateZ }
          }
        }
      }
    }

    return { x: originX, z: originZ }
  }

  private arrangeNpcPositions(
    npcs: SceneNpc[],
    bounds: WorldBounds,
    collisionCells: Set<string>,
  ) {
    if (!npcs.length) {
      return npcs
    }

    const occupied = new Set<string>()
    const arranged: SceneNpc[] = []

    for (const npc of npcs) {
      const nextPosition = this.findNearestFreeTile(
        npc.position.x,
        npc.position.z,
        bounds,
        collisionCells,
        occupied,
      )
      occupied.add(this.tileKey(nextPosition.x, nextPosition.z))

      if (
        Math.round(npc.position.x) === nextPosition.x
        && Math.round(npc.position.z) === nextPosition.z
      ) {
        arranged.push(npc)
        continue
      }

      arranged.push({
        ...npc,
        position: {
          ...npc.position,
          x: nextPosition.x,
          z: nextPosition.z,
        },
      })
    }

    return arranged
  }

  private resolveSpawnPoint(
    spawn: ScenePayload['environment']['spawn'],
    bounds: WorldBounds,
    collisionCells: Set<string>,
  ) {
    const clampedX = THREE.MathUtils.clamp(spawn.x, bounds.minX, bounds.maxX)
    const clampedZ = THREE.MathUtils.clamp(spawn.z, bounds.minZ, bounds.maxZ)

    if (!this.hasSpawnCollision(collisionCells, clampedX, clampedZ)) {
      return { x: clampedX, y: spawn.y, z: clampedZ }
    }

    const originX = Math.round(clampedX)
    const originZ = Math.round(clampedZ)
    const maxRadius = Math.max(
      2,
      Math.min(20, Math.max(bounds.maxX - bounds.minX, bounds.maxZ - bounds.minZ)),
    )

    for (let radius = 1; radius <= maxRadius; radius += 1) {
      for (let offsetX = -radius; offsetX <= radius; offsetX += 1) {
        for (let offsetZ = -radius; offsetZ <= radius; offsetZ += 1) {
          if (Math.abs(offsetX) !== radius && Math.abs(offsetZ) !== radius) {
            continue
          }

          const candidateX = THREE.MathUtils.clamp(
            originX + offsetX,
            bounds.minX,
            bounds.maxX,
          )
          const candidateZ = THREE.MathUtils.clamp(
            originZ + offsetZ,
            bounds.minZ,
            bounds.maxZ,
          )

          if (!this.hasSpawnCollision(collisionCells, candidateX, candidateZ)) {
            return {
              x: candidateX,
              y: spawn.y,
              z: candidateZ,
            }
          }
        }
      }
    }

    return { x: clampedX, y: spawn.y, z: clampedZ }
  }

  private animate = () => {
    this.animationFrame = window.requestAnimationFrame(this.animate)

    const delta = Math.min(this.clock.getDelta(), 0.05)
    const elapsed = this.clock.elapsedTime
    const wantsInteract = this.player.consumeInteract()

    this.player.update(
      delta,
      this.followCamera.getPlanarForward(this.cameraForward),
      elapsed,
    )

    this.player.getPosition(this.playerPosition)
    this.npcManager.update(elapsed, this.playerPosition)
    this.followCamera.update(this.player.getFocusPoint(this.playerFocus))
    this.world.update(elapsed, delta)

    const hoveredNpc = this.dialogueOpen
      ? null
      : this.interactionSystem.findTarget(
          this.playerPosition,
          this.player.getForwardVector(this.playerForward),
          this.npcManager.getAll(),
        )
    const highlightedNpcId =
      this.activeNpcId ?? hoveredNpc?.data.id ?? null

    this.npcManager.setHighlighted(highlightedNpcId)
    this.setHoveredNpc(hoveredNpc)

    if (!this.dialogueOpen && wantsInteract && hoveredNpc) {
      this.activeNpcId = hoveredNpc.data.id
      this.npcManager.setHighlighted(this.activeNpcId)
      this.setHoveredNpc(null)
      this.callbacks.onNpcInteract?.(hoveredNpc.data)
    }

    this.world.renderer.render(this.world.scene, this.world.camera)
  }

  destroy() {
    window.cancelAnimationFrame(this.animationFrame)
    this.player.destroy()
    this.followCamera.dispose()
    this.npcManager.destroy()
    this.mapGroup?.removeFromParent()
    this.world.destroy()
  }
}
