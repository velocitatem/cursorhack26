import { useCallback, useState } from 'react'
import { SceneDirector } from './SceneDirector'
import type { ChoiceSelection } from './types'

const delay = (ms: number) =>
  new Promise<void>(resolve => {
    window.setTimeout(resolve, ms)
  })

export const useSceneLoader = () => {
  const [director] = useState(() => new SceneDirector())
  const [scene, setScene] = useState(() => director.getCurrentScene())
  const [trace, setTrace] = useState(() => director.getTrace())
  const [isAdvancing, setIsAdvancing] = useState(false)

  const chooseOption = useCallback(async (selection: ChoiceSelection) => {
    setIsAdvancing(true)
    await delay(180)

    const result = director.choose(selection)

    setScene(result.scene)
    setTrace(result.trace)
    setIsAdvancing(false)

    return result.scene
  }, [director])

  const restart = useCallback(() => {
    const nextScene = director.restart()
    setScene(nextScene)
    setTrace(director.getTrace())
    setIsAdvancing(false)
  }, [director])

  return {
    scene,
    trace,
    isAdvancing,
    chooseOption,
    restart,
  }
}
