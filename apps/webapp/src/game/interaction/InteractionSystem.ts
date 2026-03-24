import * as THREE from 'three'
import type { NpcEntity } from '../npc/NpcEntity'
import type { DoorEntity } from '../door/DoorEntity'

export class InteractionSystem {
  private readonly direction = new THREE.Vector3()
  private readonly radius: number
  private readonly facingThreshold: number

  constructor(radius = 3.75, facingThreshold = -0.1) {
    this.radius = radius
    this.facingThreshold = facingThreshold
  }

  private findNearest<T extends { group: THREE.Group }>(
    playerPosition: THREE.Vector3,
    playerForward: THREE.Vector3,
    targets: T[],
  ): T | null {
    let closest: T | null = null
    let closestScore = Number.POSITIVE_INFINITY

    for (const target of targets) {
      this.direction.subVectors(target.group.position, playerPosition)
      const distance = this.direction.length()

      if (distance > this.radius || distance === 0) continue

      this.direction.normalize()
      const facing = this.direction.dot(playerForward)

      if (facing < this.facingThreshold) continue

      const score = distance - facing * 0.5
      if (score < closestScore) {
        closest = target
        closestScore = score
      }
    }

    return closest
  }

  findTarget(
    playerPosition: THREE.Vector3,
    playerForward: THREE.Vector3,
    npcs: NpcEntity[],
  ): NpcEntity | null {
    return this.findNearest(playerPosition, playerForward, npcs)
  }

  findDoorTarget(
    playerPosition: THREE.Vector3,
    playerForward: THREE.Vector3,
    doors: DoorEntity[],
  ): DoorEntity | null {
    return this.findNearest(playerPosition, playerForward, doors)
  }
}
