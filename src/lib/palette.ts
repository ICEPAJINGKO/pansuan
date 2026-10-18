/** Cosmic palette — tuned to glow on a near-black background. */
export const PALETTE = [
  '#7c5cff', // violet
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#34d399', // mint
  '#fbbf24', // amber
  '#60a5fa', // azure
  '#a78bfa', // lavender
  '#fb7185', // coral
  '#2dd4bf', // teal
  '#c084fc', // orchid
  '#facc15', // gold
  '#38bdf8', // sky
] as const

export const ROOT_COLOR = '#e2e8ff'

/*
 * What the colour picker offers. Every row is twelve long to match the twelve
 * columns of the swatch grid, and the three tonal rows share one hue order —
 * red to pink, left to right — so a column reads as one hue at three depths.
 * The first row is PALETTE itself: those are the colours the app hands out and
 * the ones saved portfolios already use, so they keep lighting up as "current".
 */
const PASTEL = [
  '#fca5a5', '#fdba74', '#fcd34d', '#fde047', '#bef264', '#86efac',
  '#5eead4', '#67e8f9', '#93c5fd', '#c4b5fd', '#d8b4fe', '#f9a8d4',
] as const

const VIVID = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#14b8a6', '#06b6d4', '#3b82f6', '#8b5cf6', '#a855f7', '#ec4899',
] as const

const DEEP = [
  '#b91c1c', '#c2410c', '#b45309', '#a16207', '#4d7c0f', '#15803d',
  '#0f766e', '#0e7490', '#1d4ed8', '#6d28d9', '#7e22ce', '#be185d',
] as const

/** Slate, sand and earth. Nothing darker than this — a card has to stay visible on the night theme. */
const MUTED = [
  '#cbd5e1', '#94a3b8', '#64748b', '#475569', '#334155', '#e7d3b0',
  '#d4a373', '#a47148', '#7f5539', '#84a98c', '#52796f', '#2f4858',
] as const

export const SWATCHES: readonly string[] = [...PALETTE, ...PASTEL, ...VIVID, ...DEEP, ...MUTED]

/**
 * `<input type="color">` only understands #rrggbb, while a stored colour may be
 * the short or the alpha form. Anything unreadable falls back to a fixed colour
 * rather than letting the picker silently show black.
 */
export function hex6(color: string): string {
  const c = color.toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(c)) return c
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${c[1]}${c[1]}${c[2]}${c[2]}${c[3]}${c[3]}`
  if (/^#[0-9a-f]{8}$/.test(c)) return c.slice(0, 7)
  return PALETTE[0]
}

/**
 * One family per level. A column of siblings then reads as a group at a glance
 * — capital blue flowing into warm, into violet, into teal — which is the whole
 * point of laying money out as a flow.
 */
export const FAMILIES: readonly (readonly string[])[] = [
  ['#fb7185', '#f472b6', '#f87171', '#fb923c'], // 1 — coral
  ['#8b5cf6', '#a78bfa', '#c084fc', '#818cf8'], // 2 — violet
  ['#22d3ee', '#2dd4bf', '#38bdf8', '#34d399'], // 3 — teal
  ['#fbbf24', '#facc15', '#f59e0b', '#fcd34d'], // 4 — amber
]

/** A colour for a new node: its level's family, skipping what siblings took. */
export function colorFor(taken: readonly string[], depth = 1): string {
  const family = FAMILIES[(Math.max(1, depth) - 1) % FAMILIES.length]
  const used = new Set(taken.map((c) => c.toLowerCase()))
  for (const color of family) {
    if (!used.has(color.toLowerCase())) return color
  }
  return family[taken.length % family.length]
}
