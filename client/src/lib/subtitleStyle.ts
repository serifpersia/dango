export type SubtitleEdge = 'shadow' | 'outline' | 'none'

export interface SubtitleStyleSettings {
  fontSize: number
  position: number
  bgOpacity: number
  bgColor: string
  textColor: string
  edge: SubtitleEdge
  bold: boolean
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  fontSize: 1.8,
  position: 0,
  bgOpacity: 0.5,
  bgColor: '#000000',
  textColor: '#ffffff',
  edge: 'shadow',
  bold: false,
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n))

const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

const readNumber = (key: string, fallback: number, min: number, max: number): number => {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    const parsed = parseFloat(raw)
    return Number.isFinite(parsed) ? clamp(parsed, min, max) : fallback
  } catch {
    return fallback
  }
}

export function loadSubtitleStyle(): SubtitleStyleSettings {
  let edge: SubtitleEdge = DEFAULT_SUBTITLE_STYLE.edge
  let bgColor = DEFAULT_SUBTITLE_STYLE.bgColor
  let textColor = DEFAULT_SUBTITLE_STYLE.textColor
  let bold = DEFAULT_SUBTITLE_STYLE.bold
  try {
    const rawEdge = localStorage.getItem('subtitleEdge')
    if (rawEdge === 'shadow' || rawEdge === 'outline' || rawEdge === 'none') edge = rawEdge
    const rawBg = localStorage.getItem('subtitleBgColor')
    if (isHexColor(rawBg)) bgColor = rawBg
    const rawText = localStorage.getItem('subtitleTextColor')
    if (isHexColor(rawText)) textColor = rawText
    const rawBold = localStorage.getItem('subtitleBold')
    if (rawBold !== null) bold = rawBold === 'true'
  } catch {
    // ignore
  }
  return {
    fontSize: readNumber('subtitleFontSize', DEFAULT_SUBTITLE_STYLE.fontSize, 0.5, 10),
    position: readNumber('subtitlePosition', DEFAULT_SUBTITLE_STYLE.position, 0, 100),
    bgOpacity: readNumber('subtitleBgOpacity', DEFAULT_SUBTITLE_STYLE.bgOpacity, 0, 1),
    bgColor,
    textColor,
    edge,
    bold,
  }
}

export function hexToRgba(hex: string, alpha: number): string {
  const fallback = `rgba(0, 0, 0, ${clamp(alpha, 0, 1)})`
  if (!isHexColor(hex)) return fallback
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1)})`
}

function edgeShadow(edge: SubtitleEdge, bgOpacity: number): string {
  if (edge === 'none') {
    return bgOpacity <= 0 ? '0 1px 3px rgba(0, 0, 0, 0.9)' : 'none'
  }
  if (edge === 'outline') {
    return [
      '-1px 0 0 black',
      '1px 0 0 black',
      '0 -1px 0 black',
      '0 1px 0 black',
      '-1px -1px 0 black',
      '1px -1px 0 black',
      '-1px 1px 0 black',
      '1px 1px 0 black',
      '0 0 6px rgba(0, 0, 0, 0.9)',
    ].join(', ')
  }
  return '0 0 4px black, 0 1px 2px rgba(0, 0, 0, 0.8)'
}

export function buildCueCss(s: SubtitleStyleSettings): string {
  return `
  video::cue {
    font-size: ${s.fontSize}rem !important;
    color: ${s.textColor} !important;
    background-color: ${hexToRgba(s.bgColor, s.bgOpacity)} !important;
    font-weight: ${s.bold ? 'bold' : 'normal'} !important;
    text-shadow: ${edgeShadow(s.edge, s.bgOpacity)} !important;
  }
  `
}

export function buildOverlayCss(s: SubtitleStyleSettings): string {
  return (
    [
      `font-size: ${s.fontSize}rem`,
      `color: ${s.textColor}`,
      `background-color: ${hexToRgba(s.bgColor, s.bgOpacity)}`,
      `font-weight: ${s.bold ? '700' : '400'}`,
      `text-shadow: ${edgeShadow(s.edge, s.bgOpacity)}`,
      'padding: 0.2em 0.5em',
      'border-radius: 0.25em',
      'text-align: center',
      'position: absolute',
      'left: 50%',
      'transform: translateX(-50%)',
      'max-width: 92%',
      'white-space: pre-wrap',
      'overflow-wrap: break-word',
      'line-height: 1.4',
    ].join(';\n') + ';'
  )
}

const ALLOWED_TAGS = new Set(['b', 'i', 'u', 'strong', 'em'])

export function renderCueHtml(raw: string): string {
  const escaped = raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return escaped.replace(/&lt;(\/?)([a-zA-Z]+)&gt;/g, (match, slash: string, tag: string) => {
    if (ALLOWED_TAGS.has(tag.toLowerCase())) return `<${slash}${tag.toLowerCase()}>`
    return match
  })
}

export function stripCueTags(raw: string): string {
  return raw.replace(/<[^>]*>/g, '')
}

export const TEXT_COLOR_PRESETS = ['#ffffff', '#ffff00', '#7CFC00', '#00e5ff', '#ff9ff3', '#ffa502']
export const BG_COLOR_PRESETS = ['#000000', '#1e272e', '#2f3542', '#3d0c02', '#0c3d2e', '#ffffff']

export function fitSubtitleSize(userRem: number, videoH: number): number {
  const userPx = Number.isFinite(userRem) ? userRem * 16 : DEFAULT_SUBTITLE_STYLE.fontSize * 16
  if (!Number.isFinite(videoH) || videoH <= 0) return userPx / 16
  return Math.min(userPx, Math.max(13, videoH * 0.07)) / 16
}

export function formatSubtitleDelay(delayMs: number): string {
  const seconds = Math.abs(delayMs / 1000).toFixed(1)
  if (delayMs > 0) return `+${seconds}s`
  if (delayMs < 0) return `-${seconds}s`
  return '0.0s'
}

export function subtitleBottomPx(video: HTMLVideoElement, positionPct: number): number {
  const vw = video.clientWidth || 0
  const vh = video.clientHeight || 0
  const vr =
    video.videoWidth > 0 && video.videoHeight > 0 ? video.videoWidth / video.videoHeight : 0
  let vidH = vh
  if (vr > 0 && vw > 0 && vh > 0) {
    vidH = vw / vh > vr ? vh : vw / vr
  }
  const band = Math.max(0, (vh - vidH) / 2)
  const lift = (Math.max(0, Math.min(100, Number(positionPct) || 0)) / 100) * vidH
  return band + lift
}
