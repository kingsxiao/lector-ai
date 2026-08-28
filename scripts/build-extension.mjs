import { execSync } from 'child_process'
import { copyFileSync, mkdirSync, existsSync, rmSync, cpSync, readFileSync, readdirSync, writeFileSync, renameSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'vite'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = resolve(rootDir, 'dist')
// Staging directory: everything is assembled here and only swapped into dist/
// after the manifest validation passes. A failed build (vite error, missing
// artifact) therefore leaves the previous dist/ intact — the loaded unpacked
// extension keeps working instead of pointing at a half-written manifest.
const stagingDir = resolve(rootDir, 'dist.tmp')

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true })
}
mkdirSync(stagingDir, { recursive: true })

// Build with Vite. Both builds run in THIS process via the JS API — two
// execSync('npx vite build') child processes paid double process boot +
// dependency resolution for every build.
// --outDir is redirected to the staging dir; the inline option takes
// precedence over vite.config.ts's build.outDir.
console.log('Building with Vite...')
await build({
  configFile: resolve(rootDir, 'vite.config.ts'),
  build: { outDir: 'dist.tmp' },
})

// Rebuild the content script as a single self-contained IIFE bundle.
// MV3 content scripts cannot be ES modules (content_scripts has no `type:
// "module"` option), so the default ES build above — which emits an `import`
// of a shared chunk — fails at runtime. This standalone config inlines all
// shared deps (byok, i18n) into one content.js with no chunk imports. Its
// emptyOutDir:false keeps the sidepanel/background output already in staging.
console.log('Rebuilding content script as IIFE bundle...')
await build({
  configFile: resolve(rootDir, 'vite.content.config.ts'),
  build: { outDir: 'dist.tmp' },
})

// Copy manifest.json to staging, stripping the `key` field. The key is kept in
// src/manifest.json so local development uses a stable extension ID, but the
// Chrome Web Store rejects uploads that include it.
console.log('Copying manifest.json...')
const manifestSrc = resolve(rootDir, 'src/manifest.json')
const manifestDest = resolve(stagingDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestSrc, 'utf8'))
delete manifest.key
writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + '\n')

// Copy icons
console.log('Copying icons...')
const iconsSrc = resolve(rootDir, 'public/icons')
const iconsDest = resolve(stagingDir, 'icons')
if (existsSync(iconsSrc)) {
  cpSync(iconsSrc, iconsDest, { recursive: true })
} else {
  mkdirSync(iconsDest, { recursive: true })
}

// Copy content.css
console.log('Copying content.css...')
const contentCssSrc = resolve(rootDir, 'src/content.css')
const contentCssDest = resolve(stagingDir, 'content.css')
if (existsSync(contentCssSrc)) {
  copyFileSync(contentCssSrc, contentCssDest)
}

// Vite emits each HTML entry under src/<entry>/index.html. Relocate them to
// the staging root so the manifest paths resolve correctly.
function relocateHtml(entryName) {
  const src = resolve(stagingDir, 'src', entryName, 'index.html')
  const destDir = resolve(stagingDir, entryName)
  if (existsSync(src)) {
    mkdirSync(destDir, { recursive: true })
    cpSync(src, resolve(destDir, 'index.html'))
  }
}

relocateHtml('sidepanel')

// Inline the app stylesheet into the panel HTML. Chrome does not paint the
// side panel until every render-blocking resource finishes loading
// (chromium issue 40915514): a stalled /assets/*.css fetch keeps the panel
// pure WHITE for the entire stall — even though the HTML's inline boot shell
// is ready to render. Inlining removes the last render-blocking external
// resource, so first paint depends on the HTML document alone. (MV3's
// extension-pages CSP restricts inline <script>, not inline <style>.)
console.log('Inlining sidepanel CSS...')
const panelHtmlPath = resolve(stagingDir, 'sidepanel', 'index.html')
let panelHtml = readFileSync(panelHtmlPath, 'utf8')
const linkMatch = panelHtml.match(/<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)">/)
if (!linkMatch) {
  console.error('❌ sidepanel/index.html: expected a stylesheet link to inline — did the Vite HTML output change?')
  process.exit(1)
}
const cssPath = resolve(stagingDir, linkMatch[1].replace(/^\//, ''))
panelHtml = panelHtml.replace(linkMatch[0], `<style>\n${readFileSync(cssPath, 'utf8')}\n</style>`)
writeFileSync(panelHtmlPath, panelHtml)
rmSync(cssPath)
// With its only file gone, assets/ would otherwise be zipped as an empty
// directory entry (it showed up in every dist.zip so far).
const assetsDir = resolve(stagingDir, 'assets')
if (existsSync(assetsDir) && readdirSync(assetsDir).length === 0) {
  rmSync(assetsDir, { recursive: true })
}

// Remove the leftover src/ tree Vite produced.
const leftoverSrc = resolve(stagingDir, 'src')
if (existsSync(leftoverSrc)) {
  rmSync(leftoverSrc, { recursive: true })
}

// Validate the assembled staging dir: every file the manifest references must
// exist. Without this, a silent build miss (empty icons/, unrelocated HTML,
// missing IIFE bundle) still printed "built successfully" and only blew up —
// or worse, quietly no-op'd — when loaded into Chrome.
const missing = []
const checkFile = (relPath) => {
  if (!relPath || typeof relPath !== 'string') return
  if (!existsSync(resolve(stagingDir, relPath))) missing.push(relPath)
}
for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) checkFile(js)
  for (const css of cs.css ?? []) checkFile(css)
}
if (manifest.background?.service_worker) checkFile(manifest.background.service_worker)
if (manifest.side_panel?.default_path) checkFile(manifest.side_panel.default_path)
if (manifest.action?.default_icon) {
  for (const p of Object.values(manifest.action.default_icon)) checkFile(p)
}
if (manifest.icons) {
  for (const p of Object.values(manifest.icons)) checkFile(p)
}
if (missing.length > 0) {
  console.error('❌ Build incomplete — manifest references missing files:')
  for (const p of missing) console.error(`   - ${p}`)
  process.exit(1)
}

// Swap the validated staging dir into place. rmSync+renameSync is atomic
// enough for the dev loop: a Chrome reload during the swap sees either the
// complete old dist or the complete new one, never a half-written state.
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true })
}
renameSync(stagingDir, distDir)

// Package dist.zip for the Chrome Web Store. The zip must contain the CONTENTS
// of dist/ — manifest.json at the archive root. Zipping the dist folder itself
// (`zip -r dist.zip dist`) nests everything under dist/ and got 0.4.0 rejected
// ("broken functionality": the store can't resolve manifest-relative paths).
const zipPath = resolve(rootDir, 'dist.zip')
if (existsSync(zipPath)) {
  rmSync(zipPath)
}
console.log('Packaging dist.zip (manifest.json at zip root)...')
execSync('zip -rX -q ../dist.zip . -x "*.DS_Store" -x "__MACOSX*"', { cwd: distDir })

// Self-check the archive: manifest.json at root, no dist/ nesting, no macOS
// junk, and every file the manifest references actually inside the zip.
const zipEntries = new Set(
  execSync('unzip -Z1 dist.zip', { cwd: rootDir })
    .toString()
    .split('\n')
    .filter(Boolean),
)
const zipProblems = []
if (!zipEntries.has('manifest.json')) zipProblems.push('manifest.json is not at the zip root')
for (const entry of zipEntries) {
  if (entry.startsWith('dist/') || entry.includes('__MACOSX') || entry.endsWith('.DS_Store')) {
    zipProblems.push(`unexpected entry in zip: ${entry}`)
  }
}
const manifestReferenced = [
  ...(manifest.content_scripts ?? []).flatMap((cs) => [...(cs.js ?? []), ...(cs.css ?? [])]),
  manifest.background?.service_worker,
  manifest.side_panel?.default_path,
  ...Object.values(manifest.action?.default_icon ?? {}),
  ...Object.values(manifest.icons ?? {}),
].filter(Boolean)
for (const rel of manifestReferenced) {
  if (!zipEntries.has(rel)) zipProblems.push(`manifest-referenced file missing from zip: ${rel}`)
}
if (zipProblems.length > 0) {
  console.error('❌ Packaged dist.zip failed validation:')
  for (const p of zipProblems) console.error(`   - ${p}`)
  process.exit(1)
}

console.log('✅ Extension built successfully!')
console.log(`📁 Output: ${distDir}`)
console.log(`📦 Store upload: ${zipPath} (v${manifest.version}, manifest.json at root, ${zipEntries.size} entries)`)
console.log('')
console.log('To load the extension locally:')
console.log('1. Open Chrome and go to chrome://extensions/')
console.log('2. Enable "Developer mode"')
console.log('3. Click "Load unpacked" and select the dist folder')
console.log('')
console.log('To publish: upload dist.zip in the Chrome Web Store developer dashboard.')
