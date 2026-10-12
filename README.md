# Type Zoo

Type Zoo is a small typography studio for NIP-5D napplet runtimes. Three
original animal editors turn short journal entries into six distinct card
layouts, then keep text-only copies in the user's private napplet storage.

## Product scope

- The first screen is a seven-day calendar with a chronological note timeline.
- Mallow Note, Pip Pocket, Moss Spring, and Pip Caller are complete one-click visual
  packages; users do not configure character, paper, and typography separately.
- The paper itself is the editor, so every keystroke is already the final card.
- Complete packages live in `src/formats.ts`, making the format shelf easy to
  extend without changing editor logic.
- When the host provides `outbox`, a finished card can be published directly as
  a signed Nostr kind-1 note without exposing a private key to the napplet.
- Repeated Done actions are idempotent: an unchanged card reports Already saved.
- Saved cards can be searched, reopened, and removed.
- Drafts are saved automatically.
- The interface is English-only in this release.
- No TinyType names, characters, illustrations, or templates are copied.

Type Zoo requires the `storage` NAP domain. `theme` is optional; when it is not
available, the app uses its complete warm-paper fallback palette. The app does
not access browser storage, the network, Nostr relays, private keys, or external
assets directly.

## Develop and verify

```bash
pnpm install
pnpm verify
pnpm test:conformance
```

For a real runtime preview, use Paja instead of opening Vite directly:

```bash
napplet paja -- pnpm vite --host 127.0.0.1
```

The build emits one self-contained `dist/index.html` through
`@napplet/vite-plugin` with `artifactMode: 'single-file'`.

## Deployment metadata

The project is initialized as the named d-tag `type-zoo`. Add deployment relays
and Blossom servers in `.napplet/config.json` through `napplet init` before a
network deploy.

## Authoring context

Protocol-facing changes should follow the bundled documents in `docs/`. Agent
guidance can be installed with:

```bash
npx skills add napplet/napplet
```
