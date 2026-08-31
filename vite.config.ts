import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: false,
    rolldownOptions: {
      output: {
        // Vendor 单独成 chunk：业务代码迭代时 three/cannon 缓存不失效，
        // 回访用户每次更新只需重新下载 ~17KB gzip 的业务 chunk
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            { name: 'cannon', test: /node_modules[\\/]cannon-es[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    port: 3000,
    open: true,
  },
});
