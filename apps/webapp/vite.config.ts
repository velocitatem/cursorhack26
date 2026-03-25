import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'

const workspaceRoot = fileURLToPath(new URL('../..', import.meta.url))

const resolveProxyTarget = (value?: string) => {
  if (!value) {
    return 'http://localhost:9812'
  }
  try {
    return new URL(value).origin
  } catch {
    return 'http://localhost:9812'
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, workspaceRoot, '')
  const storyApiTarget = resolveProxyTarget(env.VITE_STORY_API_BASE_URL)

  return {
    envDir: workspaceRoot,
    server: {
      fs: {
        allow: [workspaceRoot],
      },
      proxy: {
        '/auth': {
          target: storyApiTarget,
          changeOrigin: true,
        },
        '/health': {
          target: storyApiTarget,
          changeOrigin: true,
        },
        '/story': {
          target: storyApiTarget,
          changeOrigin: true,
        },
      },
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
  }
})
