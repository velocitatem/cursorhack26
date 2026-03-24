import * as THREE from 'three'
import { NpcEntity } from './NpcEntity'
import type { SceneNpc } from '../story/types'

export class NpcManager {
  readonly group = new THREE.Group()
  private npcs: NpcEntity[] = []

  constructor(scene: THREE.Scene) {
    scene.add(this.group)
  }

  setScene(npcs: SceneNpc[]) {
    this.clear()

    this.npcs = npcs.map(npc => new NpcEntity(npc))

    for (const npc of this.npcs) {
      this.group.add(npc.group)
    }
  }

  getAll() {
    return this.npcs
  }

  getById(id: string) {
    return this.npcs.find(npc => npc.data.id === id) ?? null
  }

  setHighlighted(id: string | null) {
    for (const npc of this.npcs) {
      npc.setHighlighted(npc.data.id === id)
    }
  }

  setInteractHint(id: string | null) {
    for (const npc of this.npcs) {
      npc.setInteractHint(npc.data.id === id)
    }
  }

  update(elapsed: number, playerPosition: THREE.Vector3) {
    for (const npc of this.npcs) {
      npc.update(elapsed, playerPosition)
    }
  }

  clear() {
    for (const npc of this.npcs) {
      this.group.remove(npc.group)
      npc.dispose()
    }

    this.npcs = []
  }

  destroy() {
    this.clear()
    this.group.removeFromParent()
  }
}
