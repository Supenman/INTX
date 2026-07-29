/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { spawn } from 'child_process';
import { resolve } from 'path';

function backendPlugin() {
  let proc = null;
  return {
    name: 'backend',
    configureServer(server) {
      const backendDir = resolve(__dirname, 'backend');
      proc = spawn('python', ['main.py'], {
        cwd: backendDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });
      proc.stdout.on('data', (d) => server.config.logger.info(d.toString().trimEnd(), { clear: true }));
      proc.stderr.on('data', (d) => server.config.logger.warn(d.toString().trimEnd(), { clear: true }));
      proc.on('error', (e) => server.config.logger.warn(`后端启动失败: ${e.message}`));
      proc.on('exit', (code) => {
        if (code !== 0) server.config.logger.warn(`后端进程退出 (code=${code})`);
      });
    },
    closeBundle() {
      if (proc) { proc.kill(); proc = null; }
    },
  };
}

export default defineConfig({
  plugins: [react(), backendPlugin()],
  server: {
    port: 7351,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:7352',
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    globals: true,
    setupFiles: ['src/test-setup.js'],
  },
});
