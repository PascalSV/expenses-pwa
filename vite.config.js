import { defineConfig } from 'vite';
import { resolve, dirname } from 'path';
import fs from 'fs';

const __dirname = dirname(new URL(import.meta.url).pathname);

export default defineConfig({
  root: 'src/pwa',
  build: {
    outDir: resolve(__dirname, 'dist'),
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'src/pwa/index.html'),
    },
  },
  plugins: [{
    name: 'fix-pwa-refs',
    enforce: 'post',
    closeBundle() {
      try {
        const htmlPath = resolve(__dirname, 'dist/index.html');
        if (!fs.existsSync(htmlPath)) return;
        let html = fs.readFileSync(htmlPath, 'utf-8');

        // Vite renames manifest.json and icons - fix references back to root
        html = html.replace(/href="\/assets\/manifest-[^"]+"/g, 'href="/manifest.json"');
        html = html.replace(/href="\/assets\/icon-[^"]+"/g, 'href="/icon-192.png"');
        html = html.replace(/src="\/assets\/manifest-[^"]+"/g, 'src="/manifest.json"');
        html = html.replace(/src="\/assets\/icon-[^"]+"/g, 'src="/icon-192.png"');

        fs.writeFileSync(htmlPath, html);
      } catch { /* ignore */ }
    },
  }],
});
