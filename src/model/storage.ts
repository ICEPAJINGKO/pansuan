import type { AssetNode, CurrencyCode, Portfolio } from '../types'
import { CURRENCIES } from '../lib/format'
import { emptyPortfolio, ROOT_ID } from './portfolio'
import { PALETTE, ROOT_COLOR } from '../lib/palette'
import { uid } from '../lib/id'

const KEY = 'portovanta:portfolio:v1'

export function loadPortfolio(): Portfolio | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    return sanitize(JSON.parse(raw))
  } catch {
    return null
  }
}

export function savePortfolio(portfolio: Portfolio): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(portfolio))
  } catch {
    /* quota or private mode — the diagram still works, it just will not persist */
  }
}

/** Defensive parse — anything unexpected falls back to a sane default. */
export function sanitize(input: unknown): Portfolio {
  const base = emptyPortfolio()
  if (!input || typeof input !== 'object') return base
  const raw = input as Record<string, unknown>

  const currency =
    typeof raw.currency === 'string' && raw.currency in CURRENCIES ? (raw.currency as CurrencyCode) : base.currency

  const capital = Number(raw.capital)
  const seen = new Set<string>([ROOT_ID])

  const node = (value: unknown, depth: number, isRoot: boolean): AssetNode | null => {
    if (!value || typeof value !== 'object' || depth > 12) return null
    const r = value as Record<string, unknown>
    let id = typeof r.id === 'string' && r.id ? r.id : uid()
    if (isRoot) id = ROOT_ID
    else if (seen.has(id)) id = uid()
    seen.add(id)

    const mode = r.mode === 'percent' ? 'percent' : 'amount'
    const num = Number(r.value)
    const color = typeof r.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(r.color) ? r.color : PALETTE[depth % PALETTE.length]
    const children = Array.isArray(r.children)
      ? (r.children.map((c) => node(c, depth + 1, false)).filter(Boolean) as AssetNode[])
      : []

    return {
      id,
      name: typeof r.name === 'string' && r.name.trim() ? r.name.slice(0, 80) : 'ไม่มีชื่อ',
      mode,
      value: Number.isFinite(num) ? Math.max(0, num) : 0,
      color: isRoot ? ROOT_COLOR : color,
      note: typeof r.note === 'string' ? r.note.slice(0, 400) : undefined,
      collapsed: r.collapsed === true,
      children,
    }
  }

  const root = node(raw.root, 0, true) ?? base.root

  return {
    version: 1,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 80) : base.name,
    currency,
    capital: Number.isFinite(capital) && capital >= 0 ? capital : base.capital,
    root,
    updatedAt: Date.now(),
  }
}

/* ---------------------------------------------------------------- *
 * Files
 * ---------------------------------------------------------------- */

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function slug(name: string): string {
  return (
    name
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '')
      .replace(/\s+/g, '-')
      .slice(0, 48) || 'portovanta'
  )
}

export function exportJson(portfolio: Portfolio): void {
  const payload = JSON.stringify({ ...portfolio, exportedAt: new Date().toISOString() }, null, 2)
  download(new Blob([payload], { type: 'application/json' }), `${slug(portfolio.name)}.portovanta.json`)
}

const EXPORT_PAD = 28

/** Theme tokens the exported markup still needs once it leaves the page. */
const EXPORT_TOKENS = [
  '--node-root',
  // the capital card paints itself with the theme accent
  '--accent',
  '--label',
  '--label-dim',
  '--label-faint',
  '--halo',
  '--empty-fill',
  '--empty-stroke',
  '--ribbon',
  '--ribbon-from',
  '--ribbon-to',
  '--text',
  '--export-bg',
] as const

/**
 * Serialise the live diagram into a standalone file: interactive bits removed,
 * the pan/zoom transform replaced by a viewBox around the whole flow, and the
 * active theme's tokens pinned onto the root element so the copy keeps the
 * colours the user is actually looking at.
 */
export function exportSvg(svg: SVGSVGElement, portfolio: Portfolio): void {
  const clone = svg.cloneNode(true) as SVGSVGElement
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.querySelectorAll('[data-export-hide]').forEach((el) => el.remove())
  clone.querySelectorAll('.is-dim').forEach((el) => el.classList.remove('is-dim'))

  const computed = getComputedStyle(document.documentElement)
  for (const token of EXPORT_TOKENS) {
    clone.style.setProperty(token, computed.getPropertyValue(token).trim())
  }

  const worldW = Number(svg.dataset.worldW) || 1200
  const worldH = Number(svg.dataset.worldH) || 720
  const width = Math.round(worldW + EXPORT_PAD * 2)
  const height = Math.round(worldH + EXPORT_PAD * 2)

  const view = clone.querySelector('g')
  if (view) view.setAttribute('transform', `translate(${EXPORT_PAD},${EXPORT_PAD})`)
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  clone.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', 'var(--export-bg)')
  clone.insertBefore(bg, clone.firstChild)

  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = SVG_EXPORT_CSS
  clone.insertBefore(style, clone.firstChild)

  const source = new XMLSerializer().serializeToString(clone)
  download(new Blob([source], { type: 'image/svg+xml;charset=utf-8' }), `${slug(portfolio.name)}.svg`)
}

const SVG_EXPORT_CSS = `
  text { font-family: 'Space Grotesk', 'IBM Plex Sans Thai', system-ui, sans-serif; }
  .sk-link { opacity: var(--ribbon); }
  .sk-name { font-size: 13px; font-weight: 600; }
  .sk-value { font-size: 19px; font-weight: 700; letter-spacing: -0.015em; }
  .sk-sub { font-size: 10.5px; font-family: 'JetBrains Mono', ui-monospace, monospace; }
`

export async function importJson(file: File): Promise<Portfolio> {
  const text = await file.text()
  return sanitize(JSON.parse(text))
}

export function pickJsonFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
    input.onchange = () => resolve(input.files?.[0] ?? null)
    input.oncancel = () => resolve(null)
    input.click()
  })
}
