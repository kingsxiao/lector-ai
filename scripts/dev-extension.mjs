import { exec, spawn } from 'child_process'
import { watch } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

console.log('🚀 Starting Lector AI Extension Development...')
console.log('')
console.log('Development mode:')
console.log('  - Edit source files in src/')
console.log('  - Changes auto-rebuild on save')
console.log('  - Press r + Enter in this terminal to reload extension')
console.log('')

let building = false

function build() {
  if (building) return
  building = true
  
  console.log(`[${new Date().toLocaleTimeString()}] Building...`)
  
  const build = spawn('npm', ['run', 'build:extension'], {
    cwd: rootDir,
    shell: true,
    stdio: 'inherit'
  })
  
  build.on('close', () => {
    building = false
    console.log(`[${new Date().toLocaleTimeString()}] Build complete! Reload extension in Chrome.`)
  })
}

build()

process.stdin.on('data', (data) => {
  const input = data.toString().trim()
  if (input === 'r') {
    build()
  }
})
