import { useEffect, useRef, useState } from 'react'
import { setParallaxTarget } from '../state/viewport'

interface Layer {
  /** Tile edge in CSS pixels. Deliberately coprime-ish so the three layers
   *  never line up into a visible grid. */
  tile: number
  count: number
  size: [number, number]
  alpha: [number, number]
  parallax: number
  drift: number
  twinkle: number
}

const LAYERS: Layer[] = [
  { tile: 419, count: 34, size: [0.5, 1.0], alpha: [0.22, 0.5], parallax: 0.014, drift: 240, twinkle: 7.5 },
  { tile: 523, count: 30, size: [0.8, 1.6], alpha: [0.32, 0.68], parallax: 0.04, drift: 170, twinkle: 5.5 },
  { tile: 617, count: 22, size: [1.2, 2.3], alpha: [0.45, 0.95], parallax: 0.09, drift: 120, twinkle: 4 },
]

/** Light themes get ink-coloured specks — the same texture, read as a negative. */
const TINTS: Record<'light' | 'dark', string[]> = {
  dark: ['#ffffff', '#c4d6ff', '#e2cdff', '#ffe7cc'],
  light: ['#1e2a52', '#2f3d70', '#4a3a72', '#5b4a3a'],
}

function tileUrl(layer: Layer, mode: 'light' | 'dark'): string {
  const { tile, count, size, alpha } = layer
  const tints = TINTS[mode]
  const margin = size[1] + 1
  let body = ''
  for (let i = 0; i < count; i++) {
    const cx = (margin + Math.random() * (tile - margin * 2)).toFixed(1)
    const cy = (margin + Math.random() * (tile - margin * 2)).toFixed(1)
    const r = (size[0] + Math.random() * (size[1] - size[0])).toFixed(2)
    const o = (alpha[0] + Math.random() * (alpha[1] - alpha[0])).toFixed(2)
    const fill = tints[(Math.random() * tints.length) | 0]
    body += `<circle cx='${cx}' cy='${cy}' r='${r}' fill='${fill}' opacity='${o}'/>`
  }
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${tile}' height='${tile}'>${body}</svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

/** Built once per theme — the tiles are vector, so they stay crisp at any DPR. */
const cached: Partial<Record<'light' | 'dark', string[]>> = {}
function starTiles(mode: 'light' | 'dark'): string[] {
  return (cached[mode] ??= LAYERS.map((layer) => tileUrl(layer, mode)))
}

/**
 * Three repeating star tiles moved entirely by the compositor: drift and
 * twinkle are CSS keyframes, parallax is a custom property. No canvas, no
 * animation frame, no main-thread work once it is on screen.
 */
export function Starfield({ mode }: { mode: 'light' | 'dark' }) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [shot, setShot] = useState<{ key: number; top: number; from: 'l' | 'r' } | null>(null)

  useEffect(() => {
    setParallaxTarget(ref.current)
    return () => setParallaxTarget(null)
  }, [])

  // One shooting star every so often — a single element on a one-shot CSS
  // animation, scheduled by a timer rather than polled every frame.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer = 0
    let key = 0
    const schedule = () => {
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          setShot({ key: key++, top: 6 + Math.random() * 55, from: Math.random() > 0.5 ? 'l' : 'r' })
        }
        schedule()
      }, 9000 + Math.random() * 16000)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])

  const tiles = starTiles(mode)

  return (
    <div className="starfield" ref={ref} aria-hidden="true">
      {tiles.map((url, i) => (
        <div key={i} className="star-layer" style={{ '--p': LAYERS[i].parallax } as React.CSSProperties}>
          <div
            className="star-drift"
            style={
              {
                backgroundImage: url,
                backgroundSize: `${LAYERS[i].tile}px ${LAYERS[i].tile}px`,
                '--tile': `${LAYERS[i].tile}px`,
                '--drift': `${LAYERS[i].drift}s`,
                '--twinkle': `${LAYERS[i].twinkle}s`,
              } as React.CSSProperties
            }
          />
        </div>
      ))}
      {shot && <span key={shot.key} className={`shooting-star from-${shot.from}`} style={{ top: `${shot.top}%` }} />}
    </div>
  )
}
