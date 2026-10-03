import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    env: {
      VITE_DYNAMICAL_CATALOG_URL: 'https://catalog.example.test/catalog.json',
      VITE_SOURCE_COOP_URL: 'https://store.example.test/snowfall',
    },
  },
});
