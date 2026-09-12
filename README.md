# Search+

Advanced Discord message search plugin for ShiggyCord/Kettu.

## Repository layout

This repository follows the current multi-plugin Vendetta/Kettu-style layout:

- `plugins/SearchPlus/index.ts` — plugin source
- `plugins/SearchPlus/manifest.json` — source manifest
- `base_manifest.json` — shared defaults
- `scripts/build.mjs` — Rollup build
- `dist/SearchPlus/` — generated installable plugin

## Build

```bash
bun install
bun run build
```

Install the generated manifest:

`dist/SearchPlus/manifest.json`

For GitHub raw hosting, use:

`https://raw.githubusercontent.com/hi6461570-alt/SearchPlus/main/dist/SearchPlus/manifest.json`
