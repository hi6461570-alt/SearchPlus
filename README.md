# Search+

Advanced Discord message search plugin for ShiggyCord/Kettu.

## GitHub installation

1. Create a GitHub repository.
2. Upload this entire project.
3. Push it to the `main` branch.
4. GitHub Actions will build `dist/index.js`.
5. In ShiggyCord, open **Settings → Plugins → +**.
6. Add the raw URL to `manifest.json`:

```text
https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/manifest.json
```

Replace `YOUR_USERNAME/YOUR_REPO` with your repository.

The manifest points Shiggy to:

```text
https://raw.githubusercontent.com/YOUR_USERNAME/YOUR_REPO/main/dist/index.js
```

## Local build

```bash
npm install
npm run build
```

The resulting plugin entry is:

```text
dist/index.js
```

## Updating

Push changes to `main`. GitHub Actions rebuilds `dist/index.js`.

If Shiggy caches the old plugin, remove/re-add the plugin or use its plugin reload/update control.

## Notes

Search+ uses Discord's existing client/API modules where available instead of requiring a separate backend.

The exact internal module names can change between Shiggy/Kettu builds. If a future Shiggy build changes those internals, the discovery layer in `src/index.tsx` is the place to update.
