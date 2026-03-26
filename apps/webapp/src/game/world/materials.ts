import * as THREE from 'three'

export type VoxelMaterialType =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'brick'
  | 'water'
  | 'tree'
  | 'wood'
  | 'leaf'
  | 'sand'
  | 'glass'
  | 'plaza'
  | 'mail'
  | 'accent'

type MaterialRecord = Record<
  VoxelMaterialType,
  THREE.MeshStandardMaterial | THREE.MeshStandardMaterial[]
>

const textureLoader = new THREE.TextureLoader()

const loadPixelTexture = (relativePath: string) => {
  const texture = textureLoader.load(new URL(relativePath, import.meta.url).href)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.NearestFilter
  texture.minFilter = THREE.NearestMipmapNearestFilter
  return texture
}

const grassTop = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/grass_top_green.png',
)
const grassSide = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/grass_block_side.png',
)
const dirt = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/dirt.png',
)
const stone = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/stone.png',
)
const treeSide = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/oak_log.png',
)
const treeTop = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/oak_log_top.png',
)
const wood = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/oak_planks.png',
)
const leaf = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/oak_leaves.png',
)
const sand = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/sand.png',
)
const brick = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/bricks.png',
)
const smoothStone = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/smooth_stone.png',
)
const water = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/water.png',
)
const glass = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/glass.png',
)

const createTexturedMaterial = (map: THREE.Texture, color?: number) =>
  new THREE.MeshStandardMaterial(
    color === undefined
      ? { map }
      : {
          map,
          color,
        },
  )

const materials: MaterialRecord = {
  grass: [
    createTexturedMaterial(grassSide),
    createTexturedMaterial(grassSide),
    createTexturedMaterial(grassTop),
    createTexturedMaterial(dirt),
    createTexturedMaterial(grassSide),
    createTexturedMaterial(grassSide),
  ],
  dirt: createTexturedMaterial(dirt),
  stone: createTexturedMaterial(stone),
  brick: createTexturedMaterial(brick),
  water: new THREE.MeshStandardMaterial({
    map: water,
    color: 0x86d7ff,
    transparent: true,
    opacity: 0.82,
    roughness: 0.14,
    metalness: 0.08,
  }),
  tree: [
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeTop),
    createTexturedMaterial(treeTop),
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeSide),
  ],
  wood: createTexturedMaterial(wood),
  leaf: new THREE.MeshStandardMaterial({
    map: leaf,
    color: 0x75b34c,
    transparent: true,
  }),
  sand: createTexturedMaterial(sand),
  glass: new THREE.MeshStandardMaterial({
    map: glass,
    transparent: true,
    opacity: 0.72,
    roughness: 0.22,
    metalness: 0.2,
  }),
  plaza: createTexturedMaterial(smoothStone, 0xcfd9de),
  mail: new THREE.MeshStandardMaterial({
    color: 0xffb830,
    roughness: 0.42,
    metalness: 0.15,
    emissive: 0x5a2f00,
    emissiveIntensity: 0.18,
  }),
  accent: new THREE.MeshStandardMaterial({
    color: 0x22ffd8,
    roughness: 0.36,
    metalness: 0.12,
    emissive: 0x00a27f,
    emissiveIntensity: 0.22,
  }),
}

export const getVoxelMaterial = (type: VoxelMaterialType) => materials[type]
