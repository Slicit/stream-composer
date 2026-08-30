import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/setupTests.ts'],
      globals: true,
      // e2e/*.spec.ts are Playwright specs (test.describe from
      // @playwright/test, a different runner) - vitest's default include
      // glob otherwise picks them up too and fails on the API mismatch.
      exclude: [...configDefaults.exclude, 'e2e/**'],
    },
  }),
)
