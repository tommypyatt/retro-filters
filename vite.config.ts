import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from any GitHub Pages subpath
  // (https://user.github.io/<repo>/) without knowing the repo name.
  base: './',
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
});
