import type { ComputedNode, ComputedTree } from '../types'

export interface SankeyNode {
  id: string
  name: string
  color: string
  depth: number
  parentId: string | null
  x: number
  y: number
  w: number
  h: number
  amount: number
  share: number
  /** Sum of the children's amounts — the ribbon band's true span. */
  allocated: number
  over: boolean
  hasChildren: boolean
  folded: boolean
  isRoot: boolean
}

export interface SankeyLink {
  id: string
  sourceId: string
  targetId: string
  sourceColor: string
  targetColor: string
}

export interface SankeyLayout {
  nodes: SankeyNode[]
  links: SankeyLink[]
  byId: Map<string, SankeyNode>
  width: number
  height: number
  scale: number
}

/*
 * A node is a card: it carries its own name, amount and share, so the geometry
 * has to leave room for three lines of type rather than for a label hung off to
 * the side. Height still tracks the money — a card just never shrinks below
 * what its own text needs.
 */
export const NODE_W = 178
/** Corner radius of a node card. */
export const CARD_RADIUS = 14
/**
 * A ribbon runs on past the card's edge and finishes underneath it, deeper than
 * the corner radius. Stopping exactly at the edge leaves the ribbon's square end
 * sticking out where the card has already curved away — the little tabs at every
 * junction. Running it under instead puts the ribbon's straight edge flush with
 * the card's own top and bottom edge, and the opaque card hides the rest.
 */
export const CARD_TUCK = CARD_RADIUS + 2

export const COL_GAP = 146
export const SIBLING_GAP = 14
export const GROUP_GAP = 22
/** Breathing room around the whole flow. */
export const PAD_X = 36
export const LABEL_PAD = 36
/** Three lines of card text, plus padding. */
export const MIN_NODE_H = 78
export const MIN_HEIGHT = 460
export const ROW_HEIGHT = MIN_NODE_H + SIBLING_GAP

/** Column x for a given depth. */
export function columnX(depth: number): number {
  return PAD_X + depth * (NODE_W + COL_GAP)
}

interface Group {
  parentId: string
  children: ComputedNode[]
  heights: number[]
  /** Distance from the group's top to each child's top. */
  offsets: number[]
  groupH: number
  desiredTop: number
  top: number
}

export function layoutSankey(tree: ComputedTree): SankeyLayout {
  const nodes: SankeyNode[] = []
  const links: SankeyLink[] = []
  const byId = new Map<string, SankeyNode>()

  const visible = tree.visible
  if (visible.length === 0) {
    return { nodes, links, byId, width: 600, height: MIN_HEIGHT, scale: 1 }
  }

  const height = Math.max(MIN_HEIGHT, tree.leafCount * ROW_HEIGHT)

  // Bucket the visible nodes by depth.
  const columns: ComputedNode[][] = []
  for (const node of visible) {
    ;(columns[node.depth] ??= []).push(node)
  }

  // Pick the largest scale at which every column still fits vertically.
  let scale = Infinity
  for (const column of columns) {
    if (!column) continue
    const total = column.reduce((sum, n) => sum + n.amount, 0)
    if (total <= 0) continue
    const gaps = (column.length - 1) * SIBLING_GAP
    scale = Math.min(scale, Math.max(0, height - gaps) / total)
  }
  if (!Number.isFinite(scale) || scale <= 0) scale = 1

  const heightOf = (n: ComputedNode) => Math.max(MIN_NODE_H, n.amount * scale)

  const tops = new Map<string, number>()

  // Depth 0 — the capital node, vertically centred.
  const root = columns[0][0]
  tops.set(root.id, (height - heightOf(root)) / 2)

  for (let depth = 1; depth < columns.length; depth++) {
    const column = columns[depth]
    if (!column || column.length === 0) continue

    // One group per parent, ordered by where the parent sits.
    const groups: Group[] = []
    const seen = new Map<string, Group>()
    for (const node of column) {
      const parentId = node.parentId!
      let group = seen.get(parentId)
      if (!group) {
        group = { parentId, children: [], heights: [], offsets: [], groupH: 0, desiredTop: 0, top: 0 }
        seen.set(parentId, group)
        groups.push(group)
      }
      group.children.push(node)
      group.heights.push(heightOf(node))
    }

    for (const group of groups) {
      const h = group.heights
      // Cards carry their own text, so keeping them from touching is the whole
      // constraint — no separate rule for labels colliding any more.
      const offsets = [0]
      for (let i = 1; i < h.length; i++) offsets.push(offsets[i - 1] + h[i - 1] + SIBLING_GAP)
      group.offsets = offsets
      group.groupH = offsets[offsets.length - 1] + h[h.length - 1]
      // Centre the group on the band of ribbons leaving the parent.
      const bandH = h.reduce((a, b) => a + b, 0)
      const parentTop = tops.get(group.parentId) ?? 0
      group.desiredTop = parentTop - (group.groupH - bandH) / 2
    }

    groups.sort((a, b) => a.desiredTop - b.desiredTop)

    // Push down out of overlaps, then push back up if we ran off the bottom.
    let cursor = 0
    for (const group of groups) {
      group.top = Math.max(group.desiredTop, cursor)
      cursor = group.top + group.groupH + GROUP_GAP
    }
    let limit = height
    for (let i = groups.length - 1; i >= 0; i--) {
      const group = groups[i]
      if (group.top + group.groupH > limit) group.top = limit - group.groupH
      limit = group.top - GROUP_GAP
    }
    if (groups.length && groups[0].top < 0) {
      const shift = -groups[0].top
      for (const group of groups) group.top += shift
    }

    for (const group of groups) {
      for (let i = 0; i < group.children.length; i++) {
        tops.set(group.children[i].id, group.top + group.offsets[i])
      }
    }
  }

  // Materialise nodes.
  for (const node of visible) {
    const h = heightOf(node)
    const laid: SankeyNode = {
      id: node.id,
      name: node.name,
      color: node.color,
      depth: node.depth,
      parentId: node.parentId,
      x: columnX(node.depth),
      y: tops.get(node.id) ?? 0,
      w: NODE_W,
      h,
      amount: node.amount,
      share: node.share,
      allocated: node.allocated,
      over: node.overAllocated,
      hasChildren: node.childIds.length > 0,
      folded: node.folded,
      isRoot: node.parentId === null,
    }
    nodes.push(laid)
    byId.set(laid.id, laid)
  }

  // Ribbons: stacked flush against the top of the source node.
  for (const node of visible) {
    if (node.folded) continue
    const source = byId.get(node.id)
    if (!source) continue
    let offset = 0
    for (const childId of node.childIds) {
      const target = byId.get(childId)
      if (!target) continue
      const link: SankeyLink = {
        id: `${node.id}-${childId}`,
        sourceId: node.id,
        targetId: childId,
        sourceColor: source.color,
        targetColor: target.color,
      }
      links.push(link)
      offset += target.h
    }
  }

  const width = columnX(columns.length - 1) + NODE_W + LABEL_PAD
  // Minimum card heights can push a column past the nominal height; the frame
  // has to follow the cards, not the other way round.
  let bottom = height
  for (const node of nodes) bottom = Math.max(bottom, node.y + node.h)

  return { nodes, links, byId, width, height: bottom, scale }
}

/**
 * Ribbon outline: two mirrored cubic curves closed into a band. The two ends
 * carry their own thickness — a ribbon leaves its parent at the share of the
 * money it really is, and arrives at the full width of the card it feeds.
 * Kept as a plain string builder so it is cheap to call once per link per frame.
 */
export function ribbonPath(x0: number, y0: number, x1: number, y1: number, h0: number, h1: number): string {
  const cx = (x0 + x1) / 2
  const b0 = y0 + h0
  const b1 = y1 + h1
  return (
    `M${x0},${y0}C${cx},${y0} ${cx},${y1} ${x1},${y1}` +
    `L${x1},${b1}C${cx},${b1} ${cx},${b0} ${x0},${b0}Z`
  )
}
