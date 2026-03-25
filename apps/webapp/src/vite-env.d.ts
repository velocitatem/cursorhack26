/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_STORY_API_MODE?: 'backend' | 'stub'
  readonly VITE_STORY_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module 'three/examples/jsm/controls/OrbitControls' {
  import { Camera, EventDispatcher, Vector3 } from 'three'

  export class OrbitControls extends EventDispatcher {
    constructor(object: Camera, domElement?: HTMLElement)
    enabled: boolean
    target: Vector3
    minDistance: number
    maxDistance: number
    minPolarAngle: number
    maxPolarAngle: number
    enableDamping: boolean
    dampingFactor: number
    enablePan: boolean
    update(): void
    dispose(): void
  }
}

declare module 'three/examples/jsm/loaders/FBXLoader.js' {
  import { Group, Loader, LoadingManager } from 'three'

  export class FBXLoader extends Loader<Group> {
    constructor(manager?: LoadingManager)
    loadAsync(url: string, onProgress?: (event: ProgressEvent<EventTarget>) => void): Promise<Group>
  }
}

declare module 'three/examples/jsm/utils/SkeletonUtils.js' {
  import { Object3D } from 'three'

  export function clone<T extends Object3D>(source: T): T
}
