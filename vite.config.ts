import { defineConfig } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  server: {
    // Dev only. A shell sandboxes the napplet without `allow-same-origin`, so the
    // frame requests its own entry module with `Origin: null`. Vite's default CORS
    // allowlist covers only localhost origins and rejects that, leaving the frame
    // blank. Does not affect the built artifact.
    cors: { origin: '*' },
  },
  build: {
    // Vite's module-preload polyfill calls `fetch`; one inlined entry needs no
    // preload graph, and NIP-5D napplet code has no ambient network authority.
    modulePreload: { polyfill: false },
  },
  plugins: [
    // Produce one self-contained `/index.html` for NIP-5D `srcdoc` loading,
    // then content-address it with the NIP-5A tag/hash schema.
    nip5aManifest({
      nappletType: 'type-zoo',
      artifactMode: 'single-file',
      requires: ['outbox', 'upload'],
    }),
  ],
});
