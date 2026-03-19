import { execSync } from 'child_process'
import { copyFileSync, mkdirSync, existsSync, rmSync, readdirSync, cpSync } from 'fs'
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

// Copy manifest.json to dist
console.log('Copying manifest.json...')
copyFileSync(
  resolve(rootDir, 'src/manifest.json'),
  resolve(distDir, 'manifest.json')
)

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

// Rename popup/index.html to just index.html in dist
const popupHtmlSrc = resolve(distDir, 'src/popup/index.html')
const popupHtmlDest = resolve(distDir, 'popup/index.html')
if (existsSync(popupHtmlSrc)) {
  mkdirSync(resolve(distDir, 'popup'), { recursive: true })
  cpSync(popupHtmlSrc, popupHtmlDest)
  rmSync(resolve(distDir, 'src'), { recursive: true })
}

// Update manifest paths
let manifest = require(resolve(distDir, 'manifest.json'))
manifest.action.default_popup = 'popup/index.html'
manifest.background.service_worker = 'background.js'

console.log('✅ Extension built successfully!')
console.log(`📁 Output: ${distDir}`)
console.log('')
console.log('To load the extension:')
console.log('1. Open Chrome and go to chrome://extensions/')
console.log('2. Enable "Developer mode"')
console.log('3. Click "Load unpacked" and select the dist folder')
