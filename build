/**

- build.js — Nuvio Provider Build Script
- 
- Bundles src/<provider>/index.js into providers/<provider>.js
- and transpiles async/await for the Hermes JS engine.
- 
- Usage:
- node build.js ai-translator      # Build one provider
- node build.js                    # Build all providers
- node build.js –watch            # Watch mode
  */

const esbuild = require(“esbuild”);
const fs = require(“fs”);
const path = require(“path”);

const args = process.argv.slice(2);
const watchMode = args.includes(”–watch”);
const targets = args.filter((a) => !a.startsWith(”–”));

// Find all provider source directories
function getProviders() {
const srcDir = path.join(__dirname, “src”);
if (!fs.existsSync(srcDir)) return [];
return fs
.readdirSync(srcDir)
.filter(
(name) =>
!name.startsWith(”_”) &&
fs.statSync(path.join(srcDir, name)).isDirectory() &&
fs.existsSync(path.join(srcDir, name, “index.js”))
);
}

async function buildProvider(name) {
const entry = path.join(__dirname, “src”, name, “index.js”);
const out = path.join(__dirname, “providers”, `${name}.js`);

console.log(`[Build] Building ${name}...`);

await esbuild.build({
entryPoints: [entry],
bundle: true,
outfile: out,
platform: “neutral”,
target: [“es2016”],    // Transpile async/await → promises for Hermes
format: “cjs”,
minify: false,
sourcemap: false,
define: { “process.env.NODE_ENV”: ‘“production”’ },
});

console.log(`[Build] ✓ Built providers/${name}.js`);
}

async function main() {
const providers = targets.length > 0 ? targets : getProviders();

if (providers.length === 0) {
console.error(”[Build] No providers found in src/”);
process.exit(1);
}

if (watchMode) {
console.log(”[Build] Watch mode — rebuilding on changes…”);
for (const name of providers) {
const entry = path.join(__dirname, “src”, name, “index.js”);
const out = path.join(__dirname, “providers”, `${name}.js`);
const ctx = await esbuild.context({
entryPoints: [entry],
bundle: true,
outfile: out,
platform: “neutral”,
target: [“es2016”],
format: “cjs”,
minify: false,
});
await ctx.watch();
console.log(`[Build] Watching ${name}...`);
}
} else {
for (const name of providers) {
await buildProvider(name);
}
console.log(”[Build] All done.”);
}
}

main().catch((e) => {
console.error(”[Build] Failed:”, e.message);
process.exit(1);
});
