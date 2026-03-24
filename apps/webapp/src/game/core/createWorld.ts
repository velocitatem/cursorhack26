import * as THREE from 'three'

export type WorldContext = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  destroy: () => void
}

export const createWorld = (container: HTMLElement): WorldContext => {
  const scene = new THREE.Scene()
  const background = new THREE.Color(0x8ec7ff)

  scene.background = background
  scene.fog = new THREE.Fog(background, 18, 48)

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 200)
  camera.position.set(7, 8, 9)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.domElement.tabIndex = 0
  container.appendChild(renderer.domElement)

  const hemi = new THREE.HemisphereLight(0xe7f2ff, 0x62835f, 1.4)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xffffff, 1.35)
  sun.position.set(14, 18, 9)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(1024)
  scene.add(sun)

  const bounce = new THREE.DirectionalLight(0xb4d4ff, 0.45)
  bounce.position.set(-10, 8, -14)
  scene.add(bounce)

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
    destroy: () => {
      window.removeEventListener('resize', resize)
      renderer.dispose()
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement)
      }
    },
  }
}
