import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { createCharacterNameplate } from './characterUi'
import { createVoxelCharacter } from './createVoxelCharacter'
import { characterAssetConfigs } from './fbxAssets'
import type {
  CharacterAnimationState,
  CharacterAppearance,
  CharacterRig,
  CharacterRigKind,
} from './types'

type CharacterClipState = Exclude<CharacterAnimationState, 'idle'>

type LoadedCharacterTemplate = {
  template: THREE.Group
  clipsByState: Partial<Record<CharacterClipState, THREE.AnimationClip>>
}

type HighlightMaterial = THREE.Material & {
  emissive: THREE.Color
  emissiveIntensity: number
  map?: THREE.Texture | null
}

const fbxLoader = new FBXLoader()
const modelCache = new Map<CharacterRigKind, Promise<LoadedCharacterTemplate>>()
const clipCache = new Map<string, Promise<THREE.AnimationClip | null>>()
const warnedFailures = new Set<string>()
const locomotionStates = new Set<CharacterAnimationState>([
  'moveStart',
  'moveLoop',
  'turnLeft',
  'turnRight',
  'turnAround',
])

const animationSettings: Partial<Record<CharacterClipState, {
  loopMode: THREE.AnimationActionLoopStyles
  repetitions: number
  clampWhenFinished: boolean
  fadeDuration: number
}>> = {
  moveStart: {
    loopMode: THREE.LoopOnce,
    repetitions: 1,
    clampWhenFinished: true,
    fadeDuration: 0.18,
  },
  moveLoop: {
    loopMode: THREE.LoopRepeat,
    repetitions: Infinity,
    clampWhenFinished: false,
    fadeDuration: 0.22,
  },
  turnLeft: {
    loopMode: THREE.LoopOnce,
    repetitions: 1,
    clampWhenFinished: true,
    fadeDuration: 0.18,
  },
  turnRight: {
    loopMode: THREE.LoopOnce,
    repetitions: 1,
    clampWhenFinished: true,
    fadeDuration: 0.18,
  },
  turnAround: {
    loopMode: THREE.LoopOnce,
    repetitions: 1,
    clampWhenFinished: true,
    fadeDuration: 0.2,
  },
  interact: {
    loopMode: THREE.LoopOnce,
    repetitions: 1,
    clampWhenFinished: true,
    fadeDuration: 0.16,
  },
  dialogue: {
    loopMode: THREE.LoopRepeat,
    repetitions: Infinity,
    clampWhenFinished: false,
    fadeDuration: 0.16,
  },
  wave: {
    loopMode: THREE.LoopRepeat,
    repetitions: Infinity,
    clampWhenFinished: false,
    fadeDuration: 0.18,
  },
}

const isHighlightMaterial = (material: THREE.Material): material is HighlightMaterial =>
  'emissive' in material &&
  (material as { emissive?: unknown }).emissive instanceof THREE.Color

const prepareMaterial = (material: THREE.Material) => {
  if ('map' in material) {
    const texture = material.map
    if (texture instanceof THREE.Texture) {
      texture.colorSpace = THREE.SRGBColorSpace
    }
  }
}

const prepareScene = (scene: THREE.Object3D) => {
  scene.traverse(object => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }

    object.castShadow = true
    object.receiveShadow = true
    object.frustumCulled = false

    const material = object.material
    if (Array.isArray(material)) {
      for (const entry of material) {
        prepareMaterial(entry)
      }
      return
    }
    prepareMaterial(material)
  })
}

const normalizeTemplate = (scene: THREE.Group, targetHeight: number) => {
  const bounds = new THREE.Box3().setFromObject(scene)
  const size = bounds.getSize(new THREE.Vector3())
  const currentHeight = size.y > 0 ? size.y : 1
  const scale = targetHeight / currentHeight

  scene.scale.setScalar(scale)

  const scaledBounds = new THREE.Box3().setFromObject(scene)
  const center = scaledBounds.getCenter(new THREE.Vector3())

  scene.position.x -= center.x
  scene.position.z -= center.z
  scene.position.y -= scaledBounds.min.y
}

const loadAnimationClip = async (url: string) => {
  const existing = clipCache.get(url)
  if (existing) {
    return existing
  }

  const promise = fbxLoader.loadAsync(url)
    .then(asset => asset.animations[0] ?? null)
    .catch(error => {
      console.warn(`Failed to load FBX animation: ${url}`, error)
      return null
    })

  clipCache.set(url, promise)
  return promise
}

const loadCharacterTemplate = async (kind: CharacterRigKind) => {
  const existing = modelCache.get(kind)
  if (existing) {
    return existing
  }

  const config = characterAssetConfigs[kind]
  const promise = (async () => {
    const template = await fbxLoader.loadAsync(config.modelUrl)
    prepareScene(template)
    normalizeTemplate(template, config.targetHeight)

    const clipEntries = await Promise.all(
      Object.entries(config.animationUrls).map(async ([state, url]) => {
        if (!url) {
          return [state, null] as const
        }
        const clip = await loadAnimationClip(url)
        return [state, clip] as const
      }),
    )

    const clipsByState: Partial<Record<CharacterClipState, THREE.AnimationClip>> = {}

    for (const [state, clip] of clipEntries) {
      if (clip) {
        clipsByState[state as CharacterClipState] = clip
      }
    }

    return {
      template,
      clipsByState,
    }
  })()

  modelCache.set(kind, promise)
  return promise
}

const resolveActionState = (
  state: CharacterAnimationState,
  actions: Partial<Record<CharacterClipState, THREE.AnimationAction>>,
) => {
  if (state === 'idle') {
    return null
  }

  if (actions[state]) {
    return state
  }

  if (locomotionStates.has(state) && actions.moveLoop) {
    return 'moveLoop'
  }

  if (state === 'interact' && actions.wave) {
    return 'wave'
  }

  return null
}

const createLoadedRig = (
  kind: CharacterRigKind,
  appearance: CharacterAppearance,
  template: LoadedCharacterTemplate,
): CharacterRig => {
  const config = characterAssetConfigs[kind]
  const group = new THREE.Group()
  const model = cloneSkeleton(template.template) as THREE.Group
  const highlightMaterials: HighlightMaterial[] = []
  const ownedMaterials: THREE.Material[] = []
  const mixer = new THREE.AnimationMixer(model)
  const actions: Partial<Record<CharacterClipState, THREE.AnimationAction>> = {}
  let currentState: CharacterAnimationState = 'idle'
  let currentActionState: CharacterClipState | null = null
  let currentAction: THREE.AnimationAction | null = null

  model.traverse(object => {
    if (!(object instanceof THREE.Mesh)) {
      return
    }

    object.castShadow = true
    object.receiveShadow = true
    object.frustumCulled = false

    if (Array.isArray(object.material)) {
      const clonedMaterials = object.material.map(entry => {
        const material = entry.clone()
        prepareMaterial(material)
        ownedMaterials.push(material)
        if (isHighlightMaterial(material)) {
          highlightMaterials.push(material)
        }
        return material
      })
      object.material = clonedMaterials
      return
    }

    const material = object.material.clone()
    prepareMaterial(material)
    ownedMaterials.push(material)
    if (isHighlightMaterial(material)) {
      highlightMaterials.push(material)
    }
    object.material = material
  })

  for (const [state, clip] of Object.entries(template.clipsByState)) {
    if (!clip) {
      continue
    }

    actions[state as CharacterClipState] = mixer.clipAction(clip)
  }

  group.add(model)

  const nameplate = appearance.name
    ? createCharacterNameplate(appearance.name, config.nameplateY)
    : null

  if (nameplate) {
    group.add(nameplate)
  }

  const stopCurrentAction = (fadeDuration: number) => {
    if (!currentAction) {
      currentActionState = null
      return
    }
    currentAction.fadeOut(fadeDuration)
    currentAction = null
    currentActionState = null
  }

  return {
    group,
    update: (delta: number, _elapsed: number) => {
      mixer.update(delta)
    },
    setHighlight: (active: boolean) => {
      for (const material of highlightMaterials) {
        material.emissive.setHex(active ? 0x2f5485 : 0x000000)
        material.emissiveIntensity = active ? 0.5 : 0
      }
    },
    setAnimationState: (state: CharacterAnimationState) => {
      if (currentState === state) {
        return
      }

      currentState = state
      const nextState = resolveActionState(state, actions)

      if (!nextState) {
        stopCurrentAction(0.18)
        return
      }

      const nextAction = actions[nextState]
      if (!nextAction) {
        const warningKey = `${kind}:${nextState}`
        if (!warnedFailures.has(warningKey)) {
          warnedFailures.add(warningKey)
          console.warn(`FBX animation state "${nextState}" is unavailable for "${kind}".`)
        }
        stopCurrentAction(0.18)
        return
      }

      if (currentActionState === nextState && currentAction === nextAction) {
        return
      }

      const settings = animationSettings[nextState]
      nextAction.reset()
      nextAction.enabled = true
      nextAction.setLoop(settings?.loopMode ?? THREE.LoopRepeat, settings?.repetitions ?? Infinity)
      nextAction.clampWhenFinished = settings?.clampWhenFinished ?? false
      nextAction.play()

      if (currentAction && currentAction !== nextAction) {
        currentAction.crossFadeTo(nextAction, settings?.fadeDuration ?? 0.18, false)
      } else {
        nextAction.fadeIn(settings?.fadeDuration ?? 0.18)
      }

      currentAction = nextAction
      currentActionState = nextState
    },
    dispose: () => {
      mixer.stopAllAction()
      mixer.uncacheRoot(model)

      if (nameplate?.material.map) {
        nameplate.material.map.dispose()
      }
      nameplate?.material.dispose()

      for (const material of ownedMaterials) {
        material.dispose()
      }
    },
  }
}

export const createCharacterRig = (
  kind: CharacterRigKind,
  appearance: CharacterAppearance = {},
): CharacterRig => {
  const fallbackRig = createVoxelCharacter({
    ...appearance,
    name: undefined,
  })
  const group = new THREE.Group()
  let activeRig: CharacterRig = fallbackRig
  let animationState: CharacterAnimationState = 'idle'
  let highlighted = false
  let disposed = false

  group.add(fallbackRig.group)

  loadCharacterTemplate(kind)
    .then(template => {
      if (disposed) {
        return
      }

      const loadedRig = createLoadedRig(kind, appearance, template)
      loadedRig.setAnimationState(animationState)
      loadedRig.setHighlight(highlighted)

      group.remove(fallbackRig.group)
      fallbackRig.dispose()

      activeRig = loadedRig
      group.add(loadedRig.group)
    })
    .catch(error => {
      const warningKey = `model:${kind}`
      if (!warnedFailures.has(warningKey)) {
        warnedFailures.add(warningKey)
        console.warn(`Failed to load FBX model for "${kind}". Falling back to placeholder rig.`, error)
      }
    })

  return {
    group,
    update: (delta: number, elapsed: number) => {
      activeRig.update(delta, elapsed)
    },
    setHighlight: (active: boolean) => {
      highlighted = active
      activeRig.setHighlight(active)
    },
    setAnimationState: (state: CharacterAnimationState) => {
      animationState = state
      activeRig.setAnimationState(state)
    },
    dispose: () => {
      disposed = true
      activeRig.dispose()
    },
  }
}
