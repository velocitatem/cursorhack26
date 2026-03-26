import * as THREE from 'three'
import type { SceneTheme } from '../story/types'
import type { VoxelMaterialType } from './materials'
import { VoxelTerrain, type WorldBounds } from './terrain'

export type DemoMap = {
  group: THREE.Group
  bounds: WorldBounds
  collisionCells: Set<string>
}

type SceneLayoutPayload = {
  seed?: number
  bounds: WorldBounds
  blocks: { x: number; y: number; z: number; type: string }[]
}

const defaultBounds: WorldBounds = {
  minX: -13,
  maxX: 13,
  minZ: -13,
  maxZ: 13,
}

const seedNoise = (x: number, z: number, seed: number) => {
  const value = Math.sin(x * 12.9898 + z * 78.233 + seed * 0.00017) * 43758.5453
  return value - Math.floor(value)
}

const addTree = (terrain: VoxelTerrain, x: number, z: number, height = 3) => {
  terrain.addColumn(x, z, height, 'tree')

  for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
    for (let offsetZ = -1; offsetZ <= 1; offsetZ += 1) {
      terrain.addBlock(x + offsetX, height + 0.5, z + offsetZ, 'leaf')
    }
  }

  terrain.addBlock(x, height + 1.5, z, 'leaf')
}

const addLamp = (terrain: VoxelTerrain, x: number, z: number, height = 3) => {
  terrain.addColumn(x, z, height, 'wood')
  terrain.addBlock(x, height + 0.5, z, 'glass')
  terrain.addBlock(x, height - 0.5, z, 'accent')
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

const addMarketStall = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x - 1, z - 1, 2, 'wood')
  terrain.addColumn(x + 1, z - 1, 2, 'wood')
  terrain.addColumn(x - 1, z + 1, 2, 'wood')
  terrain.addColumn(x + 1, z + 1, 2, 'wood')
  terrain.fill(x - 2, x + 2, 2, 2, z - 1, z + 1, 'accent')
}

const addGateway = (terrain: VoxelTerrain, x: number, z: number, horizontal: boolean) => {
  if (horizontal) {
    terrain.addColumn(x - 2, z, 3, 'brick')
    terrain.addColumn(x + 2, z, 3, 'brick')
    terrain.addRow({ x: x - 2, y: 3.5, z }, { x: x + 2, y: 3.5, z }, 'wood')
    terrain.addBlock(x, 4.5, z, 'accent')
    return
  }

  terrain.addColumn(x, z - 2, 3, 'brick')
  terrain.addColumn(x, z + 2, 3, 'brick')
  terrain.addRow({ x, y: 3.5, z: z - 2 }, { x, y: 3.5, z: z + 2 }, 'wood')
  terrain.addBlock(x, 4.5, z, 'accent')
}

const addFountain = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.fill(x - 2, x + 2, 0, 0, z - 2, z + 2, 'brick')
  terrain.fill(x - 1, x + 1, 0, 0, z - 1, z + 1, 'water')
  terrain.addColumn(x, z, 2, 'glass')
  terrain.addBlock(x, 2.5, z, 'accent')
}

const addBuilding = (
  terrain: VoxelTerrain,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  height: number,
  wall: VoxelMaterialType,
) => {
  terrain.fill(minX, maxX, 0, height - 1, minZ, maxZ, wall)
  terrain.fill(minX + 1, maxX - 1, height, height, minZ + 1, maxZ - 1, 'wood')

  for (let y = 1; y < height - 1; y += 2) {
    for (let x = minX + 1; x <= maxX - 1; x += 2) {
      terrain.addBlock(x, y + 0.5, minZ, 'glass')
      terrain.addBlock(x, y + 0.5, maxZ, 'glass')
    }
  }
}

const addBackdropRidge = (terrain: VoxelTerrain, bounds: WorldBounds, seed: number) => {
  const ringOffset = 2
  const minX = bounds.minX - ringOffset
  const maxX = bounds.maxX + ringOffset
  const minZ = bounds.minZ - ringOffset
  const maxZ = bounds.maxZ + ringOffset

  for (let x = minX; x <= maxX; x += 1) {
    const northHeight = 2 + Math.floor(seedNoise(x, maxZ, seed) * 4)
    const southHeight = 2 + Math.floor(seedNoise(x, minZ, seed + 17) * 4)
    terrain.addColumn(x, maxZ, northHeight, 'stone')
    terrain.addColumn(x, minZ, southHeight, 'stone')
  }

  for (let z = minZ + 1; z < maxZ; z += 1) {
    const eastHeight = 2 + Math.floor(seedNoise(maxX, z, seed + 29) * 4)
    const westHeight = 2 + Math.floor(seedNoise(minX, z, seed + 41) * 4)
    terrain.addColumn(maxX, z, eastHeight, 'stone')
    terrain.addColumn(minX, z, westHeight, 'stone')
  }

  addLamp(terrain, minX + 2, minZ + 2, 4)
  addLamp(terrain, minX + 2, maxZ - 2, 4)
  addLamp(terrain, maxX - 2, minZ + 2, 4)
  addLamp(terrain, maxX - 2, maxZ - 2, 4)
}

const decorateLayout = (
  terrain: VoxelTerrain,
  bounds: WorldBounds,
  theme: SceneTheme,
  seed: number,
) => {
  addBackdropRidge(terrain, bounds, seed)

  const edgeX = bounds.maxX + 1
  const edgeZ = bounds.maxZ + 1
  addTree(terrain, bounds.minX - 1, edgeZ, 4)
  addTree(terrain, edgeX, bounds.minZ - 1, 4)
  addTree(terrain, bounds.minX - 1, bounds.minZ - 1, 4)
  addTree(terrain, edgeX, edgeZ, 4)

  if (theme === 'inboxPlaza') {
    addMailbox(terrain, bounds.minX - 1, 0)
    addMailbox(terrain, bounds.maxX + 1, 0)
  } else {
    addMarketStall(terrain, bounds.minX - 1, bounds.minZ + 2)
    addMarketStall(terrain, bounds.maxX + 1, bounds.maxZ - 2)
  }
}

const buildInboxPlaza = (terrain: VoxelTerrain) => {
  terrain.fill(-16, 16, -1, -1, -16, 16, 'grass')
  terrain.fill(-11, 11, -1, -1, -13, 13, 'plaza')
  terrain.fill(-3, 3, -1, -1, -16, 16, 'plaza')
  terrain.fill(-16, 16, -1, -1, -3, 3, 'plaza')

  terrain.fill(-10, 10, -1, -1, -10, -8, 'water')
  terrain.fill(-10, 10, -1, -1, 8, 10, 'water')
  terrain.fill(-10, -8, -1, -1, -10, 10, 'water')
  terrain.fill(8, 10, -1, -1, -10, 10, 'water')

  addFountain(terrain, 0, 0)
  addGateway(terrain, 0, 14, true)
  addGateway(terrain, 0, -14, true)
  addGateway(terrain, 14, 0, false)
  addGateway(terrain, -14, 0, false)

  addMailbox(terrain, -9, 6)
  addMailbox(terrain, 9, -6)
  addBench(terrain, -8, 1)
  addBench(terrain, 8, -1)
  addBench(terrain, -1, 8)
  addBench(terrain, 1, -8)

  addLamp(terrain, -6, 11, 4)
  addLamp(terrain, 6, 11, 4)
  addLamp(terrain, -6, -11, 4)
  addLamp(terrain, 6, -11, 4)

  addMarketStall(terrain, -13, -8)
  addMarketStall(terrain, 13, 8)
  addMarketStall(terrain, -13, 8)
  addMarketStall(terrain, 13, -8)

  addTree(terrain, -14, -14, 4)
  addTree(terrain, -14, 14, 4)
  addTree(terrain, 14, -14, 4)
  addTree(terrain, 14, 14, 4)
}

const buildCityBlock = (terrain: VoxelTerrain) => {
  terrain.fill(-16, 16, -1, -1, -16, 16, 'stone')
  terrain.fill(-5, 5, -1, -1, -16, 16, 'plaza')
  terrain.fill(-16, 16, -1, -1, -5, 5, 'plaza')
  terrain.fill(-8, -6, -1, -1, -16, 16, 'brick')
  terrain.fill(6, 8, -1, -1, -16, 16, 'brick')
  terrain.fill(-16, 16, -1, -1, -8, -6, 'brick')
  terrain.fill(-16, 16, -1, -1, 6, 8, 'brick')

  terrain.fill(11, 13, -1, -1, -16, 16, 'water')
  terrain.addRow({ x: 10, y: 0.5, z: -16 }, { x: 10, y: 0.5, z: 16 }, 'stone')
  terrain.addRow({ x: 14, y: 0.5, z: -16 }, { x: 14, y: 0.5, z: 16 }, 'stone')
  terrain.fill(10, 14, 0, 0, -1, 1, 'wood')

  addBuilding(terrain, -16, -11, -16, -11, 5, 'brick')
  addBuilding(terrain, 8, 15, -16, -11, 6, 'wood')
  addBuilding(terrain, -16, -10, 9, 15, 5, 'stone')
  addBuilding(terrain, 9, 15, 10, 15, 4, 'brick')

  addMarketStall(terrain, -11, 0)
  addMarketStall(terrain, 3, -12)
  addMailbox(terrain, 0, 11)
  addBench(terrain, -3, 10)
  addBench(terrain, 3, -10)

  addLamp(terrain, -7, -7, 4)
  addLamp(terrain, -7, 7, 4)
  addLamp(terrain, 7, -7, 4)
  addLamp(terrain, 7, 7, 4)

  addTree(terrain, -13, 7, 4)
  addTree(terrain, 4, 14, 4)
}

const allowedTypes = new Set<VoxelMaterialType>([
  'grass',
  'dirt',
  'stone',
  'brick',
  'water',
  'tree',
  'wood',
  'leaf',
  'sand',
  'glass',
  'plaza',
  'mail',
  'accent',
])

const blockAliases: Record<string, VoxelMaterialType> = {
  cobblestone: 'stone',
  log: 'tree',
  planks: 'wood',
  leaves: 'leaf',
  glowstone: 'glass',
  path: 'plaza',
  road: 'plaza',
  soil: 'dirt',
  bricks: 'brick',
  stone_bricks: 'brick',
  river: 'water',
}

const toBlockType = (value: string): VoxelMaterialType => {
  const normalized = value.trim().toLowerCase()
  const alias = blockAliases[normalized]
  if (alias) return alias
  return allowedTypes.has(normalized as VoxelMaterialType)
    ? (normalized as VoxelMaterialType)
    : 'grass'
}

const buildFromLayout = (terrain: VoxelTerrain, layout: SceneLayoutPayload) => {
  for (const block of layout.blocks) {
    terrain.addBlock(block.x, block.y, block.z, toBlockType(block.type))
  }
}

const passableTypes = new Set<VoxelMaterialType>(['grass', 'plaza', 'sand'])

const buildCollisionCells = (terrain: VoxelTerrain) =>
  new Set(
    terrain.blocks
      .filter(block => block.y >= 0 && !passableTypes.has(block.type))
      .map(block => `${Math.round(block.x)},${Math.round(block.z)}`),
  )

export const buildDemoMap = (theme: SceneTheme, layout?: SceneLayoutPayload): DemoMap => {
  const terrain = new VoxelTerrain()
  if (layout) {
    buildFromLayout(terrain, layout)
    decorateLayout(terrain, layout.bounds, theme, layout.seed ?? 0)
    return {
      group: terrain.group,
      bounds: layout.bounds,
      collisionCells: buildCollisionCells(terrain),
    }
  }

  if (theme === 'cityBlock') {
    buildCityBlock(terrain)
  } else {
    buildInboxPlaza(terrain)
  }

  return {
    group: terrain.group,
    bounds: defaultBounds,
    collisionCells: buildCollisionCells(terrain),
  }
}
