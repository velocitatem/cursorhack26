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

const addTree = (terrain: VoxelTerrain, x: number, z: number, height = 4) => {
  terrain.addColumn(x, z, height, 'tree')

  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      terrain.addBlock(x + offsetX, height + 0.5, z + offsetZ, 'leaf')
    }
  }

  terrain.addBlock(x, height + 1.5, z, 'leaf')
}

const addLamp = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 3, 'tree')
  terrain.addBox(x, 3.35, z, 1.4, 0.5, 1.4, 'roof')
  terrain.addBlock(x, 2.5, z, 'glass')
  terrain.addBlock(x, 1.5, z, 'accent')
}

const addMailbox = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 2, 'tree')
  terrain.addBox(x, 2.35, z, 1.2, 0.8, 1.3, 'mail')
  terrain.addBox(x, 2.35, z + 0.72, 1.3, 0.16, 0.36, 'accent')
}

const addBench = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addBox(x, 0.45, z, 2.8, 0.3, 0.8, 'wood')
  terrain.addBox(x, 1.05, z - 0.28, 2.8, 0.9, 0.28, 'wood')
  terrain.addColumn(x - 1, z, 1, 'tree', -0.5)
  terrain.addColumn(x + 1, z, 1, 'tree', -0.5)
}

const addPlanter = (terrain: VoxelTerrain, x: number, z: number, width = 3, depth = 3) => {
  terrain.addBox(x, 0.25, z, width + 0.4, 0.5, depth + 0.4, 'cobble')
  terrain.addBox(x, 0.52, z, width, 0.28, depth, 'moss')
  terrain.addBox(x, 0.95, z, width - 0.5, 0.55, depth - 0.5, 'leaf')
  terrain.addBlock(x, 1.55, z, 'accent')
}

const addCrateStack = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addBox(x, 0.42, z, 1.05, 0.84, 1.05, 'spruce')
  terrain.addBox(x + 0.7, 0.42, z + 0.2, 1.05, 0.84, 1.05, 'wood')
  terrain.addBox(x + 0.35, 1.26, z + 0.12, 0.94, 0.74, 0.94, 'spruce')
}

const addFountain = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addBox(x, -0.2, z, 5.8, 0.6, 5.8, 'cobble')
  terrain.addBox(x, 0.2, z, 4.4, 0.4, 4.4, 'moss')
  terrain.addBox(x, 0.62, z, 3.2, 0.22, 3.2, 'water')
  terrain.addColumn(x, z, 2, 'stone', 0.5)
  terrain.addBlock(x, 2.5, z, 'accent')
}

const addMarketStall = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x - 1, z - 1, 2, 'tree')
  terrain.addColumn(x + 1, z - 1, 2, 'tree')
  terrain.addColumn(x - 1, z + 1, 2, 'tree')
  terrain.addColumn(x + 1, z + 1, 2, 'tree')
  terrain.addBox(x, 2.5, z, 3.6, 0.36, 3.6, 'roof')
  terrain.addBox(x, 1.22, z, 2.4, 0.26, 1.6, 'wood')
  terrain.addBox(x, 1.75, z, 2.1, 0.9, 0.7, 'book')
  terrain.addBox(x - 0.95, 0.4, z + 1.55, 0.8, 0.8, 0.8, 'spruce')
  terrain.addBox(x + 0.95, 0.4, z + 1.55, 0.8, 0.8, 0.8, 'spruce')
}

const addTownhouse = (
  terrain: VoxelTerrain,
  x: number,
  z: number,
  width: number,
  depth: number,
  height: number,
  body: 'brick' | 'cobble' | 'stone',
) => {
  terrain.addBox(x, height / 2 - 0.02, z, width, height, depth, body)
  terrain.addBox(x, height + 0.35, z, width + 0.45, 0.7, depth + 0.45, 'roof')
  terrain.addBox(x, 0.45, z + depth / 2 + 0.12, width * 0.32, 0.9, 0.3, 'wood')
  terrain.addBox(x, 1.55, z + depth / 2 + 0.12, width * 0.24, 1.2, 0.18, 'glass')
  terrain.addBox(x - width * 0.24, 1.55, z + depth / 2 + 0.12, width * 0.16, 1.2, 0.18, 'glass')
  terrain.addBox(x + width * 0.24, 1.55, z + depth / 2 + 0.12, width * 0.16, 1.2, 0.18, 'glass')
}

const addCanal = (terrain: VoxelTerrain, x: number, z: number, width: number, depth: number) => {
  terrain.addBox(x, -0.44, z, width + 0.6, 0.5, depth + 0.6, 'cobble')
  terrain.addBox(x, -0.15, z, width, 0.18, depth, 'water')
}

const buildInboxPlaza = (terrain: VoxelTerrain) => {
  terrain.fill(-15, 15, -1, -1, -15, 15, 'grass')
  terrain.fill(-13, 13, -1, -1, -10, 10, 'path')
  terrain.fill(-10, 10, -1, -1, -13, 13, 'path')
  terrain.fill(-7, 7, -1, -1, -9, 9, 'plaza')
  terrain.fill(-2, 2, -1, -1, -13, 13, 'plaza')
  terrain.fill(-13, 13, -1, -1, -2, 2, 'plaza')

  addFountain(terrain, 0, 0)

  terrain.addColumn(-4, 0, 3, 'tree')
  terrain.addColumn(4, 0, 3, 'tree')
  terrain.addRow({ x: -4, y: 3.42, z: 0 }, { x: 4, y: 3.42, z: 0 }, 'roof')

  addTownhouse(terrain, -10.5, -11.3, 4.2, 3.4, 4.4, 'brick')
  addTownhouse(terrain, -5.1, -11.3, 4.2, 3.4, 3.8, 'cobble')
  addTownhouse(terrain, 5.1, -11.3, 4.2, 3.4, 4.2, 'stone')
  addTownhouse(terrain, 10.5, -11.3, 4.2, 3.4, 4.8, 'brick')

  addMailbox(terrain, -6, 4)
  addMailbox(terrain, 6, -4)
  addBench(terrain, -8, -1)
  addBench(terrain, 8, 1)
  addLamp(terrain, -4, -9)
  addLamp(terrain, 4, 9)
  addLamp(terrain, -11, 2)
  addLamp(terrain, 11, -2)
  addPlanter(terrain, -10, 8)
  addPlanter(terrain, 10, -8)
  addPlanter(terrain, -10, -8)
  addPlanter(terrain, 10, 8)
  addTree(terrain, -13, 10)
  addTree(terrain, 13, -10)
  addTree(terrain, -13, -10)
  addTree(terrain, 13, 10)
  addCrateStack(terrain, -6.5, 8)
  addCrateStack(terrain, 6.2, -8.2)
  addMarketStall(terrain, 0, 10)
}

const buildCityBlock = (terrain: VoxelTerrain) => {
  terrain.fill(-15, 15, -1, -1, -15, 15, 'stone')
  terrain.fill(-5, 5, -1, -1, -15, 15, 'plaza')
  terrain.fill(-15, 15, -1, -1, -5, 5, 'plaza')
  terrain.fill(-13, 13, -1, -1, -1, 1, 'path')
  terrain.fill(-1, 1, -1, -1, -13, 13, 'path')

  addTownhouse(terrain, -11.2, -11.2, 4.6, 4.2, 4.5, 'brick')
  addTownhouse(terrain, 11.2, -11.2, 4.6, 4.2, 5.1, 'cobble')
  addTownhouse(terrain, -11.2, 11.2, 5.2, 4.2, 5.4, 'stone')
  addTownhouse(terrain, 11.2, 11.2, 4.4, 4.2, 4.1, 'brick')

  addCanal(terrain, -10.5, 0, 2.4, 6.4)
  addCanal(terrain, 10.5, 0, 2.4, 6.4)
  addMarketStall(terrain, -8.5, 0)
  addMarketStall(terrain, 8.5, 0)
  addPlanter(terrain, 0, -9, 4, 2.5)
  addPlanter(terrain, 0, 9, 4, 2.5)
  addBench(terrain, -4.8, 8.4)
  addBench(terrain, 4.8, -8.4)
  addLamp(terrain, -6.5, -6.5)
  addLamp(terrain, 6.5, 6.5)
  addLamp(terrain, -6.5, 6.5)
  addLamp(terrain, 6.5, -6.5)
  addMailbox(terrain, 0, -10)
  addMailbox(terrain, 0, 10)
  addCrateStack(terrain, -12.2, 2.8)
  addCrateStack(terrain, 12.1, -2.8)
  addTree(terrain, -14, 0, 5)
  addTree(terrain, 14, 0, 5)
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
