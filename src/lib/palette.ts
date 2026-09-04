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
