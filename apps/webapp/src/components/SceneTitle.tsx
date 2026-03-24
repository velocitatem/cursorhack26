import type { ScenePayload } from '../game/story/types'

type SceneTitleProps = {
  scene: ScenePayload
}

export const SceneTitle = ({ scene }: SceneTitleProps) => (
  <div className="scene-title" key={scene.sceneId}>
    <div className="scene-title-inner">
      <p className="scene-title-eyebrow">entering</p>
      <h1 className="scene-title-heading">{scene.title}</h1>
      <p className="scene-title-sub">{scene.objective}</p>
    </div>
  </div>
)
