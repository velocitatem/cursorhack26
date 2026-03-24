import * as THREE from 'three'
import type { NpcEntity } from '../npc/NpcEntity'

export class InteractionSystem {
  private readonly direction = new THREE.Vector3()
  private readonly radius: number
  private readonly facingThreshold: number

  constructor(radius = 3.75, facingThreshold = -0.1) {
    this.radius = radius
    this.facingThreshold = facingThreshold
  }

  findTarget(
    playerPosition: THREE.Vector3,
    playerForward: THREE.Vector3,
    npcs: NpcEntity[],
  ) {
    let closestNpc: NpcEntity | null = null
    let closestScore = Number.POSITIVE_INFINITY

    for (const npc of npcs) {
      this.direction.subVectors(npc.group.position, playerPosition)
      const distance = this.direction.length()

      if (distance > this.radius || distance === 0) {
        continue
      }

      this.direction.normalize()
      const facing = this.direction.dot(playerForward)

      if (facing < this.facingThreshold) {
        continue
      }

      const score = distance - facing * 0.5

      if (score < closestScore) {
        closestNpc = npc
        closestScore = score
      }
    }

    return closestNpc
  }
}
