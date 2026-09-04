import { useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'
import type { ComputedNode, ComputedTree } from '../types'
import { ROOT_ID } from '../model/portfolio'

/** How far the pointer must travel on a node before it counts as a drag. */
const DRAG_SLOP = 6
/** How close to a scroller's edge the pointer must be before the list follows. */
const EDGE = 36
const EDGE_SPEED = 14
/** Gap between the pointer and the tile it carries. */
const GHOST_GAP = 16
/**
 * A landing spot only changes once the pointer itself has moved this far. The
 * list parts around the drag, which slides other rows under a pointer that
 * never moved — without this, that alone would pick a new spot, and the two
 * would chase each other.
 */
const RE_AIM = 6
/**
 * How long a spot must hold before the list actually opens up for it. The tile
 * at the pointer answers instantly; the layout waits out the sweep across four
 * rows on the way to the fifth, which is what made a quick drag feel frantic.
 */
const SETTLE = 130
/** Thickness of the "drop between these two" seam at a node's top and bottom. */
const SEAM = 14

/**
 * Every surface that shows a node marks it with the same attribute, so one
 * gesture can start in the tree and land on the diagram, or the other way
 * round, without either side knowing the other exists.
 */
const DROP = 'data-drop-id'
/** Marks a surface that also takes a drop before or after itself, not just into. */
const EDGES = 'data-drop-edge'
/** Marks a surface that drops at the end of a list rather than the front. */
const END = 'data-drop-end'
/** The box those two seams belong to, when it is not the marked element itself. */
const BOX = '[data-drop-box]'
/** A scroll box that a drag may pull along when the pointer nears its edge. */
const SCROLLER = '[data-drop-scroll]'

/** Where a drag would put what it is carrying. */
export interface Placement {
  /** The nodes riding along, in the order they will land. */
  ids: string[]
  parentId: string
  /** Slot in the parent's list once the movers are taken out of it. */
  index: number
  /** True when the drop goes *inside* the node under the pointer, false when it
   *  takes a place among that node's neighbours. The two never look alike. */
  into: boolean
}

interface Options {
  tree: ComputedTree
  selection: string[]
  /** The spot the drag is aiming at — the app shows it for real, live. */
  onPreview: (placement: Placement | null) => void
  /** Keep what the preview is showing. */
  onDrop: (placement: Placement) => void
  /** Formats the amount printed on the tile. */
  format: (amount: number) => string
}

export interface NodeDragApi {
  /** Arm a move from any pointerdown. `onTap` runs if it never became a drag. */
  begin: (e: ReactPointerEvent, id: string, onTap?: () => void) => void
  /** True while a drag is live, and through the click that ends it. */
  activeRef: RefObject<boolean>
  /** The tile that rides the pointer — the app shell renders its skeleton. */
  ghostRef: RefObject<HTMLDivElement | null>
}

type Zone = 'before' | 'into' | 'after'

function mark(id: string | null, cls: string, on: boolean): void {
  if (!id) return
  for (const el of document.querySelectorAll(`[${DROP}="${CSS.escape(id)}"]`)) el.classList.toggle(cls, on)
}

const part = (host: HTMLElement, cls: string) => host.querySelector<HTMLElement>(`.${cls}`)

/**
 * Top seam, bottom seam, or the body of the node. The seams are measured on the
 * body but the surface around it counts too — on the diagram that is the margin
 * of a bar, in the list the amount line under a row — so a short node is still
 * something a drag can aim above or below.
 */
function zoneAt(host: Element, y: number): Zone {
  if (!host.hasAttribute(EDGES)) return 'into'
  const box = (host.querySelector(BOX) ?? host).getBoundingClientRect()
  const seam = Math.min(SEAM, box.height * 0.3)
  if (y < box.top + seam) return 'before'
  if (y > box.bottom - seam) return 'after'
  return 'into'
}

const same = (a: Placement | null, b: Placement | null) =>
  a === b || (a !== null && b !== null && a.parentId === b.parentId && a.index === b.index && a.into === b.into)

/**
 * Dragging a node re-parents it, or reorders it among its siblings when the
 * pointer sits on the seam between two of them. Listeners live on the window so
 * the gesture survives the pointer leaving the surface it started on, and no
 * pointer capture is taken — that would swallow the click and double-click the
 * same element still needs.
 *
 * The landing spot is not drawn; it is *shown*. The app applies the pending
 * move to a throwaway copy of the portfolio, so the tree and the diagram open a
 * real gap and every number reads as it will once the drag is dropped.
 *
 * Only the tile that follows the pointer is written straight into the DOM —
 * that part costs one transform per frame and no re-render at all.
 */
export function useNodeDrag({ tree, selection, onPreview, onDrop, format }: Options): NodeDragApi {
  const activeRef = useRef(false)
  const ghostRef = useRef<HTMLDivElement | null>(null)

  // Read through a ref so `begin` never changes identity.
  const live = useRef({ tree, selection, onPreview, onDrop, format })
  live.current = { tree, selection, onPreview, onDrop, format }

  const begin = useCallback((e: ReactPointerEvent, id: string, onTap?: () => void) => {
    if (e.button !== 0 || e.shiftKey || id === ROOT_ID) return

    const { tree: t0, selection: sel } = live.current
    const group = sel.includes(id) && sel.length > 1 ? [...sel] : [id]
    if (group.length > 1) {
      const order = new Map(t0.visible.map((node, i) => [node.id, i]))
      group.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
    }

    const startX = e.clientX
    const startY = e.clientY
    const at = { x: e.clientX, y: e.clientY }
    let active = false
    let done = false
    /** What the tile promises, and what a release would keep. */
    let spot: Placement | null = null
    /** What the list and the diagram are currently showing. */
    let shown: Placement | null = null
    let aimedAt = 0
    let lock = { x: -1e4, y: -1e4, scroll: -1 }
    let raf: number | null = null
    // The tile is only measured when its text changed, never every frame.
    let gw = 0
    let gh = 0
    let remeasure = 2

    /** The slot the node sits in right now, counted without the movers. */
    const home = (node: ComputedNode): Placement | null => {
      const parent = node.parentId ? live.current.tree.byId.get(node.parentId) : null
      if (!parent) return null
      const slot = parent.childIds.indexOf(node.id)
      return {
        ids: group,
        parentId: parent.id,
        index: parent.childIds.slice(0, slot).filter((c) => !group.includes(c)).length,
        into: false,
      }
    }

    /** Where a drop on this surface would land, if it may land there at all. */
    const placementAt = (host: Element): Placement | null => {
      const overId = host.getAttribute(DROP)
      if (!overId) return null
      const t = live.current.tree
      const over = t.byId.get(overId)
      if (!over) return null

      const zone = zoneAt(host, at.y)
      if (zone === 'into') {
        if (over.path.some((step) => group.includes(step))) return null // inside what we carry
        // First child, not last: the node lands right under the pointer instead
        // of jumping to the end of a list that may be nowhere near it. A zone
        // that sits *below* a list says the opposite, and gets the opposite.
        const last = host.hasAttribute(END)
        const index = last ? over.childIds.filter((c) => !group.includes(c)).length : 0
        return { ids: group, parentId: overId, index, into: true }
      }

      // A seam belongs to the list the hovered node sits in, not to the node.
      const parent = over.parentId ? t.byId.get(over.parentId) : null
      if (!parent || parent.path.some((step) => group.includes(step))) return null
      const sibs = parent.childIds.filter((c) => !group.includes(c))
      const i = sibs.indexOf(overId)
      if (i < 0) return null
      return { ids: group, parentId: parent.id, index: zone === 'before' ? i : i + 1, into: false }
    }

    /** Fills the tile with the node it is carrying. */
    const dress = (node: ComputedNode) => {
      const el = ghostRef.current
      if (!el) return
      const bar = part(el, 'ghost-bar')
      if (bar) bar.style.background = node.color
      const name = part(el, 'ghost-name')
      if (name) name.textContent = node.name
      const value = part(el, 'ghost-value')
      if (value) value.textContent = live.current.format(node.amount)
      const badge = part(el, 'ghost-count')
      if (badge) {
        badge.hidden = group.length < 2
        badge.textContent = `+${group.length - 1}`
      }
    }

    /** Says which of the two moves a release would make, right at the pointer. */
    const say = (next: Placement | null) => {
      const el = ghostRef.current
      if (!el) return
      const drop = part(el, 'ghost-drop')
      const parent = next ? live.current.tree.byId.get(next.parentId) : null
      if (drop) {
        drop.textContent = !next || !parent
          ? 'ปล่อยตรงนี้ไม่ได้'
          : next.into
            ? `เข้าไปอยู่ใน ${parent.name}`
            : `ลำดับที่ ${next.index + 1} ใน ${parent.name}`
      }
      el.classList.toggle('is-into', !!next?.into)
      el.classList.toggle('is-order', !!next && !next.into)
      el.classList.toggle('is-blocked', !next)
      remeasure = 2
    }

    const place = () => {
      const el = ghostRef.current
      if (!el) return
      // Unhide first: a hidden tile measures zero, and both writes land in the
      // same frame, so nothing is ever painted at the wrong spot.
      el.hidden = false
      if (remeasure > 0) {
        gw = el.offsetWidth
        gh = el.offsetHeight
        remeasure--
      }
      let x = at.x + GHOST_GAP
      let y = at.y + GHOST_GAP
      if (x + gw > window.innerWidth - 8) x = Math.max(8, at.x - gw - GHOST_GAP)
      if (y + gh > window.innerHeight - 8) y = Math.max(8, at.y - gh - GHOST_GAP)
      el.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`
    }

    const aim = (host: Element | null, scroll: number, now: number) => {
      // Hovering the piece you are carrying changes nothing — that is what
      // keeps the gap from closing the moment the pointer falls into it.
      if (host && group.includes(host.getAttribute(DROP) ?? '')) return
      const next = host ? placementAt(host) : null
      // Empty canvas, the gap between two panels, a spot that cannot take the
      // node: none of those are an answer, so the last real one stands.
      if (next && !same(next, spot)) {
        // The pointer has to move for the aim to change. Rows slide out of the
        // way as the list opens, and that alone must never pick a new spot.
        if (Math.hypot(at.x - lock.x, at.y - lock.y) >= RE_AIM || scroll !== lock.scroll) {
          // Only going *inside* a node lights that node up; taking a place in a
          // list is told by the gap the list opens, not by a highlight.
          mark(spot?.into ? spot.parentId : null, 'is-drop-target', false)
          mark(next.into ? next.parentId : null, 'is-drop-target', true)
          spot = next
          aimedAt = now
          lock = { x: at.x, y: at.y, scroll }
          say(next)
        }
      }
      // The layout follows a beat later, so sweeping past four rows on the way
      // to the fifth does not rearrange the list four times.
      if (spot && !same(spot, shown) && now - aimedAt >= SETTLE) {
        shown = spot
        live.current.onPreview(spot)
      }
    }

    /** A target scrolled out of a long list is still reachable: hold the
     *  pointer near the edge and the list comes to you. */
    const pull = (box: HTMLElement | null) => {
      if (!box) return
      const r = box.getBoundingClientRect()
      const top = at.y - r.top
      const bottom = r.bottom - at.y
      if (top < EDGE) box.scrollTop -= EDGE_SPEED * (1 - Math.max(0, top) / EDGE)
      else if (bottom < EDGE) box.scrollTop += EDGE_SPEED * (1 - Math.max(0, bottom) / EDGE)
    }

    // Hit-testing rides the frame clock, not the pointer, so a list that scrolls
    // or parts under a still pointer is re-read on the very next frame.
    const frame = (now: number) => {
      if (done) return
      raf = requestAnimationFrame(frame)
      const under = document.elementFromPoint(at.x, at.y)
      const scroller = under?.closest(SCROLLER) as HTMLElement | null
      pull(scroller)
      aim(under?.closest(`[${DROP}]`) ?? null, scroller?.scrollTop ?? -1, now)
      place()
    }

    const onMove = (ev: PointerEvent) => {
      at.x = ev.clientX
      at.y = ev.clientY
      if (active) return
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= DRAG_SLOP) return
      const node = live.current.tree.byId.get(id)
      if (!node) return
      active = true
      activeRef.current = true
      document.body.classList.add('is-moving-node')
      for (const memberId of group) mark(memberId, 'is-dragging', true)
      dress(node)
      // The slot it already fills is the first answer: a drag that goes nowhere
      // reads as "stays here", and dropping it there is not a move at all.
      // Publishing it changes nothing on screen, and tells the app a drag is on.
      spot = home(node)
      shown = spot
      aimedAt = performance.now()
      say(spot)
      live.current.onPreview(spot)
      frame(aimedAt)
    }

    const finish = (drop: boolean, byPointer = true) => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey, true)
      if (!active) {
        onTap?.()
        return
      }
      done = true
      if (raf != null) cancelAnimationFrame(raf)
      document.body.classList.remove('is-moving-node')
      for (const memberId of group) mark(memberId, 'is-dragging', false)
      mark(spot?.into ? spot.parentId : null, 'is-drop-target', false)
      if (ghostRef.current) ghostRef.current.hidden = true
      if (drop && spot) live.current.onDrop(spot)
      else live.current.onPreview(null)
      // let the click that follows the release be swallowed, then re-arm — a
      // drag cancelled from the keyboard has that release still coming.
      const rearm = () => window.setTimeout(() => (activeRef.current = false), 0)
      if (byPointer) rearm()
      else window.addEventListener('pointerup', rearm, { once: true, capture: true })
    }

    const onUp = () => finish(true)
    const onCancel = () => finish(false)
    /** Escape puts everything back — caught before the canvas reads it, so a
     *  cancelled drag does not also throw the selection away. */
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active) return
      ev.stopPropagation()
      finish(false, false)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey, true)
  }, [])

  return useMemo(() => ({ begin, activeRef, ghostRef }), [begin])
}
