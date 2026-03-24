import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'

export class FollowCamera {
  private readonly camera: THREE.PerspectiveCamera
  private readonly controls: OrbitControls
  private readonly desiredTarget = new THREE.Vector3()
  private readonly offset = new THREE.Vector3()

  constructor(camera: THREE.PerspectiveCamera, domElement: HTMLElement) {
    this.camera = camera
    this.controls = new OrbitControls(camera, domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.06
    this.controls.enablePan = false
    this.controls.minDistance = 5
    this.controls.maxDistance = 9.5
    // allow camera to look more upward for dramatic RPG framing
    this.controls.minPolarAngle = Math.PI / 5
    this.controls.maxPolarAngle = Math.PI / 2.1
    this.controls.target.set(0, 1.4, 0)
  }

  setEnabled(active: boolean) {
    this.controls.enabled = active
  }

  update(target: THREE.Vector3) {
    this.desiredTarget.copy(target)
    this.controls.target.lerp(this.desiredTarget, 0.14)
    this.controls.update()
  }

  syncToTarget(target: THREE.Vector3) {
    this.offset.subVectors(this.camera.position, this.controls.target)
    this.controls.target.copy(target)
    this.camera.position.copy(target).add(this.offset)
    this.controls.update()
  }

  getPlanarForward(target = new THREE.Vector3()) {
    this.camera.getWorldDirection(target)
    target.y = 0
    if (target.lengthSq() < 0.0001) target.set(0, 0, -1)
    return target.normalize()
  }

  dispose() {
    this.controls.dispose()
  }
}
