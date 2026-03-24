import * as THREE from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { createWorld, type WorldContext } from '../core/createWorld'
import { InteractionSystem } from '../interaction/InteractionSystem'
import { NpcManager } from '../npc/NpcManager'
import { PlayerController } from '../player/PlayerController'
import type { SceneNpc, ScenePayload, SceneTheme } from '../story/types'
import { buildDemoMap } from '../world/buildDemoMap'

export type GameRuntimeCallbacks = {
  onNpcInteract?: (npc: SceneNpc) => void
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
  private mapTheme: SceneTheme | null = null
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
  }

  setScene(scene: ScenePayload) {
    if (this.mapTheme !== scene.environment.theme || !this.mapGroup) {
      this.mapGroup?.removeFromParent()

      const map = buildDemoMap(scene.environment.theme)
      this.mapGroup = map.group
      this.mapTheme = scene.environment.theme
      this.player.setBounds(map.bounds)
      this.world.scene.add(map.group)
    }

    this.player.setPosition(scene.environment.spawn)
    this.followCamera.syncToTarget(this.player.getFocusPoint(this.playerFocus))
    this.npcManager.setScene(scene.npcs)
    this.activeNpcId = null
    this.hoveredNpcId = null
  }

  setDialogueOpen(active: boolean) {
    this.dialogueOpen = active
    this.player.setEnabled(!active)
    this.followCamera.setEnabled(!active)
    if (active) {
      this.npcManager.setInteractHint(null)
    }
  }

  setActiveNpc(id: string | null) {
    this.activeNpcId = id
    this.npcManager.setHighlighted(id)
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

    const newHoveredId = hoveredNpc?.data.id ?? null
    if (newHoveredId !== this.hoveredNpcId) {
      this.hoveredNpcId = newHoveredId
      this.npcManager.setInteractHint(this.dialogueOpen ? null : newHoveredId)
    }

    if (!this.dialogueOpen && wantsInteract && hoveredNpc) {
      this.activeNpcId = hoveredNpc.data.id
      this.npcManager.setHighlighted(this.activeNpcId)
      this.npcManager.setInteractHint(null)
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
