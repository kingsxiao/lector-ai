import { exec, spawn } from 'child_process'
import { watch } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import readline from 'readline'

const __dirname = dirname(fileURLToPath(import.meta.url))
const rootDir = resolve(__dirname, '..')

console.log('🚀 Lector AI Extension - Development Mode')
console.log('')
console.log('Commands:')
console.log('  r + Enter  - Rebuild extension')
console.log('  p + Enter  - Open Chrome extensions page')
console.log('  q + Enter  - Quit')
console.log('')

let buildProcess = null
let building = false

function build() {
  if (building) return
  building = true
  
  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] 🔄 Building...`)
  
  buildProcess = spawn('npm', ['run', 'build:extension'], {
    cwd: rootDir,
    shell: true
  })
  
  buildProcess.stdout.on('data', (data) => {
    process.stdout.write(data)
  })
  
  buildProcess.stderr.on('data', (data) => {
    process.stderr.write(data)
  })
  
  buildProcess.on('close', (code) => {
    building = false
    if (code === 0) {
      console.log('')
      console.log(`[${new Date().toLocaleTimeString()}] ✅ Build complete!`)
      console.log('   → Reload the extension in Chrome to see changes')
      console.log('   → Press r + Enter to rebuild after changes')
      console.log('')
    }
  })
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
})

rl.on('line', (input) => {
  const cmd = input.trim().toLowerCase()
  
  if (cmd === 'r') {
    build()
  } else if (cmd === 'p') {
    exec('open "https://chrome.google.com/webstore/devconsole"')
  } else if (cmd === 'q') {
    console.log('👋 Goodbye!')
    process.exit(0)
  }
})

console.log('👀 Watching for changes...')
build()

const srcDir = resolve(rootDir, 'src')
const watchExtensions = ['.ts', '.tsx', '.css', '.json']

watch(srcDir, { recursive: true }, (eventType, filename) => {
  if (filename && watchExtensions.some(ext => filename.endsWith(ext))) {
    console.log(`[${new Date().toLocaleTimeString()}] 📝 Changed: ${filename}`)
    console.log('   Press r + Enter to rebuild')
  }
})
