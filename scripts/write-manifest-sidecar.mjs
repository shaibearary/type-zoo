// Mirror the `napplet-requires` meta tag into the sidecar the deploy CLI reads.
//
// The @napplet/cli reads `requires` manifest tags ONLY from
// `dist/.nip5a-manifest.json` (the @napplet/vite-plugin sidecar), and the plugin
// writes that sidecar only when VITE_DEV_PRIVKEY_HEX is set — never in a normal
// `pnpm build`. The plugin *does* always emit a
// `<meta name="napplet-requires" content="...">` into the built index.html, so
// read that back and mirror it into the sidecar file the CLI expects. Keeping
// the requires list in one place (vite.config.ts) and translating it here
// avoids a second copy that can drift.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const html = readFileSync('dist/index.html', 'utf8');
const match =
  /<meta\b[^>]*\bname=["']napplet-requires["'][^>]*\bcontent=["']([^"']*)["']/i.exec(html) ??
  /<meta\b[^>]*\bcontent=["']([^"']*)["'][^>]*\bname=["']napplet-requires["']/i.exec(html);

const requires = match ? match[1].split(',').map((s) => s.trim()).filter(Boolean) : [];

mkdirSync('dist', { recursive: true });
writeFileSync('dist/.nip5a-manifest.json', JSON.stringify({ tags: requires.map((d) => ['requires', d]) }, null, 2) + '\n');
console.log(`[postbuild] dist/.nip5a-manifest.json requires: ${requires.join(', ') || '(none)'}`);
