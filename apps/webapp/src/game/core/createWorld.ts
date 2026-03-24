import * as THREE from 'three'

export type WorldContext = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  destroy: () => void
}

export const createWorld = (container: HTMLElement): WorldContext => {
  const scene = new THREE.Scene()
  const skyColor = new THREE.Color(0x1a2a40)

  scene.background = skyColor
  scene.fog = new THREE.Fog(skyColor, 14, 44)

  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200)
  camera.position.set(7, 8, 9)

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.1
  renderer.domElement.tabIndex = 0
  container.appendChild(renderer.domElement)

  // dusk hemisphere: warm sky, dark earth
  const hemi = new THREE.HemisphereLight(0x3a5880, 0x1a1208, 1.05)
  scene.add(hemi)

  // golden setting-sun directional
  const sun = new THREE.DirectionalLight(0xe8a060, 1.15)
  sun.position.set(8, 6, 12)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(1024)
  sun.shadow.camera.near = 1
  sun.shadow.camera.far = 60
  sun.shadow.camera.left = -20
  sun.shadow.camera.right = 20
  sun.shadow.camera.top = 20
  sun.shadow.camera.bottom = -20
  scene.add(sun)

  // cold blue rim/fill from opposite side
  const fill = new THREE.DirectionalLight(0x304870, 0.35)
  fill.position.set(-10, 8, -14)
  scene.add(fill)

  // warm ambient torch glow centered on play area
  const torch = new THREE.PointLight(0xff6020, 0.55, 32)
  torch.position.set(0, 4, 0)
  scene.add(torch)

  const resize = () => {
    const w = Math.max(container.clientWidth, 1)
    const h = Math.max(container.clientHeight, 1)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    renderer.setSize(w, h, false)
  }

  resize()
  window.addEventListener('resize', resize)

  return {
    scene,
    camera,
    renderer,
    destroy: () => {
      window.removeEventListener('resize', resize)
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    },
  }
}
