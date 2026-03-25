import * as THREE from 'three'
import { getVoxelMaterial, type VoxelMaterialType } from './materials'

export type WorldBounds = {
  minX: number
  maxX: number
  minZ: number
  maxZ: number
}

export type VoxelBlock = {
  x: number
  y: number
  z: number
  type: VoxelMaterialType
}

export class VoxelTerrain {
  readonly group = new THREE.Group()
  readonly blocks: VoxelBlock[] = []
  private readonly blockGeometry = new THREE.BoxGeometry(1, 1, 1)

  addBlock(x: number, y: number, z: number, type: VoxelMaterialType) {
    const mesh = new THREE.Mesh(this.blockGeometry, getVoxelMaterial(type))
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    mesh.receiveShadow = true
    this.group.add(mesh)
    this.blocks.push({ x, y, z, type })
    return mesh
  }

  fill(
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    type: VoxelMaterialType,
  ) {
    for (let x = minX; x <= maxX; x += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let z = minZ; z <= maxZ; z += 1) {
          this.addBlock(x, y, z, type)
        }
      }
    }
  }

  addColumn(
    x: number,
    z: number,
    height: number,
    type: VoxelMaterialType,
    startY = 0.5,
  ) {
    for (let level = 0; level < height; level += 1) {
      this.addBlock(x, startY + level, z, type)
    }
  }

  addRow(
    from: THREE.Vector3Like,
    to: THREE.Vector3Like,
    type: VoxelMaterialType,
  ) {
    if (from.x === to.x) {
      const start = Math.min(from.z, to.z)
      const end = Math.max(from.z, to.z)
      for (let z = start; z <= end; z += 1) {
        this.addBlock(from.x, from.y, z, type)
      }
      return
    }

    const start = Math.min(from.x, to.x)
    const end = Math.max(from.x, to.x)
    for (let x = start; x <= end; x += 1) {
      this.addBlock(x, from.y, from.z, type)
    }
  }
}
