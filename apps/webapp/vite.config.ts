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
  const apiTarget = resolveProxyTarget(env.VITE_API_BASE_URL || env.VITE_STORY_API_BASE_URL)

  return {
    envDir: workspaceRoot,
    assetsInclude: ['**/*.fbx'],
    server: {
      fs: {
        allow: [workspaceRoot],
      },
      proxy: {
        '/api': {
          target: apiTarget,
          changeOrigin: true,
          rewrite: path => path.replace(/^\/api/, ''),
        },
      },
    },
    plugins: [
      react(),
      babel({ presets: [reactCompilerPreset()] })
    ],
  }
})
