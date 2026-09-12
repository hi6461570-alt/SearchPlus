# Search+

Advanced Discord message search plugin for ShiggyCord/Kettu. Ye.

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
