import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './ErrorBoundary'
import { useStore } from '../shared/store'
import { buildPaletteCss, normalizeThemeId } from '../shared/themes'
import './index.css'

// 主题色样式必须在首帧渲染之前注入：zustand persist 对 localStorage 的水合
// 是同步的，此刻 getState() 已是持久化后的设置。若等到 App 的 effect 再做，
// 已保存的非默认主题会先闪一帧「暖纸」基线。MV3 CSP 禁内联 <script> 但允许
// <style>（构建脚本同样把整份应用 CSS 内联进 HTML）。
const paletteStyle = document.createElement('style')
paletteStyle.textContent = buildPaletteCss()
document.head.appendChild(paletteStyle)
document.documentElement.dataset.palette = normalizeThemeId(
  useStore.getState().byok.palette
)

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
