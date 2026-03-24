import * as THREE from 'three'
import type { SceneChoice } from '../story/types'

const archMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0x2e2a38,
    roughness: 0.88,
    metalness: 0.12,
    flatShading: true,
  })

const portalMat = () =>
  new THREE.MeshStandardMaterial({
    color: 0x1a0a30,
    emissive: new THREE.Color(0x220a40),
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
    depthWrite: false,
  })

const buildArch = () => {
  const mat = archMat()
  const group = new THREE.Group()
  const box = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat)
    mesh.position.set(x, y, z)
    mesh.castShadow = true
    group.add(mesh)
  }
  box(0.35, 3.0, 0.35, -0.8, 1.5, 0)
  box(0.35, 3.0, 0.35, 0.8, 1.5, 0)
  box(2.0, 0.4, 0.35, 0, 3.1, 0)
  box(0.52, 0.52, 0.52, -0.8, 3.1, 0)
  box(0.52, 0.52, 0.52, 0.8, 3.1, 0)
  return { group, mat }
}

const buildPortal = () => {
  const mat = portalMat()
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.45, 2.75), mat)
  mesh.position.set(0, 1.38, 0.02)
  return { mesh, mat }
}

const sprite = (
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  w: number,
  h: number,
  scaleX: number,
  scaleY: number,
  posY: number,
  alwaysOnTop = false,
): THREE.Sprite | null => {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  draw(ctx, w, h)
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({
    map: tex,
    transparent: true,
    depthWrite: false,
    depthTest: !alwaysOnTop,
  })
  const s = new THREE.Sprite(mat)
  s.scale.set(scaleX, scaleY, 1)
  s.position.set(0, posY, 0)
  return s
}

const buildLabel = (label: string) =>
  sprite(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(10, 5, 22, 0.94)'
      ctx.beginPath()
      ctx.roundRect(18, 12, w - 36, h - 24, 12)
      ctx.fill()
      ctx.strokeStyle = 'rgba(160, 80, 255, 0.85)'
      ctx.lineWidth = 3.5
      ctx.beginPath()
      ctx.roundRect(18, 12, w - 36, h - 24, 12)
      ctx.stroke()
      ctx.font = '700 42px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#ead8ff'
      ctx.fillText(label, w / 2, h / 2)
    },
    512,
    116,
    3.6,
    0.8,
    4.4,
    true,
  )

const buildHint = () =>
  sprite(
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h)
      ctx.fillStyle = 'rgba(8, 4, 16, 0.88)'
      ctx.beginPath()
      ctx.roundRect(18, 8, w - 36, h - 16, 16)
      ctx.fill()
      ctx.strokeStyle = 'rgba(130, 50, 255, 0.7)'
      ctx.lineWidth = 3
      ctx.beginPath()
      ctx.roundRect(18, 8, w - 36, h - 16, 16)
      ctx.stroke()
      ctx.font = '600 34px Inter, system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillStyle = '#dcc8ff'
      ctx.fillText('Press E to choose', w / 2, h / 2)
    },
    512,
    92,
    3.2,
    0.58,
    3.5,
    true,
  )

export class DoorEntity {
  readonly choice: SceneChoice
  readonly group = new THREE.Group()
  private readonly _archMat: THREE.MeshStandardMaterial
  private readonly _portalMat: THREE.MeshStandardMaterial
  private readonly _light: THREE.PointLight
  private readonly _hint: THREE.Sprite | null
  private readonly _offset = Math.random() * Math.PI * 2
  private _highlighted = false

  constructor(choice: SceneChoice, pos: THREE.Vector3Like, facing = 0) {
    this.choice = choice
    this.group.position.set(pos.x, pos.y, pos.z)
    this.group.rotation.y = facing

    const { group: arch, mat: am } = buildArch()
    const { mesh: portal, mat: pm } = buildPortal()
    const label = buildLabel(choice.label)
    const hint = buildHint()

    this._archMat = am
    this._portalMat = pm
    this._hint = hint ?? null

    this._light = new THREE.PointLight(0x7722cc, 0.5, 5)
    this._light.position.set(0, 1.5, 0.4)

    this.group.add(arch, portal, this._light)
    if (label) this.group.add(label)
    if (hint) this.group.add(hint)

    this.group.visible = false
  }

  distanceTo(target: THREE.Vector3) {
    return this.group.position.distanceTo(target)
  }

  setVisible(v: boolean) {
    this.group.visible = v
  }

  setHighlighted(active: boolean) {
    this._highlighted = active
    this._archMat.emissive.setHex(active ? 0x3a1a5c : 0x000000)
    this._archMat.emissiveIntensity = active ? 0.55 : 0
    this._light.color.setHex(active ? 0xaa44ff : 0x7722cc)
  }

  update(elapsed: number) {
    if (!this.group.visible) return
    const t = elapsed * 2.2 + this._offset
    const pulse = 0.78 + 0.22 * Math.sin(t)
    const baseIntensity = this._highlighted ? 1.5 : 0.48
    this._portalMat.emissiveIntensity = baseIntensity * pulse
    this._light.intensity = (this._highlighted ? 2.0 : 0.5) * (0.82 + 0.18 * Math.sin(t * 1.3))
    // slowly shift hue between deep purple and violet
    const hue = 0.76 + 0.05 * Math.sin(elapsed * 0.45 + this._offset)
    this._portalMat.emissive.setHSL(hue, 0.95, this._highlighted ? 0.36 : 0.12)
    this._portalMat.color.setHSL(hue, 0.9, this._highlighted ? 0.28 : 0.08)
  }

  setInteractHint(v: boolean) {
    if (this._hint) this._hint.visible = v
  }

  dispose() {
    this._archMat.dispose()
    this._portalMat.dispose()
    if (this._hint?.material.map) this._hint.material.map.dispose()
    this._hint?.material.dispose()
    this.group.traverse(obj => {
      if (!(obj instanceof THREE.Mesh)) return
      obj.geometry.dispose()
      if (obj.material instanceof THREE.Material) obj.material.dispose()
    })
  }
}
