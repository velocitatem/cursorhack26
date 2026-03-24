import * as THREE from 'three'
import { VoxelTerrain, type WorldBounds } from './terrain'
import type { SceneTheme } from '../story/types'

export type DemoMap = {
  group: THREE.Group
  bounds: WorldBounds
}

const defaultBounds: WorldBounds = {
  minX: -12,
  maxX: 12,
  minZ: -12,
  maxZ: 12,
}

const addTree = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 3, 'tree')

  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      terrain.addBlock(x + offsetX, 3.5, z + offsetZ, 'leaf')
    }
  }

  terrain.addBlock(x, 4.5, z, 'leaf')
}

const addLamp = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 3, 'wood')
  terrain.addBlock(x, 3.5, z, 'glass')
  terrain.addBlock(x, 2.5, z, 'accent')
}

const addMailbox = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 2, 'wood')
  terrain.addBlock(x, 2.5, z, 'mail')
  terrain.addBlock(x, 2.5, z + 1, 'accent')
}

const addBench = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addBlock(x - 1, 0.5, z, 'wood')
  terrain.addBlock(x, 0.5, z, 'wood')
  terrain.addBlock(x + 1, 0.5, z, 'wood')
  terrain.addColumn(x - 1, z, 1, 'tree', -0.5)
  terrain.addColumn(x + 1, z, 1, 'tree', -0.5)
}

const buildInboxPlaza = (terrain: VoxelTerrain) => {
  terrain.fill(-14, 14, -1, -1, -14, 14, 'grass')
  terrain.fill(-6, 6, -1, -1, -9, 9, 'plaza')
  terrain.fill(-2, 2, -1, -1, -12, 12, 'plaza')

  terrain.fill(-2, 2, 0, 0, -1, 1, 'accent')
  terrain.fill(-1, 1, 1, 1, 0, 0, 'accent')

  terrain.addColumn(-3, 0, 2, 'wood')
  terrain.addColumn(3, 0, 2, 'wood')
  terrain.addRow({ x: -3, y: 2.5, z: 0 }, { x: 3, y: 2.5, z: 0 }, 'wood')

  addMailbox(terrain, -5, 3)
  addMailbox(terrain, 5, -3)
  addBench(terrain, -7, -1)
  addBench(terrain, 7, 1)
  addLamp(terrain, -4, -8)
  addLamp(terrain, 4, 8)
  addTree(terrain, -10, 8)
  addTree(terrain, 10, -8)
  addTree(terrain, -10, -8)
  addTree(terrain, 10, 8)
}

const buildCityBlock = (terrain: VoxelTerrain) => {
  terrain.fill(-14, 14, -1, -1, -14, 14, 'stone')
  terrain.fill(-4, 4, -1, -1, -14, 14, 'plaza')
  terrain.fill(-14, 14, -1, -1, -4, 4, 'plaza')

  terrain.fill(-12, -9, 0, 3, -12, -9, 'wood')
  terrain.fill(9, 12, 0, 4, -12, -9, 'wood')
  terrain.fill(-12, -8, 0, 5, 8, 12, 'stone')
  terrain.fill(8, 12, 0, 3, 8, 12, 'plaza')

  addLamp(terrain, -6, -6)
  addLamp(terrain, 6, 6)
  addMailbox(terrain, 0, -8)
  addMailbox(terrain, 8, 0)
  addBench(terrain, -8, 0)
  addBench(terrain, 8, 0)
}

export const buildDemoMap = (theme: SceneTheme): DemoMap => {
  const terrain = new VoxelTerrain()

  if (theme === 'cityBlock') {
    buildCityBlock(terrain)
  } else {
    buildInboxPlaza(terrain)
  }

  return {
    group: terrain.group,
    bounds: defaultBounds,
  }
}
