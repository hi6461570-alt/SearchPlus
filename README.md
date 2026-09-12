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
https://raw.githubusercontent.com/hi6461570-alt/SearchPlus/main/manifest.json
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
