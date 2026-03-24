import * as THREE from 'three'

export type VoxelMaterialType =
  | 'grass'
  | 'dirt'
  | 'stone'
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

const mat = (map: THREE.Texture, color: number, roughness = 0.92, metalness = 0.04) =>
  new THREE.MeshStandardMaterial({ map, color, roughness, metalness })

// dark fantasy palette: all textures tinted toward muted earth tones
const materials: MaterialRecord = {
  grass: [
    mat(grassSide, 0x2a3820),
    mat(grassSide, 0x2a3820),
    mat(grassTop, 0x253018),
    mat(dirt, 0x1e1510),
    mat(grassSide, 0x2a3820),
    mat(grassSide, 0x2a3820),
  ],
  dirt: mat(dirt, 0x1e1510),
  stone: mat(stone, 0x464850, 0.95, 0.06),
  tree: [
    mat(treeSide, 0x2a1c0c),
    mat(treeSide, 0x2a1c0c),
    mat(treeTop, 0x1e1508),
    mat(treeTop, 0x1e1508),
    mat(treeSide, 0x2a1c0c),
    mat(treeSide, 0x2a1c0c),
  ],
  wood: mat(wood, 0x3a2010, 0.9, 0.04),
  leaf: new THREE.MeshStandardMaterial({
    map: leaf,
    color: 0x1e3015,
    transparent: true,
    roughness: 0.95,
  }),
  sand: mat(dirt, 0x3a2e1a),
  glass: new THREE.MeshStandardMaterial({
    color: 0x556678,
    transparent: true,
    opacity: 0.65,
    roughness: 0.1,
    metalness: 0.3,
  }),
  plaza: new THREE.MeshStandardMaterial({
    color: 0x30303a,
    roughness: 0.96,
    metalness: 0.04,
  }),
  mail: new THREE.MeshStandardMaterial({
    color: 0xa06830,
    roughness: 0.72,
    metalness: 0.22,
  }),
  // torch glow - emissive orange
  accent: new THREE.MeshStandardMaterial({
    color: 0xff5500,
    emissive: new THREE.Color(0xff3300),
    emissiveIntensity: 1.4,
    roughness: 0.5,
    metalness: 0.0,
  }),
}

export const getVoxelMaterial = (type: VoxelMaterialType) => materials[type]
