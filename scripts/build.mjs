import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { rollup } from "rollup";
import nodeResolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import esbuild from "rollup-plugin-esbuild";

const root = process.cwd();
const watch = process.argv.includes("-w");
const sourceRoot = join(root, "plugins");
const distRoot = join(root, "dist");

async function exists(path) {
    try { await stat(path); return true; } catch { return false; }
}

async function buildPlugin(name) {
    const dir = join(sourceRoot, name);
    const manifestPath = join(dir, "manifest.json");
    const source = join(dir, "index.ts");

    if (!(await exists(manifestPath)) || !(await exists(source))) return;

    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const outDir = join(distRoot, name);

    await mkdir(outDir, { recursive: true });

    const bundle = await rollup({
        input: source,
        plugins: [
            nodeResolve({ extensions: [".mjs", ".js", ".json", ".ts", ".tsx"] }),
            commonjs(),
            esbuild({ target: "es2020", sourceMap: false }),
        ],
        external: id =>
            id.startsWith("@vendetta/") ||
            id === "react" ||
            id === "react-native",
    });

    await bundle.write({
        file: join(outDir, "index.js"),
        format: "iife",
        name: `SearchPlus_${name}`,
        exports: "named",
        inlineDynamicImports: true,
        compact: true,
        globals: {
            react: "window.React",
            "react-native": "vendetta.metro.common.ReactNative",
        },
    });

    await bundle.close();

    const code = await readFile(join(outDir, "index.js"));
    const hash = createHash("sha256").update(code).digest("hex");

    const outputManifest = {
        ...manifest,
        main: "index.js",
        hash,
    };

    await writeFile(join(outDir, "manifest.json"), JSON.stringify(outputManifest, null, 2));
}

async function buildAll() {
    const entries = await readdir(sourceRoot, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory()) await buildPlugin(entry.name);
    }
}

await buildAll();

if (watch) {
    console.log("Search+ build complete. Watch mode requires rerunning the build after source changes.");
}
