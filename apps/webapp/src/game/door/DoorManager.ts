import * as THREE from 'three'
import { DoorEntity } from './DoorEntity'
import type { SceneNpc } from '../story/types'

type DoorRecord = { door: DoorEntity; npcId: string }

export class DoorManager {
  readonly group = new THREE.Group()
  private records: DoorRecord[] = []
  private activeNpcId: string | null = null

  constructor(scene: THREE.Scene) {
    scene.add(this.group)
  }

  setScene(npcs: SceneNpc[]) {
    this.clear()
    for (const npc of npcs) {
      for (const choice of npc.choices) {
        if (!choice.doorPosition) continue
        const door = new DoorEntity(choice, choice.doorPosition, choice.doorFacing ?? 0)
        this.records.push({ door, npcId: npc.id })
        this.group.add(door.group)
      }
    }
  }

  setActiveNpc(npcId: string | null) {
    this.activeNpcId = npcId
    for (const { door, npcId: id } of this.records) {
      const active = id === npcId && npcId !== null
      door.setVisible(active)
      door.setHighlighted(false)
      door.setInteractHint(false)
    }
  }

  getActiveDoors(): DoorEntity[] {
    return this.records.filter(r => r.npcId === this.activeNpcId).map(r => r.door)
  }

  setHighlighted(choiceId: string | null) {
    for (const { door } of this.records) {
      const match = door.choice.id === choiceId
      door.setHighlighted(match)
      door.setInteractHint(match)
    }
  }

  update(elapsed: number) {
    for (const { door } of this.records) {
      door.update(elapsed)
    }
  }

  clear() {
    for (const { door } of this.records) {
      this.group.remove(door.group)
      door.dispose()
    }
    this.records = []
    this.activeNpcId = null
  }

  destroy() {
    this.clear()
    this.group.removeFromParent()
  }
}
