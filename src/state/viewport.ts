/**
 * The live pan/zoom of the diagram, shared without React state so that
 * dragging never triggers a re-render.
 *
 * The starfield reads it through two CSS custom properties instead of its own
 * animation loop — the values are written on one scoped element, so a pan costs
 * a style recalc on three compositor layers and nothing else.
 */
export const viewport = { x: 0, y: 0, k: 1 }

let parallaxTarget: HTMLElement | null = null

export function setParallaxTarget(el: HTMLElement | null): void {
  parallaxTarget = el
  if (el) publishParallax()
}

export function publishParallax(): void {
  if (!parallaxTarget) return
  parallaxTarget.style.setProperty('--vp-x', `${viewport.x.toFixed(1)}px`)
  parallaxTarget.style.setProperty('--vp-y', `${viewport.y.toFixed(1)}px`)
}
