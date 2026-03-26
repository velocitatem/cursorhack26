import * as THREE from 'three'
import type { SceneTheme } from '../story/types'

export type WorldContext = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  setTheme: (theme: SceneTheme) => void
  update: (elapsed: number, delta: number) => void
  destroy: () => void
}

type ScenePalette = {
  skyTop: string
  skyHorizon: string
  skyBottom: string
  fog: number
  hemiSky: number
  hemiGround: number
  keyLight: number
  bounceLight: number
  sun: number
}

const paletteByTheme: Record<SceneTheme, ScenePalette> = {
  inboxPlaza: {
    skyTop: '#73c0ff',
    skyHorizon: '#dbf2ff',
    skyBottom: '#f6f1da',
    fog: 0xb4d7f2,
    hemiSky: 0xf1f8ff,
    hemiGround: 0x5e7e55,
    keyLight: 0xfff5d2,
    bounceLight: 0xbad8ff,
    sun: 0xffe6b6,
  },
  cityBlock: {
    skyTop: '#5d89c9',
    skyHorizon: '#d4e1f7',
    skyBottom: '#efe6d8',
    fog: 0xa4b8d4,
    hemiSky: 0xe9f2ff,
    hemiGround: 0x5d6861,
    keyLight: 0xffe4be,
    bounceLight: 0x9ec0eb,
    sun: 0xffd7a0,
  },
}

const makeGradientSky = (palette: ScenePalette) => {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 512
  const context = canvas.getContext('2d')
  if (!context) {
    const fallback = new THREE.Color(0x8ec7ff)
    return {
      texture: null,
      fallback,
    }
  }

  const gradient = context.createLinearGradient(0, 0, 0, canvas.height)
  gradient.addColorStop(0, palette.skyTop)
  gradient.addColorStop(0.58, palette.skyHorizon)
  gradient.addColorStop(1, palette.skyBottom)
  context.fillStyle = gradient
  context.fillRect(0, 0, canvas.width, canvas.height)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.magFilter = THREE.LinearFilter
  texture.minFilter = THREE.LinearFilter

  return {
    texture,
    fallback: new THREE.Color(palette.fog),
  }
}

type CloudEntry = {
  group: THREE.Group
  speed: number
  drift: number
}

const createCloudLayer = () => {
  const group = new THREE.Group()
  const cloudGeometry = new THREE.BoxGeometry(1, 1, 1)
  const cloudMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.92,
    metalness: 0,
    transparent: true,
    opacity: 0.86,
  })
  const clouds: CloudEntry[] = []

  for (let index = 0; index < 28; index += 1) {
    const cluster = new THREE.Group()
    const chunks = 4 + (index % 4)
    for (let chunk = 0; chunk < chunks; chunk += 1) {
      const cloudVoxel = new THREE.Mesh(cloudGeometry, cloudMaterial)
      cloudVoxel.position.set(
        (chunk - chunks / 2) * 1.4,
        (chunk % 2) * 0.6,
        (chunk % 3) * 0.8,
      )
      cloudVoxel.scale.set(1.6, 0.7 + (chunk % 3) * 0.2, 1.4)
      cluster.add(cloudVoxel)
    }

    const angle = (index / 28) * Math.PI * 2
    const radius = 32 + (index % 5) * 6
    cluster.position.set(
      Math.cos(angle) * radius,
      20 + (index % 6) * 1.3,
      Math.sin(angle) * radius,
    )
    cluster.rotation.y = angle
    group.add(cluster)

    clouds.push({
      group: cluster,
      speed: 0.18 + (index % 7) * 0.02,
      drift: (index % 2 === 0 ? 1 : -1) * (0.4 + (index % 5) * 0.08),
    })
  }

  return {
    group,
    update: (elapsed: number, delta: number) => {
      for (const cloud of clouds) {
        cloud.group.position.x += cloud.drift * delta
        if (cloud.group.position.x > 64) cloud.group.position.x = -64
        if (cloud.group.position.x < -64) cloud.group.position.x = 64
        cloud.group.rotation.y += cloud.speed * delta * 0.1
        cloud.group.position.z += Math.sin(elapsed * cloud.speed) * delta * 0.18
      }
    },
    dispose: () => {
      cloudGeometry.dispose()
      cloudMaterial.dispose()
    },
  }
}

export const createWorld = (container: HTMLElement): WorldContext => {
  const scene = new THREE.Scene()
  let activeTheme: SceneTheme = 'inboxPlaza'
  let activeSkyTexture: THREE.Texture | null = null

  const initialPalette = paletteByTheme.inboxPlaza
  const initialSky = makeGradientSky(initialPalette)
  scene.background = initialSky.texture ?? initialSky.fallback
  activeSkyTexture = initialSky.texture
  scene.fog = new THREE.Fog(new THREE.Color(initialPalette.fog), 20, 62)

  const camera = new THREE.PerspectiveCamera(54, 1, 0.1, 220)
  camera.position.set(8, 8.5, 10)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.03
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.tabIndex = 0
  renderer.domElement.style.touchAction = 'none'
  container.appendChild(renderer.domElement)

  const hemi = new THREE.HemisphereLight(initialPalette.hemiSky, initialPalette.hemiGround, 1.25)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(initialPalette.keyLight, 1.22)
  sun.position.set(16, 24, 12)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(1536)
  sun.shadow.camera.near = 4
  sun.shadow.camera.far = 70
  sun.shadow.camera.left = -22
  sun.shadow.camera.right = 22
  sun.shadow.camera.top = 22
  sun.shadow.camera.bottom = -22
  scene.add(sun)

  const bounce = new THREE.DirectionalLight(initialPalette.bounceLight, 0.38)
  bounce.position.set(-10, 8, -14)
  scene.add(bounce)

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(130, 24, 24),
    new THREE.MeshBasicMaterial({
      color: 0x9cd4ff,
      side: THREE.BackSide,
      transparent: true,
      opacity: 0.26,
    }),
  )
  scene.add(skyDome)

  const sunDisc = new THREE.Mesh(
    new THREE.SphereGeometry(1.8, 24, 24),
    new THREE.MeshBasicMaterial({ color: initialPalette.sun }),
  )
  sunDisc.position.set(28, 34, -42)
  scene.add(sunDisc)

  const cloudLayer = createCloudLayer()
  scene.add(cloudLayer.group)

  const setTheme = (theme: SceneTheme) => {
    if (theme === activeTheme) {
      return
    }

    activeTheme = theme
    const palette = paletteByTheme[theme]
    const sky = makeGradientSky(palette)

    if (activeSkyTexture) {
      activeSkyTexture.dispose()
    }

    activeSkyTexture = sky.texture
    scene.background = sky.texture ?? sky.fallback
    ;(scene.fog as THREE.Fog).color.setHex(palette.fog)
    hemi.color.setHex(palette.hemiSky)
    hemi.groundColor.setHex(palette.hemiGround)
    sun.color.setHex(palette.keyLight)
    bounce.color.setHex(palette.bounceLight)
    ;(sunDisc.material as THREE.MeshBasicMaterial).color.setHex(palette.sun)
  }

  const resize = () => {
    const width = Math.max(container.clientWidth, 1)
    const height = Math.max(container.clientHeight, 1)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
  }

  resize()
  window.addEventListener('resize', resize)

  return {
    scene,
    camera,
    renderer,
    setTheme,
    update: (elapsed, delta) => {
      cloudLayer.update(elapsed, delta)
      sunDisc.position.y = 34 + Math.sin(elapsed * 0.08) * 1.4
    },
    destroy: () => {
      window.removeEventListener('resize', resize)
      cloudLayer.dispose()
      if (activeSkyTexture) {
        activeSkyTexture.dispose()
      }
      ;(skyDome.geometry as THREE.SphereGeometry).dispose()
      ;(skyDome.material as THREE.MeshBasicMaterial).dispose()
      ;(sunDisc.geometry as THREE.SphereGeometry).dispose()
      ;(sunDisc.material as THREE.MeshBasicMaterial).dispose()
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    },
  }
}
