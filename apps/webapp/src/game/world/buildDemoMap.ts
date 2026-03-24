import * as THREE from 'three'
import { VoxelTerrain, type WorldBounds } from './terrain'
import type { SceneTheme } from '../story/types'

export type DemoMap = {
  group: THREE.Group
  bounds: WorldBounds
  torchLights: THREE.PointLight[]
}

const defaultBounds: WorldBounds = {
  minX: -12,
  maxX: 12,
  minZ: -12,
  maxZ: 12,
}

// tall dark tree
const addTree = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 4, 'tree')
  for (let ox = -1; ox <= 1; ox++) {
    for (let oz = -1; oz <= 1; oz++) {
      terrain.addBlock(x + ox, 4.5, z + oz, 'leaf')
    }
  }
  terrain.addBlock(x, 5.5, z, 'leaf')
}

// stone pillar - gives height and silhouette
const addPillar = (terrain: VoxelTerrain, x: number, z: number, height = 4) => {
  terrain.addColumn(x, z, height, 'stone')
  terrain.addBlock(x, height + 0.5, z, 'stone')
}

// torch: wood post + glowing accent tip + warm point light
const addTorch = (terrain: VoxelTerrain, x: number, z: number, lights: THREE.PointLight[]) => {
  terrain.addColumn(x, z, 2, 'wood')
  terrain.addBlock(x, 2.5, z, 'accent')
  const light = new THREE.PointLight(0xff6020, 1.2, 9)
  light.position.set(x, 4, z)
  terrain.group.add(light)
  lights.push(light)
}

// stone mailbox post
const addMailbox = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addColumn(x, z, 2, 'stone')
  terrain.addBlock(x, 2.5, z, 'mail')
}

// low bench from wood
const addBench = (terrain: VoxelTerrain, x: number, z: number) => {
  terrain.addBlock(x - 1, 0.5, z, 'wood')
  terrain.addBlock(x, 0.5, z, 'wood')
  terrain.addBlock(x + 1, 0.5, z, 'wood')
  terrain.addColumn(x - 1, z, 1, 'stone', -0.5)
  terrain.addColumn(x + 1, z, 1, 'stone', -0.5)
}

// partial wall segment (north fortress silhouette)
const addWallSegment = (
  terrain: VoxelTerrain,
  x1: number,
  x2: number,
  z: number,
  h: number,
) => {
  terrain.fill(x1, x2, 0, h - 1, z, z, 'stone')
  // battlements at top
  for (let x = x1; x <= x2; x += 2) {
    terrain.addBlock(x, h + 0.5, z, 'stone')
  }
}

const buildInboxPlaza = (terrain: VoxelTerrain, lights: THREE.PointLight[]) => {
  // dark stone base
  terrain.fill(-14, 14, -1, -1, -14, 14, 'stone')
  // cobblestone paths
  terrain.fill(-3, 3, -1, -1, -14, 14, 'plaza')
  terrain.fill(-14, 14, -1, -1, -3, 3, 'plaza')
  // central raised meeting stone
  terrain.fill(-2, 2, 0, 0, -2, 2, 'stone')

  // north fortress wall (gives depth)
  addWallSegment(terrain, -12, -5, -12, 3)
  addWallSegment(terrain, 5, 12, -12, 3)
  // corner towers
  addPillar(terrain, -13, -13, 5)
  addPillar(terrain, 13, -13, 5)
  addPillar(terrain, -13, 13, 3)
  addPillar(terrain, 13, 13, 3)

  // torches at four main crossings
  addTorch(terrain, -5, -5, lights)
  addTorch(terrain, 5, -5, lights)
  addTorch(terrain, -5, 5, lights)
  addTorch(terrain, 5, 5, lights)

  // mailboxes and benches
  addMailbox(terrain, -7, 0)
  addMailbox(terrain, 7, 0)
  addBench(terrain, -9, -2)
  addBench(terrain, 9, 2)

  // sparse dark trees at far corners
  addTree(terrain, -11, 9)
  addTree(terrain, 11, -9)
}

const buildCityBlock = (terrain: VoxelTerrain, lights: THREE.PointLight[]) => {
  terrain.fill(-14, 14, -1, -1, -14, 14, 'stone')
  terrain.fill(-4, 4, -1, -1, -14, 14, 'plaza')
  terrain.fill(-14, 14, -1, -1, -4, 4, 'plaza')

  // buildings
  terrain.fill(-12, -8, 0, 4, -12, -8, 'stone')
  terrain.fill(8, 12, 0, 5, -12, -8, 'stone')
  terrain.fill(-12, -7, 0, 3, 7, 12, 'stone')
  terrain.fill(7, 12, 0, 2, 7, 12, 'wood')

  // corner pillars
  addPillar(terrain, -13, -13, 5)
  addPillar(terrain, 13, -13, 5)

  // torches on main crossing
  addTorch(terrain, -6, -6, lights)
  addTorch(terrain, 6, 6, lights)
  addTorch(terrain, -6, 6, lights)
  addTorch(terrain, 6, -6, lights)

  addMailbox(terrain, 0, -8)
  addBench(terrain, -8, 0)
  addBench(terrain, 8, 0)

  addTree(terrain, -11, 10)
  addTree(terrain, 11, -10)
}

export const buildDemoMap = (theme: SceneTheme): DemoMap => {
  const terrain = new VoxelTerrain()
  const torchLights: THREE.PointLight[] = []
  if (theme === 'cityBlock') buildCityBlock(terrain, torchLights)
  else buildInboxPlaza(terrain, torchLights)
  return { group: terrain.group, bounds: defaultBounds, torchLights }
}
