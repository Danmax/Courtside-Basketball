import { defineConfig, loadEnv } from 'vite';
export default defineConfig(({ mode }) => {
  const target = loadEnv(mode, process.cwd(), 'COURTSIDE_API_PROXY').COURTSIDE_API_PROXY;
  return { server: { proxy: target ? { '/api': target } : undefined } };
});
