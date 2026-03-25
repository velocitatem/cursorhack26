import * as THREE from 'three'

export type VoxelMaterialType =
  | 'grass'
  | 'dirt'
  | 'stone'
  | 'cobble'
  | 'moss'
  | 'tree'
  | 'wood'
  | 'spruce'
  | 'roof'
  | 'leaf'
  | 'sand'
  | 'glass'
  | 'plaza'
  | 'path'
  | 'brick'
  | 'book'
  | 'water'
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
const cobble = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/cobblestone.png',
)
const moss = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/mossy_stone_bricks.png',
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
const spruce = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/spruce_planks.png',
)
const roof = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/dark_oak_planks.png',
)
const leaf = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/oak_leaves.png',
)
const sand = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/sand.png',
)
const glass = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/glass.png',
)
const path = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/grass_path_top.png',
)
const brick = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/bricks.png',
)
const book = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/bookshelf.png',
)
const water = loadPixelTexture(
  '../../../../minecraft-threejs/src/static/textures/block/water.png',
)

const createTexturedMaterial = (map: THREE.Texture, color?: number) =>
  new THREE.MeshStandardMaterial({
    map,
    color,
  })

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
  cobble: createTexturedMaterial(cobble),
  moss: createTexturedMaterial(moss),
  tree: [
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeTop),
    createTexturedMaterial(treeTop),
    createTexturedMaterial(treeSide),
    createTexturedMaterial(treeSide),
  ],
  wood: createTexturedMaterial(wood),
  spruce: createTexturedMaterial(spruce),
  roof: createTexturedMaterial(roof),
  leaf: new THREE.MeshStandardMaterial({
    map: leaf,
    color: 0x75b34c,
    transparent: true,
  }),
  sand: createTexturedMaterial(sand),
  glass: new THREE.MeshStandardMaterial({
    map: glass,
    transparent: true,
    opacity: 0.75,
  }),
  plaza: new THREE.MeshStandardMaterial({
    color: 0xa0a6b2,
    roughness: 0.9,
    metalness: 0.05,
  }),
  path: createTexturedMaterial(path, 0xd2c49c),
  brick: createTexturedMaterial(brick),
  book: createTexturedMaterial(book),
  water: new THREE.MeshStandardMaterial({
    map: water,
    color: 0x7ec2ff,
    transparent: true,
    opacity: 0.9,
    roughness: 0.2,
    metalness: 0.08,
    emissive: 0x12334d,
    emissiveIntensity: 0.3,
  }),
  mail: new THREE.MeshStandardMaterial({
    color: 0xf0b54a,
    roughness: 0.7,
    metalness: 0.15,
  }),
  accent: new THREE.MeshStandardMaterial({
    color: 0x5fa8ff,
    roughness: 0.55,
    metalness: 0.1,
  }),
}

export const getVoxelMaterial = (type: VoxelMaterialType) => materials[type]
