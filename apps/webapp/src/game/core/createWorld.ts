import * as THREE from 'three'

export type WorldContext = {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
  destroy: () => void
}

export const createWorld = (container: HTMLElement): WorldContext => {
  const scene = new THREE.Scene()
  const background = new THREE.Color(0x7aabd8)

  scene.background = background
  scene.fog = new THREE.Fog(background, 22, 60)

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
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.08
  renderer.domElement.tabIndex = 0
  container.appendChild(renderer.domElement)

  const skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(90, 24, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x87b9ea) },
        horizonColor: { value: new THREE.Color(0xb8d3ea) },
        groundColor: { value: new THREE.Color(0x101924) },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y * 0.5 + 0.5;
          vec3 sky = mix(horizonColor, topColor, smoothstep(0.42, 1.0, h));
          vec3 color = mix(groundColor, sky, smoothstep(0.12, 0.82, h));
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    }),
  )
  scene.add(skyDome)

  const hemi = new THREE.HemisphereLight(0xf4f8ff, 0x50624f, 1.7)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(0xfff4d6, 1.55)
  sun.position.set(16, 22, 11)
  sun.castShadow = true
  sun.shadow.mapSize.setScalar(2048)
  sun.shadow.camera.left = -28
  sun.shadow.camera.right = 28
  sun.shadow.camera.top = 28
  sun.shadow.camera.bottom = -28
  scene.add(sun)

  const bounce = new THREE.DirectionalLight(0x8fc4ff, 0.55)
  bounce.position.set(-12, 10, -16)
  scene.add(bounce)

  const warmFill = new THREE.PointLight(0xffc978, 1.1, 36, 2)
  warmFill.position.set(0, 8, 2)
  scene.add(warmFill)

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
