// 面板主题色（palette）—— 主题定义的单一真源（纯数据 + 纯函数，零 DOM）。
//
// tokens.css 的 :root / :root.dark 仍是「暖纸」的基线（首帧与文档默认）；
// main.tsx 在首帧渲染前把 buildPaletteCss() 生成的 <style> 注入 <head>，
// 并在 <html> 上设置 data-palette 属性，按主题覆盖同一批 CSS token：
//   :root[data-palette='ink']            → 亮色靛墨
//   :root.dark[data-palette='ink']       → 暗色靛墨
// 组件层只引用 token（bg / surface / accent …），永不感知具体主题。
//
// 每个 token 同时产出 `--x`（hex）与 `--x-rgb`（"r g b" 三元组）——后者供
// tailwind.config 的 <alpha-value> 透明度修饰符使用（见 tokens.css 头注）。
// 与 tokens.css 手工双写不同，这里的 rgb 三元组由 hex 程序化派生，不存在
// 「两处改色」的漂移风险。

export type ThemeId = 'paper' | 'ink' | 'moss' | 'dusk' | 'sea'

/** 一套完整调色板（14 个结构性 token；语义色 danger/success/warn 全主题共享）。 */
export interface ThemePalette {
  bg: string
  surface: string
  surfaceMuted: string
  surfaceSunken: string
  line: string
  lineStrong: string
  ink: string
  inkSoft: string
  inkFaint: string
  accent: string
  accentHover: string
  accentSoft: string
  accentSofter: string
  onAccent: string
}

export interface ThemeDef {
  id: ThemeId
  zh: string
  en: string
  /** 一句话意境描述（选择器下方展示当前选中主题）。 */
  descZh: string
  descEn: string
  light: ThemePalette
  dark: ThemePalette
}

/** camelCase token 键 → CSS 变量名（顺序即生成顺序，与 tokens.css 对齐）。 */
const PALETTE_VARS: ReadonlyArray<[keyof ThemePalette, string]> = [
  ['bg', 'bg'],
  ['surface', 'surface'],
  ['surfaceMuted', 'surface-muted'],
  ['surfaceSunken', 'surface-sunken'],
  ['line', 'line'],
  ['lineStrong', 'line-strong'],
  ['ink', 'ink'],
  ['inkSoft', 'ink-soft'],
  ['inkFaint', 'ink-faint'],
  ['accent', 'accent'],
  ['accentHover', 'accent-hover'],
  ['accentSoft', 'accent-soft'],
  ['accentSofter', 'accent-softer'],
  ['onAccent', 'on-accent'],
]

export const DEFAULT_THEME_ID: ThemeId = 'paper'

/** 「暖纸」——出厂基线，值与 tokens.css 的 :root/:root.dark 完全一致。 */
const PAPER: ThemeDef = {
  id: 'paper',
  zh: '暖纸',
  en: 'Warm Paper',
  descZh: '奶油纸面，焦糖标色',
  descEn: 'Cream paper with a caramel accent',
  light: {
    bg: '#F5EFE3',
    surface: '#FFFFFF',
    surfaceMuted: '#F1E9D8',
    surfaceSunken: '#EBE0C9',
    line: '#E2D5BB',
    lineStrong: '#C9B893',
    ink: '#26211B',
    inkSoft: '#5C5347',
    inkFaint: '#766A56',
    accent: '#8F5E30',
    accentHover: '#7A4E27',
    accentSoft: '#EAD9BE',
    accentSofter: '#F4EBD9',
    onAccent: '#FFF6EA',
  },
  dark: {
    bg: '#1B1712',
    surface: '#251F18',
    surfaceMuted: '#2C251D',
    surfaceSunken: '#352C22',
    line: '#3B3226',
    lineStrong: '#55483A',
    ink: '#EAE0CC',
    inkSoft: '#BFB299',
    inkFaint: '#9A8D72',
    accent: '#C89866',
    accentHover: '#DBAF7E',
    accentSoft: '#3E3123',
    accentSofter: '#342A1F',
    onAccent: '#221709',
  },
}

/** 「靛墨」——冷白纸面与蓝黑墨水。 */
const INK: ThemeDef = {
  id: 'ink',
  zh: '靛墨',
  en: 'Indigo Ink',
  descZh: '冷白纸面，蓝黑墨水',
  descEn: 'Fountain-pen indigo on cool white',
  light: {
    bg: '#EEF1F6',
    surface: '#FFFFFF',
    surfaceMuted: '#E9EDF4',
    surfaceSunken: '#DFE5EF',
    line: '#D6DDE9',
    lineStrong: '#B4C0D6',
    ink: '#1F2738',
    inkSoft: '#4E5A75',
    inkFaint: '#5F6B85',
    accent: '#3D5488',
    accentHover: '#2F4470',
    accentSoft: '#D6DEEE',
    accentSofter: '#E8EDF7',
    onAccent: '#F5F8FF',
  },
  dark: {
    bg: '#141822',
    surface: '#1B202D',
    surfaceMuted: '#212736',
    surfaceSunken: '#283044',
    line: '#303848',
    lineStrong: '#47526B',
    ink: '#E0E5F0',
    inkSoft: '#B0B9CF',
    inkFaint: '#8B95AF',
    accent: '#96AFEA',
    accentHover: '#ACC0F0',
    accentSoft: '#2A3552',
    accentSofter: '#222C46',
    onAccent: '#0E1526',
  },
}

/** 「苔径」——苔绿纸面，松林标色。 */
const MOSS: ThemeDef = {
  id: 'moss',
  zh: '苔径',
  en: 'Moss',
  descZh: '苔绿纸面，松林标色',
  descEn: 'Sage-tinted paper with a forest accent',
  light: {
    bg: '#EFF2E7',
    surface: '#FFFFFF',
    surfaceMuted: '#E9EEE0',
    surfaceSunken: '#DFE6D2',
    line: '#D6DEC8',
    lineStrong: '#B4C0A3',
    ink: '#232920',
    inkSoft: '#4F5946',
    inkFaint: '#5E6A53',
    accent: '#47703C',
    accentHover: '#395C30',
    accentSoft: '#D9E5CE',
    accentSofter: '#EAF1E3',
    onAccent: '#F4FAEF',
  },
  dark: {
    bg: '#131711',
    surface: '#1A201A',
    surfaceMuted: '#202720',
    surfaceSunken: '#262F25',
    line: '#2E382C',
    lineStrong: '#454F3E',
    ink: '#DFE5D7',
    inkSoft: '#B0BAA1',
    inkFaint: '#8C9680',
    accent: '#A6C795',
    accentHover: '#BBD8AC',
    accentSoft: '#2A3727',
    accentSofter: '#232E21',
    onAccent: '#101810',
  },
}

/** 「暮紫」——暮色薄紫落于纸面。 */
const DUSK: ThemeDef = {
  id: 'dusk',
  zh: '暮紫',
  en: 'Dusk',
  descZh: '暮色薄紫，柔和罗兰',
  descEn: 'Evening plum on soft paper',
  light: {
    bg: '#F2EFF4',
    surface: '#FFFFFF',
    surfaceMuted: '#ECE8EF',
    surfaceSunken: '#E2DDE9',
    line: '#D9D3E2',
    lineStrong: '#BAB2C9',
    ink: '#272331',
    inkSoft: '#564F66',
    inkFaint: '#5F586F',
    accent: '#6C4D9C',
    accentHover: '#583C84',
    accentSoft: '#E0D8EC',
    accentSofter: '#EFEAF6',
    onAccent: '#F9F6FD',
  },
  dark: {
    bg: '#171420',
    surface: '#1E1B27',
    surfaceMuted: '#252130',
    surfaceSunken: '#2C2838',
    line: '#342F44',
    lineStrong: '#4B4460',
    ink: '#E3DFEC',
    inkSoft: '#B4AEC7',
    inkFaint: '#908AA6',
    accent: '#B9A0E6',
    accentHover: '#C9B6EE',
    accentSoft: '#322950',
    accentSofter: '#292244',
    onAccent: '#170F28',
  },
}

/** 「海雾」——雾青纸面，深海标色。 */
const SEA: ThemeDef = {
  id: 'sea',
  zh: '海雾',
  en: 'Sea Mist',
  descZh: '雾青纸面，深海标色',
  descEn: 'Misty teal paper, deep-sea accent',
  light: {
    bg: '#E9F1ED',
    surface: '#FFFFFF',
    surfaceMuted: '#E2ECE7',
    surfaceSunken: '#D8E5DF',
    line: '#CFDED7',
    lineStrong: '#A9C1B9',
    ink: '#1E2927',
    inkSoft: '#4C5D5A',
    inkFaint: '#52655F',
    accent: '#1F6F68',
    accentHover: '#175B55',
    accentSoft: '#D2E6E2',
    accentSofter: '#E3F0ED',
    onAccent: '#EFFAF8',
  },
  dark: {
    bg: '#111A19',
    surface: '#182321',
    surfaceMuted: '#1E2A28',
    surfaceSunken: '#253231',
    line: '#2C3B39',
    lineStrong: '#425655',
    ink: '#DCE5E3',
    inkSoft: '#ADBCB9',
    inkFaint: '#899896',
    accent: '#7FC8C0',
    accentHover: '#96D8D1',
    accentSoft: '#1F3B39',
    accentSofter: '#1A3130',
    onAccent: '#071514',
  },
}

export const THEMES: readonly ThemeDef[] = [PAPER, INK, MOSS, DUSK, SEA]

const THEME_IDS = new Set<string>(THEMES.map((t) => t.id))

export function isThemeId(v: unknown): v is ThemeId {
  return typeof v === 'string' && THEME_IDS.has(v)
}

/** 任意存储值 → 合法主题 id（缺省/非法回落 paper，永不抛错）。 */
export function normalizeThemeId(v: unknown): ThemeId {
  return isThemeId(v) ? v : DEFAULT_THEME_ID
}

export function getTheme(id: unknown): ThemeDef {
  const norm = normalizeThemeId(id)
  return THEMES.find((t) => t.id === norm) ?? PAPER
}

// ---------------------------------------------------------------------------
// 颜色小工具（纯函数）。
// ---------------------------------------------------------------------------

/** '#abc' / '#aabbcc' → [r, g, b]；非法输入返回 null。 */
export function hexToRgbTriple(hex: string): [number, number, number] | null {
  const m = hex.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!m) return null
  let h = m[1]
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  const n = parseInt(h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * WCAG 2.x 相对亮度（gamma 校正版）。注意 color.ts 的 relativeLuminance 是
 * 线性近似，只够 content script 的明暗玻璃二分判定；主题配色要过 AA 对比度，
 * 必须用严格版。
 */
export function relativeLuminanceWcag(hex: string): number | null {
  const t = hexToRgbTriple(hex)
  if (!t) return null
  const lin = t.map((c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

/** 两个 hex 之间的 WCAG 对比度（1..21）；非法输入返回 null。 */
export function wcagContrastRatio(a: string, b: string): number | null {
  const la = relativeLuminanceWcag(a)
  const lb = relativeLuminanceWcag(b)
  if (la === null || lb === null) return null
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

// ---------------------------------------------------------------------------
// CSS 生成（运行时注入，见 main.tsx；选择器晚于 tokens.css 故必胜 :root）。
// ---------------------------------------------------------------------------

function paletteDeclarations(p: ThemePalette): string {
  return PALETTE_VARS.map(([key, cssVar]) => {
    const hex = p[key]
    const t = hexToRgbTriple(hex)
    if (!t) throw new Error('themes.ts: bad hex for ' + key + ' = ' + hex)
    return '  --' + cssVar + ': ' + hex + '; --' + cssVar + '-rgb: ' + t[0] + ' ' + t[1] + ' ' + t[2] + ';'
  }).join('\n')
}

/** 生成全部主题的 token 覆盖样式（亮 + 暗）。 */
export function buildPaletteCss(): string {
  return THEMES.map(
    (t) =>
      ":root[data-palette='" + t.id + "'] {\n" + paletteDeclarations(t.light) + '\n}\n' +
      ":root.dark[data-palette='" + t.id + "'] {\n" + paletteDeclarations(t.dark) + '\n}'
  ).join('\n\n')
}
