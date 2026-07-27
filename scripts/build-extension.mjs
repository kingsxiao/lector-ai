import { execSync } from 'child_process'
import { copyFileSync, mkdirSync, existsSync, rmSync, readdirSync, cpSync, readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')
const distDir = resolve(rootDir, 'dist')

// Clean dist
if (existsSync(distDir)) {
  rmSync(distDir, { recursive: true })
}
mkdirSync(distDir, { recursive: true })

// Build with Vite
console.log('Building with Vite...')
execSync('npm run build', { cwd: rootDir, stdio: 'inherit' })

// Rebuild the content script as a single self-contained IIFE bundle.
// MV3 content scripts cannot be ES modules (content_scripts has no `type:
// "module"` option), so the default ES build above — which emits an `import`
// of a shared chunk — fails at runtime. This standalone config inlines all
// shared deps (byok, i18n) into one content.js with no chunk imports.
console.log('Rebuilding content script as IIFE bundle...')
execSync('npx vite build --config vite.content.config.ts', {
  cwd: rootDir,
  stdio: 'inherit',
})

// Copy manifest.json to dist, stripping the `key` field. The key is kept in
// src/manifest.json so local development uses a stable extension ID, but the
// Chrome Web Store rejects uploads that include it.
console.log('Copying manifest.json...')
const manifestSrc = resolve(rootDir, 'src/manifest.json')
const manifestDest = resolve(distDir, 'manifest.json')
const manifest = JSON.parse(readFileSync(manifestSrc, 'utf8'))
delete manifest.key
writeFileSync(manifestDest, JSON.stringify(manifest, null, 2) + '\n')

// Copy icons
console.log('Copying icons...')
const iconsSrc = resolve(rootDir, 'public/icons')
const iconsDest = resolve(distDir, 'icons')
if (existsSync(iconsSrc)) {
  cpSync(iconsSrc, iconsDest, { recursive: true })
} else {
  mkdirSync(iconsDest, { recursive: true })
}

// Copy content.css
console.log('Copying content.css...')
const contentCssSrc = resolve(rootDir, 'src/content.css')
const contentCssDest = resolve(distDir, 'content.css')
if (existsSync(contentCssSrc)) {
  copyFileSync(contentCssSrc, contentCssDest)
}

// Vite emits each HTML entry under src/<entry>/index.html. Relocate them to
// the dist root so the manifest paths resolve correctly.
function relocateHtml(entryName) {
  const src = resolve(distDir, 'src', entryName, 'index.html')
  const destDir = resolve(distDir, entryName)
  if (existsSync(src)) {
    mkdirSync(destDir, { recursive: true })
    cpSync(src, resolve(destDir, 'index.html'))
  }
}

relocateHtml('sidepanel')

// Remove the leftover src/ tree Vite produced.
const leftoverSrc = resolve(distDir, 'src')
if (existsSync(leftoverSrc)) {
  rmSync(leftoverSrc, { recursive: true })
}

console.log('✅ Extension built successfully!')
console.log(`📁 Output: ${distDir}`)
console.log('')
console.log('To load the extension:')
console.log('1. Open Chrome and go to chrome://extensions/')
console.log('2. Enable "Developer mode"')
console.log('3. Click "Load unpacked" and select the dist folder')
