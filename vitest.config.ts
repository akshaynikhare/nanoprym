import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/tom/**', 'src/**/*.test.ts', 'src/**/*.d.ts'],
      thresholds: {
        statements: 60,
        branches: 80,
        functions: 60,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@agents': path.resolve(__dirname, './src/agents'),
      '@providers': path.resolve(__dirname, './src/providers'),
      '@shared': path.resolve(__dirname, './src/_shared'),
      '@plugins': path.resolve(__dirname, './src/plugins'),
    },
  },
});
