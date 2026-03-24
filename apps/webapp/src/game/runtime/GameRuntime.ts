import * as THREE from 'three'
import { FollowCamera } from '../camera/FollowCamera'
import { createWorld, type WorldContext } from '../core/createWorld'
import { DoorManager } from '../door/DoorManager'
import { InteractionSystem } from '../interaction/InteractionSystem'
import { NpcManager } from '../npc/NpcManager'
import { PlayerController } from '../player/PlayerController'
import type { SceneNpc, ScenePayload, SceneTheme } from '../story/types'
import { buildDemoMap } from '../world/buildDemoMap'

export type GameRuntimeCallbacks = {
  onNpcInteract?: (npc: SceneNpc) => void
  onDoorChoose?: (npcId: string, choiceId: string) => void
}

export class GameRuntime {
  private readonly world: WorldContext
  private readonly player = new PlayerController()
  private readonly followCamera: FollowCamera
  private readonly npcManager: NpcManager
  private readonly doorManager: DoorManager
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
  private torchLights: Array<{ light: THREE.PointLight; base: number; offset: number }> = []
  private dialogueOpen = false
  private activeNpcId: string | null = null
  private hoveredNpcId: string | null = null
  private pendingNpcId: string | null = null
  private hoveredDoorId: string | null = null

  constructor(container: HTMLElement, callbacks: GameRuntimeCallbacks = {}) {
    this.callbacks = callbacks
    this.world = createWorld(container)
    this.followCamera = new FollowCamera(this.world.camera, this.world.renderer.domElement)
    this.npcManager = new NpcManager(this.world.scene)
    this.doorManager = new DoorManager(this.world.scene)

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
      this.torchLights = map.torchLights.map(light => ({
        light,
        base: light.intensity,
        offset: Math.random() * Math.PI * 2,
      }))
    }

    this.player.setPosition(scene.environment.spawn)
    this.followCamera.syncToTarget(this.player.getFocusPoint(this.playerFocus))
    this.npcManager.setScene(scene.npcs)
    this.doorManager.setScene(scene.npcs)
    this.doorManager.setActiveNpc(null)

    this.activeNpcId = null
    this.hoveredNpcId = null
    this.pendingNpcId = null
    this.hoveredDoorId = null
  }

  setDialogueOpen(active: boolean) {
    this.dialogueOpen = active
    this.player.setEnabled(!active)
    this.followCamera.setEnabled(!active)

    if (active) {
      this.npcManager.setInteractHint(null)
    } else if (this.activeNpcId) {
      // dialogue closed after NPC interaction - show doors for this NPC
      this.pendingNpcId = this.activeNpcId
      this.doorManager.setActiveNpc(this.pendingNpcId)
    }
  }

  setActiveNpc(id: string | null) {
    this.activeNpcId = id
    this.npcManager.setHighlighted(id)
    if (id !== null) {
      // new NPC interaction started, clear any pending door state
      this.pendingNpcId = null
      this.doorManager.setActiveNpc(null)
    }
  }

  private animate = () => {
    this.animationFrame = window.requestAnimationFrame(this.animate)

    const delta = Math.min(this.clock.getDelta(), 0.05)
    const elapsed = this.clock.elapsedTime
    const wantsInteract = this.player.consumeInteract()

    this.player.update(delta, this.followCamera.getPlanarForward(this.cameraForward), elapsed)
    this.player.getPosition(this.playerPosition)
    this.npcManager.update(elapsed, this.playerPosition)
    this.doorManager.update(elapsed)
    this.followCamera.update(this.player.getFocusPoint(this.playerFocus))

    for (const { light, base, offset } of this.torchLights) {
      light.intensity =
        base *
        (0.82 + 0.12 * Math.sin(elapsed * 7.3 + offset) + 0.06 * Math.sin(elapsed * 13.7 + offset * 1.7))
    }

    if (!this.dialogueOpen && this.pendingNpcId) {
      const activeDoors = this.doorManager.getActiveDoors()
      const hoveredDoor = this.interactionSystem.findDoorTarget(
        this.playerPosition,
        this.player.getForwardVector(this.playerForward),
        activeDoors,
      )
      const newHoveredDoorId = hoveredDoor?.choice.id ?? null

      if (newHoveredDoorId !== this.hoveredDoorId) {
        this.hoveredDoorId = newHoveredDoorId
        this.doorManager.setHighlighted(newHoveredDoorId)
      }

      if (wantsInteract && hoveredDoor) {
        const npcId = this.pendingNpcId
        this.pendingNpcId = null
        this.hoveredDoorId = null
        this.doorManager.setActiveNpc(null)
        this.callbacks.onDoorChoose?.(npcId, hoveredDoor.choice.id)
        return
      }
    }

    const hoveredNpc = this.dialogueOpen
      ? null
      : this.interactionSystem.findTarget(
          this.playerPosition,
          this.player.getForwardVector(this.playerForward),
          this.npcManager.getAll(),
        )
    const highlightedNpcId = this.activeNpcId ?? hoveredNpc?.data.id ?? null

    this.npcManager.setHighlighted(highlightedNpcId)

    const newHoveredId = hoveredNpc?.data.id ?? null
    if (newHoveredId !== this.hoveredNpcId) {
      this.hoveredNpcId = newHoveredId
      this.npcManager.setInteractHint(this.dialogueOpen ? null : newHoveredId)
    }

    if (!this.dialogueOpen && !this.pendingNpcId && wantsInteract && hoveredNpc) {
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
    this.doorManager.destroy()
    this.mapGroup?.removeFromParent()
    this.world.destroy()
  }
}
