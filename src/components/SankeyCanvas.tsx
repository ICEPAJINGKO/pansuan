import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ComputedTree, CurrencyCode } from '../types'
import { CARD_RADIUS, CARD_TUCK, layoutSankey, ribbonPath, type SankeyLayout } from '../model/layout'
import { CURRENCIES, formatCompact, formatMoney, formatPercent } from '../lib/format'
import { publishParallax, viewport } from '../state/viewport'
import { ROOT_ID } from '../model/portfolio'
import { ROOT_COLOR } from '../lib/palette'
import type { SelectHandler } from '../App'

const MIN_ZOOM = 0.2
const MAX_ZOOM = 3.2
/** Fitting never blows a tiny portfolio up to fill the screen. */
const FIT_ZOOM = 1.25
/** Time constant of the geometry easing, in ms. Lower = snappier. */
const TAU = 95
const SETTLE = 0.12

/** The capital node has no colour of its own — it takes the theme's accent. */
const paintOf = (color: string) => (color === ROOT_COLOR ? 'var(--accent)' : color)
const gradKey = (from: string, to: string) => `g${paintOf(from)}${paintOf(to)}`.replace(/[^a-z0-9]/gi, '')
/** Every card is its colour falling away into the background at its foot. */
const cardKey = (color: string) => `c${paintOf(color)}`.replace(/[^a-z0-9]/gi, '')
const cardFoot = (color: string) => `color-mix(in srgb, ${paintOf(color)} 74%, #05070f)`

/** Cards are wide enough for the real number; only a fortune gets shortened. */
const COMPACT_ABOVE = 1e7

/**
 * Which ink a card can carry. A palette that runs from crimson to gold cannot
 * take white type throughout — the bright half needs dark, and the only honest
 * way to decide is the card's own luminance.
 */
function ink(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#ffffff' // the capital card takes the accent
  const n = parseInt(color.slice(1), 16)
  const lift = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const lum = 0.2126 * lift((n >> 16) & 255) + 0.7152 * lift((n >> 8) & 255) + 0.0722 * lift(n & 255)
  return lum > 0.42 ? '#0a0f22' : '#ffffff'
}

interface Anim {
  x: number
  y: number
  h: number
}

export interface SankeyCanvasProps {
  tree: ComputedTree
  currency: CurrencyCode
  /** Printed huge and faint behind the flow, the way a poster carries a name. */
  title: string
  selection: string[]
  onSelect: SelectHandler
  onSelectMany: (ids: string[]) => void
  onToggleCollapse: (id: string) => void
  onAddChild: (id: string) => void
  /** Arms the shared move gesture — the tree panel starts the very same one. */
  onDragNode: (e: React.PointerEvent, id: string) => void
  /** Set while a move is in flight, so the click that ends it is ignored. */
  dragRef: React.RefObject<boolean>
  /** True for as long as a move is being aimed — the diagram holds its frame. */
  dragging: boolean
  svgRef: React.RefObject<SVGSVGElement | null>
}

/** Extra width to the right of a card that a marquee still counts as a hit. */
const MARQUEE_REACH = 24

export const SankeyCanvas = memo(function SankeyCanvas({
  tree,
  currency,
  title,
  selection,
  onSelect,
  onSelectMany,
  onToggleCollapse,
  onAddChild,
  onDragNode,
  dragRef,
  dragging,
  svgRef,
}: SankeyCanvasProps) {
  const gid = useId().replace(/:/g, '')
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<SVGGElement | null>(null)
  const tipRef = useRef<HTMLDivElement | null>(null)
  const marqueeRef = useRef<HTMLDivElement | null>(null)

  const linkRefs = useRef(new Map<string, SVGPathElement>())
  const nodeAnim = useRef(new Map<string, Anim>())

  const [hoverId, setHoverId] = useState<string | null>(null)
  const [zoomLabel, setZoomLabel] = useState(1)

  const layout = useMemo(() => layoutSankey(tree), [tree])
  const layoutRef = useRef<SankeyLayout>(layout)
  layoutRef.current = layout

  const reducedRef = useRef(false)
  useEffect(() => {
    reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  /* ---------------- view transform ---------------- */

  const applyView = useCallback(() => {
    const g = viewRef.current
    if (!g) return
    g.setAttribute('transform', `translate(${viewport.x.toFixed(2)},${viewport.y.toFixed(2)}) scale(${viewport.k.toFixed(4)})`)
    publishParallax()
  }, [])

  const userAdjusted = useRef(false)

  const fitToView = useCallback(
    (animate = true) => {
      const wrap = wrapRef.current
      const l = layoutRef.current
      if (!wrap) return
      const vw = wrap.clientWidth
      const vh = wrap.clientHeight
      if (vw < 40 || vh < 40) return
      const k = Math.min(FIT_ZOOM, Math.max(MIN_ZOOM, Math.min((vw - 48) / l.width, (vh - 48) / l.height)))
      const x = (vw - l.width * k) / 2
      const y = (vh - l.height * k) / 2
      if (animate && !reducedRef.current) {
        tweenView(x, y, k)
      } else {
        viewport.x = x
        viewport.y = y
        viewport.k = k
        applyView()
      }
      setZoomLabel(k)
      userAdjusted.current = false
    },
    [applyView],
  )

  const viewTween = useRef<number | null>(null)
  const tweenView = useCallback(
    (tx: number, ty: number, tk: number) => {
      if (viewTween.current) cancelAnimationFrame(viewTween.current)
      const sx = viewport.x
      const sy = viewport.y
      const sk = viewport.k
      const start = performance.now()
      const dur = 420
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / dur)
        const e = 1 - Math.pow(1 - t, 3)
        viewport.x = sx + (tx - sx) * e
        viewport.y = sy + (ty - sy) * e
        viewport.k = sk + (tk - sk) * e
        applyView()
        if (t < 1) viewTween.current = requestAnimationFrame(step)
        else viewTween.current = null
      }
      viewTween.current = requestAnimationFrame(step)
    },
    [applyView],
  )

  const zoomAt = useCallback(
    (factor: number, cx: number, cy: number) => {
      const k = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.k * factor))
      if (k === viewport.k) return
      const ratio = k / viewport.k
      viewport.x = cx - (cx - viewport.x) * ratio
      viewport.y = cy - (cy - viewport.y) * ratio
      viewport.k = k
      applyView()
      setZoomLabel(k)
      userAdjusted.current = true
    },
    [applyView],
  )

  /* ---------------- geometry animation ---------------- */

  interface Parts {
    g: SVGGElement
    bar: SVGRectElement
    rem: SVGRectElement
    hit: SVGRectElement
    label: SVGGElement
  }

  const parts = useRef(new Map<string, Parts>())

  const registerNode = useCallback((el: SVGGElement | null) => {
    if (!el) return () => {}
    const id = el.dataset.id as string
    parts.current.set(id, {
      g: el,
      bar: el.querySelector('.sk-bar') as SVGRectElement,
      rem: el.querySelector('.sk-rem') as SVGRectElement,
      hit: el.querySelector('.sk-hit') as SVGRectElement,
      label: el.querySelector('.sk-label') as SVGGElement,
    })
    return () => {
      parts.current.delete(id)
    }
  }, [])

  const registerLink = useCallback((el: SVGPathElement | null) => {
    if (!el) return () => {}
    const id = el.dataset.id as string
    linkRefs.current.set(id, el)
    return () => {
      linkRefs.current.delete(id)
    }
  }, [])

  const linksBySource = useMemo(() => {
    const map = new Map<string, typeof layout.links>()
    for (const link of layout.links) {
      const list = map.get(link.sourceId)
      if (list) list.push(link)
      else map.set(link.sourceId, [link])
    }
    return map
  }, [layout])

  const rafRef = useRef<number | null>(null)
  const lastTs = useRef(0)
  const firstPaint = useRef(true)

  const paint = useCallback(
    (ease: number) => {
      const l = layoutRef.current
      const anim = nodeAnim.current
      let moving = false

      for (const node of l.nodes) {
        const a = anim.get(node.id)
        const p = parts.current.get(node.id)
        if (!a || !p) continue

        const dx = node.x - a.x
        const dy = node.y - a.y
        const dh = node.h - a.h
        if (Math.abs(dx) > SETTLE || Math.abs(dy) > SETTLE || Math.abs(dh) > SETTLE) {
          a.x += dx * ease
          a.y += dy * ease
          a.h += dh * ease
          moving = true
        } else {
          a.x = node.x
          a.y = node.y
          a.h = node.h
        }

        const h = Math.max(0.6, a.h)
        p.g.setAttribute('transform', `translate(${a.x.toFixed(2)},${a.y.toFixed(2)})`)
        p.bar.setAttribute('height', h.toFixed(2))
        p.hit.setAttribute('height', (h + 12).toFixed(2))
        // The text block rides the middle of the card, whatever height it is.
        p.label.setAttribute('transform', `translate(0,${(h / 2).toFixed(2)})`)
      }

      // Ribbons are rebuilt from the animated node boxes so the band always
      // stays flush with its source, mid-flight included. Each one leaves at the
      // share of the parent it truly is and arrives at the width of the card it
      // feeds, so the money reads correctly at the edge that carries it.
      for (const [sourceId, list] of linksBySource) {
        const s = anim.get(sourceId)
        const sp = parts.current.get(sourceId)
        const node = l.byId.get(sourceId)
        if (!s || !sp || !node) continue
        // Both ends finish under their card rather than against it, so every
        // ribbon edge lines up with a card edge instead of cutting its corner.
        const x0 = s.x + node.w - CARD_TUCK
        const span = Math.max(node.amount, node.allocated) || 1
        let offset = 0
        for (const link of list) {
          const t = anim.get(link.targetId)
          const el = linkRefs.current.get(link.id)
          const child = l.byId.get(link.targetId)
          if (!t || !el || !child) continue
          const from = Math.max(0.6, (child.amount / span) * s.h)
          el.setAttribute('d', ribbonPath(x0, s.y + offset, t.x + CARD_TUCK, t.y, from, Math.max(0.6, t.h)))
          offset += from
        }
        // Measured off the model, not the band, so the inset above cannot skew it.
        const filled = Math.min(1, node.allocated / span)
        const remainder = node.folded ? 0 : Math.max(0, s.h * (1 - filled))
        sp.rem.setAttribute('y', (s.h - remainder).toFixed(2))
        sp.rem.setAttribute('height', remainder.toFixed(2))
      }

      return moving
    },
    [linksBySource],
  )

  /** (Re)start the easing loop. Always cancels first, so a stale frame id can
   *  never leave the diagram frozen mid-flight. */
  const kick = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    lastTs.current = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(64, now - lastTs.current)
      lastTs.current = now
      const ease = reducedRef.current ? 1 : 1 - Math.exp(-dt / TAU)
      const moving = paint(ease)
      if (moving) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [paint])

  useLayoutEffect(() => {
    const anim = nodeAnim.current
    const live = new Set<string>()

    for (const node of layout.nodes) {
      live.add(node.id)
      let a = anim.get(node.id)
      if (!a) {
        // New nodes unfurl out of their parent instead of popping in.
        const parent = node.parentId ? anim.get(node.parentId) : null
        a = firstPaint.current
          ? { x: node.x, y: node.y, h: node.h }
          : parent
            ? { x: parent.x, y: parent.y + parent.h / 2, h: 0 }
            : { x: node.x, y: node.y, h: 0 }
        anim.set(node.id, a)
      }
    }
    for (const id of [...anim.keys()]) if (!live.has(id)) anim.delete(id)

    firstPaint.current = false
    paint(1e-9)
    kick()
  }, [layout, paint, kick])

  useEffect(() => {
    return () => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (viewTween.current != null) {
        cancelAnimationFrame(viewTween.current)
        viewTween.current = null
      }
    }
  }, [])

  /* ---------------- pointer interaction ---------------- */

  const panState = useRef<{ x: number; y: number; id: number } | null>(null)
  const marqueeState = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const movedRef = useRef(false)

  const onBackgroundDown = useCallback((e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0 && e.button !== 1) return
    const target = e.target as Element
    if (e.button === 0 && target.closest('.sk-node')) return
    e.currentTarget.setPointerCapture(e.pointerId)
    movedRef.current = false

    // Shift turns a background drag into a rubber-band selection.
    if (e.button === 0 && e.shiftKey) {
      const rect = wrapRef.current?.getBoundingClientRect()
      if (!rect) return
      const x = e.clientX - rect.left
      const y = e.clientY - rect.top
      marqueeState.current = { x0: x, y0: y, x1: x, y1: y }
      drawMarquee()
      return
    }

    panState.current = { x: e.clientX - viewport.x, y: e.clientY - viewport.y, id: e.pointerId }
    wrapRef.current?.classList.add('is-panning')
  }, [])

  const drawMarquee = useCallback(() => {
    const box = marqueeRef.current
    const m = marqueeState.current
    if (!box) return
    if (!m) {
      box.hidden = true
      return
    }
    box.hidden = false
    box.style.transform = `translate3d(${Math.min(m.x0, m.x1)}px, ${Math.min(m.y0, m.y1)}px, 0)`
    box.style.width = `${Math.abs(m.x1 - m.x0)}px`
    box.style.height = `${Math.abs(m.y1 - m.y0)}px`
  }, [])

  /** Nodes whose bar (plus its label run) overlaps the rubber band. */
  const nodesInBox = useCallback((box: { x0: number; y0: number; x1: number; y1: number }) => {
    const left = (Math.min(box.x0, box.x1) - viewport.x) / viewport.k
    const right = (Math.max(box.x0, box.x1) - viewport.x) / viewport.k
    const top = (Math.min(box.y0, box.y1) - viewport.y) / viewport.k
    const bottom = (Math.max(box.y0, box.y1) - viewport.y) / viewport.k
    const ids: string[] = []
    for (const node of layoutRef.current.nodes) {
      if (node.isRoot) continue
      const a = nodeAnim.current.get(node.id)
      if (!a) continue
      if (a.x > right || a.x + node.w + MARQUEE_REACH < left) continue
      if (a.y > bottom || a.y + a.h < top) continue
      ids.push(node.id)
    }
    return ids
  }, [])

  const onPointerMove = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      const tip = tipRef.current
      if (tip) {
        const rect = wrapRef.current?.getBoundingClientRect()
        if (rect) {
          const x = e.clientX - rect.left
          const y = e.clientY - rect.top
          tip.style.transform = `translate3d(${x + 18}px, ${y + 16}px, 0)`
          tip.classList.toggle('flip-x', x > rect.width - 260)
          tip.classList.toggle('flip-y', y > rect.height - 140)
        }
      }

      const marquee = marqueeState.current
      if (marquee) {
        const rect = wrapRef.current?.getBoundingClientRect()
        if (rect) {
          marquee.x1 = e.clientX - rect.left
          marquee.y1 = e.clientY - rect.top
          movedRef.current = true
          drawMarquee()
          // Live preview of what the band has caught so far.
          const caught = new Set(nodesInBox(marquee))
          for (const [id, part] of parts.current) {
            part.g.classList.toggle('is-marquee-hit', caught.has(id))
          }
        }
        return
      }

      const pan = panState.current
      if (!pan) return
      viewport.x = e.clientX - pan.x
      viewport.y = e.clientY - pan.y
      movedRef.current = true
      userAdjusted.current = true
      applyView()
    },
    [applyView, drawMarquee, nodesInBox],
  )

  const endGesture = useCallback(
    (e: React.PointerEvent<SVGSVGElement>) => {
      if (panState.current?.id === e.pointerId) {
        panState.current = null
        wrapRef.current?.classList.remove('is-panning')
      }

      const marquee = marqueeState.current
      if (marquee) {
        marqueeState.current = null
        drawMarquee()
        for (const part of parts.current.values()) part.g.classList.remove('is-marquee-hit')
        if (Math.abs(marquee.x1 - marquee.x0) > 4 || Math.abs(marquee.y1 - marquee.y0) > 4) {
          onSelectMany(nodesInBox(marquee))
        }
      }
    },
    [drawMarquee, nodesInBox, onSelectMany],
  )

  const onNodePointerDown = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      movedRef.current = false
      onDragNode(e, e.currentTarget.dataset.id as string)
    },
    [onDragNode],
  )

  const onNodeClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      if (movedRef.current || dragRef.current) return
      const id = e.currentTarget.dataset.id as string
      if (e.detail >= 2) return
      onSelect(id, e.ctrlKey || e.metaKey)
    },
    [onSelect, dragRef],
  )

  const onNodeDoubleClick = useCallback(
    (e: React.MouseEvent<SVGRectElement>) => {
      const id = e.currentTarget.dataset.id as string
      const node = layoutRef.current.byId.get(id)
      if (!node) return
      if (node.hasChildren) onToggleCollapse(id)
      else onAddChild(id)
    },
    [onAddChild, onToggleCollapse],
  )

  const onNodeEnter = useCallback((e: React.PointerEvent<SVGRectElement>) => {
    setHoverId(e.currentTarget.dataset.id as string)
  }, [])

  const onNodeLeave = useCallback(() => setHoverId(null), [])

  /* wheel: zoom at the cursor, shift+wheel pans sideways */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = wrap.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      if (e.shiftKey && !e.ctrlKey) {
        viewport.x -= e.deltaY + e.deltaX
        userAdjusted.current = true
        applyView()
        return
      }
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
      zoomAt(Math.exp(-e.deltaY * unit * 0.0016), cx, cy)
    }
    wrap.addEventListener('wheel', onWheel, { passive: false })
    return () => wrap.removeEventListener('wheel', onWheel)
  }, [applyView, zoomAt])

  /* keep the diagram framed while the user has not taken control */
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(() => {
      if (!userAdjusted.current) fitToView(false)
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [fitToView])

  // Re-framing mid-drag would fight the gesture, so it waits for the drop.
  useEffect(() => {
    if (!userAdjusted.current && !dragging) fitToView(!firstPaint.current)
  }, [layout.width, layout.height, fitToView, dragging])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName)) return
      const wrap = wrapRef.current
      if (!wrap) return
      const cx = wrap.clientWidth / 2
      const cy = wrap.clientHeight / 2
      if (e.key === 'f' || e.key === 'F') fitToView()
      else if (e.key === '=' || e.key === '+') zoomAt(1.2, cx, cy)
      else if (e.key === '-' || e.key === '_') zoomAt(1 / 1.2, cx, cy)
      else if (e.key === '0') fitToView()
      else if (e.key === 'Escape') onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fitToView, zoomAt, onSelect])

  /* ---------------- derived render data ---------------- */

  /*
   * Focus highlighting is written straight onto the existing elements. Doing it
   * through JSX would re-render every node and ribbon on each pointer enter and
   * leave; this touches only the classes that actually change.
   */
  const soloId = selection.length === 1 ? selection[0] : null

  useLayoutEffect(() => {
    const focusId = hoverId ?? soloId
    const start = focusId ? tree.byId.get(focusId) : null
    let related: Set<string> | null = null
    if (start) {
      related = new Set<string>(start.path)
      const stack = [...start.childIds]
      while (stack.length) {
        const id = stack.pop() as string
        related.add(id)
        const child = tree.byId.get(id)
        if (child) stack.push(...child.childIds)
      }
    }
    const chosen = new Set(selection)
    for (const [id, part] of parts.current) {
      part.g.classList.toggle('is-dim', related !== null && !related.has(id))
      part.g.classList.toggle('is-selected', chosen.has(id))
    }
    for (const link of layoutRef.current.links) {
      const el = linkRefs.current.get(link.id)
      if (!el) continue
      el.classList.toggle('is-dim', related !== null && !(related.has(link.sourceId) && related.has(link.targetId)))
    }
  }, [hoverId, soloId, selection, tree, layout])

  const hovered = hoverId ? tree.byId.get(hoverId) : null
  const symbol = CURRENCIES[currency].symbol

  // Sibling ribbons share a colour pair, so one gradient usually serves many.
  const gradients = useMemo(() => {
    const map = new Map<string, { key: string; from: string; to: string }>()
    for (const link of layout.links) {
      const key = gradKey(link.sourceColor, link.targetColor)
      if (!map.has(key)) map.set(key, { key, from: paintOf(link.sourceColor), to: paintOf(link.targetColor) })
    }
    return [...map.values()]
  }, [layout])

  const cards = useMemo(() => {
    const map = new Map<string, { key: string; head: string; foot: string }>()
    for (const node of layout.nodes) {
      const key = cardKey(node.color)
      if (!map.has(key)) map.set(key, { key, head: paintOf(node.color), foot: cardFoot(node.color) })
    }
    return [...map.values()]
  }, [layout])
  const rootNode = tree.byId.get(ROOT_ID)
  const isEmpty = !rootNode || rootNode.childIds.length === 0

  /*
   * The three heavy subtrees are memoised on the layout alone. Hovering, zooming
   * and selecting all change state on this component, but React sees the very
   * same elements back and skips reconciling a few hundred SVG nodes.
   */
  const defsEl = useMemo(
    () => (
      <defs>
        {/*
          The unallocated slice of a bar. Hatching says "no money here yet" the
          same way the mix panel does; an outlined box at the foot of a bar read
          as something to grab, which is the one thing it is not.
        */}
        <pattern
          id={`${gid}void`}
          width="9"
          height="9"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(-45)"
        >
          <rect width="9" height="9" fill="var(--empty-fill)" />
          <rect width="3" height="9" fill="var(--empty-stroke)" fillOpacity="0.55" />
        </pattern>
        {gradients.map((g) => (
          <linearGradient key={g.key} id={`${gid}${g.key}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" style={{ stopColor: g.from, stopOpacity: 'var(--ribbon-from)' }} />
            <stop offset="100%" style={{ stopColor: g.to, stopOpacity: 'var(--ribbon-to)' }} />
          </linearGradient>
        ))}
        {cards.map((c) => (
          <linearGradient key={c.key} id={`${gid}${c.key}`} x1="0" y1="0" x2="0.35" y2="1">
            <stop offset="0%" style={{ stopColor: c.head }} />
            <stop offset="100%" style={{ stopColor: c.foot }} />
          </linearGradient>
        ))}
      </defs>
    ),
    [gradients, cards, gid],
  )

  const linksEl = useMemo(
    () => (
      <g className="sk-links">
        {layout.links.map((link) => (
          <path
            key={link.id}
            data-id={link.id}
            ref={registerLink}
            className="sk-link"
            d=""
            fill={`url(#${gid}${gradKey(link.sourceColor, link.targetColor)})`}
          />
        ))}
      </g>
    ),
    [layout, gid, registerLink],
  )

  const nodesEl = useMemo(
    () => (
      <g className="sk-nodes">
        {layout.nodes.map((node) => {
          const cls = ['sk-node', node.isRoot && 'is-root', node.over && 'is-over', node.folded && 'is-folded']
            .filter(Boolean)
            .join(' ')
          return (
            <g
              key={node.id}
              data-id={node.id}
              data-drop-id={node.id}
              data-drop-edge={node.isRoot ? undefined : ''}
              ref={registerNode}
              className={cls}
            >
              <rect
                className="sk-bar"
                data-drop-box=""
                x={0}
                y={0}
                width={node.w}
                height={0}
                rx={CARD_RADIUS}
                fill={`url(#${gid}${cardKey(node.color)})`}
              />
              <rect className="sk-rem" x={0} y={0} width={node.w} height={0} rx={CARD_RADIUS} fill={`url(#${gid}void)`} />
              <g className="sk-label" fill={ink(paintOf(node.color))}>
                <text className="sk-name" x={18} y={-20} fillOpacity={0.9}>
                  {node.name}
                  {node.folded ? ' ▸' : ''}
                </text>
                <text className="sk-value" x={18} y={6}>
                  {node.amount >= COMPACT_ABOVE ? `${symbol}${formatCompact(node.amount)}` : formatMoney(node.amount, currency)}
                </text>
                <text className="sk-sub" x={18} y={26} fillOpacity={0.62}>
                  {formatPercent(node.share)} ของพอร์ต
                </text>
              </g>
              <rect
                className="sk-hit"
                data-id={node.id}
                data-export-hide=""
                x={-6}
                y={-6}
                width={node.w + 12}
                height={0}
                fill="transparent"
                onPointerDown={onNodePointerDown}
                onPointerEnter={onNodeEnter}
                onPointerLeave={onNodeLeave}
                onClick={onNodeClick}
                onDoubleClick={onNodeDoubleClick}
              />
            </g>
          )
        })}
      </g>
    ),
    [
      layout,
      symbol,
      currency,
      gid,
      registerNode,
      onNodePointerDown,
      onNodeEnter,
      onNodeLeave,
      onNodeClick,
      onNodeDoubleClick,
    ],
  )

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <div className="canvas-title" aria-hidden="true">
        {title}
      </div>

      <svg
        ref={svgRef}
        className="sankey"
        width="100%"
        height="100%"
        onPointerDown={onBackgroundDown}
        onPointerMove={onPointerMove}
        onPointerUp={endGesture}
        onPointerCancel={endGesture}
        role="img"
        aria-label="แผนภาพการจัดสรรพอร์ตแบบ Sankey"
        data-world-w={Math.round(layout.width)}
        data-world-h={Math.round(layout.height)}
      >
        {defsEl}

        <g ref={viewRef}>
          {linksEl}
          {nodesEl}
        </g>
      </svg>

      <div className="sk-tip" ref={tipRef} data-show={hovered ? '1' : '0'} aria-hidden="true">
        {hovered && (
          <>
            <div className="sk-tip-head">
              <span className="dot" style={{ background: hovered.color }} />
              <strong>{hovered.name}</strong>
            </div>
            <div className="sk-tip-row">
              <span>มูลค่า</span>
              <b>{formatMoney(hovered.amount, currency)}</b>
            </div>
            <div className="sk-tip-row">
              <span>ของพอร์ตรวม</span>
              <b>{formatPercent(hovered.share, 2)}</b>
            </div>
            {hovered.parentId && (
              <div className="sk-tip-row">
                <span>ของก้อนแม่</span>
                <b>{formatPercent(hovered.parentShare, 2)}</b>
              </div>
            )}
            {hovered.childIds.length > 0 && (hovered.overAllocated || hovered.remainder > 0.005) && (
              <div className={`sk-tip-row${hovered.overAllocated ? ' is-warn' : ''}`}>
                <span>{hovered.overAllocated ? 'จัดสรรเกิน' : 'ยังไม่ได้จัดสรร'}</span>
                <b>
                  {formatMoney(
                    hovered.overAllocated ? hovered.allocated - hovered.amount : hovered.remainder,
                    currency,
                  )}
                </b>
              </div>
            )}
          </>
        )}
      </div>

      <div className="marquee" ref={marqueeRef} hidden aria-hidden="true" data-export-hide="" />

      {isEmpty && (
        <div className="canvas-empty">
          <div className="canvas-empty-card">
            <h2>เริ่มแตกพอร์ต</h2>
            <p>ใส่ทุนตั้งต้นไว้แล้ว ทีนี้เพิ่มก้อนแรก แล้วลากต่อได้ไม่จำกัดชั้น</p>
            <button className="btn btn-primary" onClick={() => onAddChild(ROOT_ID)}>
              + เพิ่มสินทรัพย์แรก
            </button>
          </div>
        </div>
      )}

      <div className="canvas-controls" data-export-hide="">
        <button className="icon-btn" title="ซูมเข้า (+)" onClick={() => zoomAt(1.25, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
          +
        </button>
        <button className="icon-btn" title="ซูมออก (-)" onClick={() => zoomAt(1 / 1.25, (wrapRef.current?.clientWidth ?? 0) / 2, (wrapRef.current?.clientHeight ?? 0) / 2)}>
          −
        </button>
        <button className="zoom-label" title="พอดีจอ (F)" onClick={() => fitToView()}>
          {Math.round(zoomLabel * 100)}%
        </button>
      </div>

      <div className="canvas-hint" data-export-hide="">
        ลากพื้นหลังเพื่อเลื่อน · สกรอลล์เพื่อซูม · ลากทับกลางอีกโหนดเพื่อย้ายเข้าไปข้างใน · ลากไปที่ขอบบน/ล่าง
        เพื่อแทรกสลับลำดับ · ปล่อยได้ทั้งบนแผนภาพและพาเนลซ้าย · Esc ยกเลิก · Shift+ลาก เพื่อคลุมเลือก ·
        Ctrl+คลิก เพื่อเลือกเพิ่ม
      </div>
    </div>
  )
})
