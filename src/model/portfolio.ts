import type { AssetNode, ComputedNode, ComputedTree, Portfolio } from '../types'
import { uid } from '../lib/id'
import { colorFor, ROOT_COLOR } from '../lib/palette'
import { tidy } from '../lib/format'

export const ROOT_ID = 'root'

export function makeNode(name: string, mode: AssetNode['mode'], value: number, color: string): AssetNode {
  return { id: uid(), name, mode, value, color, children: [] }
}

export function emptyPortfolio(): Portfolio {
  return {
    version: 1,
    name: 'พอร์ตของฉัน',
    currency: 'THB',
    capital: 1_000_000,
    root: { id: ROOT_ID, name: 'เงินทุนตั้งต้น', mode: 'amount', value: 0, color: ROOT_COLOR, children: [] },
    updatedAt: Date.now(),
  }
}

/* ---------------------------------------------------------------- *
 * Traversal
 * ---------------------------------------------------------------- */

export function findNode(root: AssetNode, id: string): AssetNode | null {
  if (root.id === id) return root
  for (const child of root.children) {
    const hit = findNode(child, id)
    if (hit) return hit
  }
  return null
}

export function findParent(root: AssetNode, id: string): AssetNode | null {
  for (const child of root.children) {
    if (child.id === id) return root
    const hit = findParent(child, id)
    if (hit) return hit
  }
  return null
}

export function walk(root: AssetNode, visit: (node: AssetNode, depth: number) => void, depth = 0): void {
  visit(root, depth)
  for (const child of root.children) walk(child, visit, depth + 1)
}

/* ---------------------------------------------------------------- *
 * Immutable edits — every helper returns a fresh tree
 * ---------------------------------------------------------------- */

function mapNode(root: AssetNode, id: string, fn: (node: AssetNode) => AssetNode): AssetNode {
  if (root.id === id) return fn(root)
  let changed = false
  const children = root.children.map((child) => {
    const next = mapNode(child, id, fn)
    if (next !== child) changed = true
    return next
  })
  return changed ? { ...root, children } : root
}

export function updateNode(root: AssetNode, id: string, patch: Partial<AssetNode>): AssetNode {
  return mapNode(root, id, (node) => ({ ...node, ...patch }))
}

export function addChild(root: AssetNode, parentId: string, child: AssetNode, index?: number): AssetNode {
  return mapNode(root, parentId, (node) => {
    const children = [...node.children]
    children.splice(index ?? children.length, 0, child)
    return { ...node, children, collapsed: false }
  })
}

export function removeNode(root: AssetNode, id: string): AssetNode {
  if (id === root.id) return root
  const strip = (node: AssetNode): AssetNode => {
    if (node.children.some((c) => c.id === id)) {
      return { ...node, children: node.children.filter((c) => c.id !== id) }
    }
    let changed = false
    const children = node.children.map((c) => {
      const next = strip(c)
      if (next !== c) changed = true
      return next
    })
    return changed ? { ...node, children } : node
  }
  return strip(root)
}

export function moveSibling(root: AssetNode, id: string, delta: number): AssetNode {
  const parent = findParent(root, id)
  if (!parent) return root
  const from = parent.children.findIndex((c) => c.id === id)
  const to = from + delta
  if (to < 0 || to >= parent.children.length) return root
  return mapNode(root, parent.id, (node) => {
    const children = [...node.children]
    const [moved] = children.splice(from, 1)
    children.splice(to, 0, moved)
    return { ...node, children }
  })
}

export function duplicateNode(root: AssetNode, id: string): AssetNode {
  const parent = findParent(root, id)
  const original = findNode(root, id)
  if (!parent || !original) return root
  const clone = (node: AssetNode): AssetNode => ({ ...node, id: uid(), children: node.children.map(clone) })
  const copy = { ...clone(original), name: `${original.name} (copy)` }
  const index = parent.children.findIndex((c) => c.id === id) + 1
  return addChild(root, parent.id, copy, index)
}

const DEFAULT_NAMES = ['สินทรัพย์ใหม่', 'หุ้นไทย', 'หุ้นต่างประเทศ', 'ทองคำ', 'คริปโต', 'ตราสารหนี้', 'เงินสด', 'REIT']

function defaultName(index: number): string {
  return DEFAULT_NAMES[index % DEFAULT_NAMES.length]
}

/** Add a child under `parentId`, pre-sized to whatever room is left in the parent. */
export function createChildUnder(
  portfolio: Portfolio,
  parentId: string,
  name?: string,
): { root: AssetNode; id: string } {
  const parent = findNode(portfolio.root, parentId) ?? portfolio.root
  const tree = computeTree(portfolio)
  const usedPercent = parent.children.reduce((sum, child) => {
    const c = tree.byId.get(child.id)
    return sum + (c ? c.parentShare * 100 : 0)
  }, 0)
  const free = Math.max(0, 100 - usedPercent)
  const value = tidy(free > 0.5 ? Math.min(free, 25) : 10, 2)
  const child = makeNode(
    name ?? defaultName(parent.children.length),
    'percent',
    value,
    colorFor(parent.children.map((c) => c.color), (tree.byId.get(parentId)?.depth ?? 0) + 1),
  )
  return { root: addChild(portfolio.root, parentId, child), id: child.id }
}

/* ---------------------------------------------------------------- *
 * Percent utilities
 * ---------------------------------------------------------------- */

/** Give every child of a parent an identical slice. */
export function spreadEvenly(root: AssetNode, parentId: string): AssetNode {
  return mapNode(root, parentId, (node) => {
    if (node.children.length === 0) return node
    const each = tidy(100 / node.children.length, 2)
    return { ...node, children: node.children.map((c) => ({ ...c, mode: 'percent' as const, value: each })) }
  })
}

/** Scale a parent's children proportionally so the group sums to exactly 100%. */
export function normalizeChildren(portfolio: Portfolio, parentId: string): AssetNode {
  const parent = findNode(portfolio.root, parentId)
  if (!parent || parent.children.length === 0) return portfolio.root
  const tree = computeTree(portfolio)
  const shares = parent.children.map((c) => tree.byId.get(c.id)?.parentShare ?? 0)
  const total = shares.reduce((a, b) => a + b, 0)
  if (total <= 0) return spreadEvenly(portfolio.root, parentId)
  return mapNode(portfolio.root, parentId, (node) => ({
    ...node,
    children: node.children.map((child, i) => ({
      ...child,
      mode: 'percent' as const,
      value: tidy((shares[i] / total) * 100, 2),
    })),
  }))
}

/** Grow one child until its parent is exactly fully allocated. */
export function fillRemainder(portfolio: Portfolio, id: string): AssetNode {
  const parent = findParent(portfolio.root, id)
  const node = findNode(portfolio.root, id)
  if (!parent || !node) return portfolio.root
  const tree = computeTree(portfolio)
  const self = tree.byId.get(id)
  const parentComputed = tree.byId.get(parent.id)
  if (!self || !parentComputed) return portfolio.root
  const others = parentComputed.allocated - self.amount
  const target = Math.max(0, parentComputed.amount - others)
  const value =
    node.mode === 'percent'
      ? parentComputed.amount > 0
        ? tidy((target / parentComputed.amount) * 100, 2)
        : 0
      : tidy(target, 2)
  return updateNode(portfolio.root, id, { value })
}

/** Switch a node between % and absolute without changing the money it represents. */
export function convertMode(portfolio: Portfolio, id: string, mode: AssetNode['mode']): AssetNode {
  const node = findNode(portfolio.root, id)
  if (!node || node.mode === mode) return portfolio.root
  const tree = computeTree(portfolio)
  const self = tree.byId.get(id)
  const parent = self?.parentId ? tree.byId.get(self.parentId) : null
  if (!self || !parent) return portfolio.root
  const value =
    mode === 'percent'
      ? parent.amount > 0
        ? tidy((self.amount / parent.amount) * 100, 2)
        : 0
      : tidy(self.amount, 2)
  return updateNode(portfolio.root, id, { mode, value })
}

/* ---------------------------------------------------------------- *
 * Resolve the tree into money
 * ---------------------------------------------------------------- */

export function computeTree(portfolio: Portfolio): ComputedTree {
  const byId = new Map<string, ComputedNode>()
  const visible: ComputedNode[] = []
  const overAllocatedIds: string[] = []
  let maxDepth = 0
  let leafCount = 0

  const capital = Math.max(0, portfolio.capital || 0)

  const visit = (
    node: AssetNode,
    parent: ComputedNode | null,
    depth: number,
    index: number,
    hidden: boolean,
    path: string[],
  ): ComputedNode => {
    const parentAmount = parent ? parent.amount : capital
    const raw = Number.isFinite(node.value) ? Math.max(0, node.value) : 0
    const amount = parent === null ? capital : node.mode === 'percent' ? (parentAmount * raw) / 100 : raw

    const self: ComputedNode = {
      id: node.id,
      name: node.name,
      color: node.color,
      node,
      parentId: parent ? parent.id : null,
      depth,
      index,
      amount,
      share: capital > 0 ? amount / capital : 0,
      parentShare: parentAmount > 0 ? amount / parentAmount : 0,
      allocated: 0,
      remainder: 0,
      overAllocated: false,
      hidden,
      folded: false,
      childIds: [],
      path: [...path, node.id],
    }

    byId.set(node.id, self)
    if (!hidden) {
      visible.push(self)
      maxDepth = Math.max(maxDepth, depth)
    }

    const childHidden = hidden || node.collapsed === true
    let allocated = 0
    for (let i = 0; i < node.children.length; i++) {
      const child = visit(node.children[i], self, depth + 1, i, childHidden, self.path)
      allocated += child.amount
      self.childIds.push(child.id)
    }

    self.allocated = allocated
    self.remainder = Math.max(0, amount - allocated)
    self.overAllocated = allocated - amount > amount * 1e-9 + 1e-6
    self.folded = node.children.length > 0 && node.collapsed === true
    if (self.overAllocated) overAllocatedIds.push(node.id)
    if (!hidden && (node.children.length === 0 || node.collapsed === true)) leafCount++

    return self
  }

  visit(portfolio.root, null, 0, 0, false, [])
  const rootComputed = byId.get(portfolio.root.id)!

  return {
    byId,
    visible,
    maxDepth,
    leafCount: Math.max(1, leafCount),
    totalAllocated: rootComputed.allocated,
    unallocated: rootComputed.remainder,
    overAllocatedIds,
  }
}

/** Every leaf of the whole tree with its true share of capital — the real asset mix. */
export function flattenLeaves(tree: ComputedTree, root: AssetNode): ComputedNode[] {
  const out: ComputedNode[] = []
  walk(root, (node) => {
    if (node.children.length === 0 && node.id !== ROOT_ID) {
      const c = tree.byId.get(node.id)
      if (c) out.push(c)
    }
  })
  return out.sort((a, b) => b.amount - a.amount)
}

/* ---------------------------------------------------------------- *
 * Moving and levelling
 * ---------------------------------------------------------------- */

/** True when `id` sits anywhere at or under `ancestorId`. */
export function isDescendant(root: AssetNode, ancestorId: string, id: string): boolean {
  const ancestor = findNode(root, ancestorId)
  return ancestor !== null && findNode(ancestor, id) !== null
}

/** Can this node be dropped into that parent without creating a cycle?
 *  Its own parent counts — dropping back in is how a reorder is expressed. */
export function canMove(root: AssetNode, id: string, parentId: string): boolean {
  if (id === ROOT_ID || id === parentId) return false
  return !isDescendant(root, id, parentId)
}

/**
 * Move nodes into a parent at a given slot, keeping the money they represent
 * rather than their percentage — dragging an asset somewhere else should not
 * silently revalue it. Percent nodes are re-expressed against the new parent,
 * and a move inside the same parent is a pure reorder that touches no number.
 *
 * `index` counts the sibling list with the movers already taken out, so it
 * always means "the gap you can see", whatever the movers came from.
 */
export function moveNodes(portfolio: Portfolio, ids: readonly string[], parentId: string, index: number): AssetNode {
  const movers = ids.filter(
    (id) =>
      canMove(portfolio.root, id, parentId) &&
      findNode(portfolio.root, id) !== null &&
      // anything already riding along inside another mover stays where it is
      !ids.some((other) => other !== id && isDescendant(portfolio.root, other, id)),
  )
  if (movers.length === 0) return portfolio.root

  const tree = computeTree(portfolio)
  const parentAmount = tree.byId.get(parentId)?.amount ?? 0

  // A node dropped back on the slot it already fills is not a move at all:
  // the gap it leaves behind sits at its own index.
  if (movers.length === 1) {
    const home = findParent(portfolio.root, movers[0])
    if (home?.id === parentId && home.children.findIndex((c) => c.id === movers[0]) === index) return portfolio.root
  }

  let root = portfolio.root
  const carried: { node: AssetNode; from: string | null; amount: number }[] = []
  for (const id of movers) {
    const node = findNode(root, id)
    if (!node) continue
    carried.push({ node, from: findParent(root, id)?.id ?? null, amount: tree.byId.get(id)?.amount ?? 0 })
    root = removeNode(root, id)
  }

  const parent = findNode(root, parentId)
  if (!parent) return portfolio.root
  let slot = Math.max(0, Math.min(index, parent.children.length))
  for (const { node, from, amount } of carried) {
    const placed =
      node.mode === 'percent' && from !== parentId
        ? { ...node, value: parentAmount > 0 ? tidy((amount / parentAmount) * 100, 2) : 0 }
        : node
    root = addChild(root, parentId, placed, slot)
    slot++
  }
  return root
}

/**
 * Give every node in the selection the same money, keeping the group's total.
 * Works across different parents: each node is re-expressed in whatever unit it
 * already uses.
 */
export function equalizeSelection(portfolio: Portfolio, ids: readonly string[]): AssetNode {
  const targets = ids.filter((id) => id !== ROOT_ID && findNode(portfolio.root, id))
  if (targets.length < 2) return portfolio.root

  const tree = computeTree(portfolio)
  const total = targets.reduce((sum, id) => sum + (tree.byId.get(id)?.amount ?? 0), 0)
  const each = total / targets.length

  let root = portfolio.root
  for (const id of targets) {
    const node = findNode(root, id)
    const computed = tree.byId.get(id)
    if (!node || !computed) continue
    const parentAmount = computed.parentId ? (tree.byId.get(computed.parentId)?.amount ?? 0) : portfolio.capital
    const value =
      node.mode === 'percent' ? (parentAmount > 0 ? tidy((each / parentAmount) * 100, 2) : 0) : tidy(each, 2)
    root = updateNode(root, id, { value })
  }
  return root
}

/** True when every selected node hangs off the same parent. */
export function sharedParentOf(portfolio: Portfolio, ids: readonly string[]): string | null {
  if (ids.length === 0) return null
  const first = findParent(portfolio.root, ids[0])
  if (!first) return null
  for (const id of ids.slice(1)) {
    if (findParent(portfolio.root, id)?.id !== first.id) return null
  }
  return first.id
}

/** Split the shared parent's whole amount evenly across just the selected children. */
export function equalizeWithinParent(portfolio: Portfolio, ids: readonly string[]): AssetNode {
  const parentId = sharedParentOf(portfolio, ids)
  if (!parentId || ids.length < 2) return portfolio.root
  const tree = computeTree(portfolio)
  const parentAmount = tree.byId.get(parentId)?.amount ?? 0
  const each = parentAmount / ids.length

  let root = portfolio.root
  for (const id of ids) {
    const node = findNode(root, id)
    if (!node) continue
    const value =
      node.mode === 'percent' ? tidy(100 / ids.length, 2) : tidy(each, 2)
    root = updateNode(root, id, { value })
  }
  return root
}

/** How much of the shared parent is still unspoken for. 0 when they differ. */
export function remainderFor(portfolio: Portfolio, ids: readonly string[]): number {
  const parentId = sharedParentOf(portfolio, ids)
  if (!parentId) return 0
  return computeTree(portfolio).byId.get(parentId)?.remainder ?? 0
}

/**
 * Pull the parent's unallocated money into the selection and level it out.
 * Unlike equalizeWithinParent this leaves siblings that were not selected
 * exactly as they were, so the parent lands on fully allocated instead of
 * overflowing — it is the multi-node twin of the single-node "fill the
 * remainder" button.
 */
export function equalizeUsingRemainder(portfolio: Portfolio, ids: readonly string[]): AssetNode {
  const parentId = sharedParentOf(portfolio, ids)
  if (!parentId || ids.length < 2) return portfolio.root
  const tree = computeTree(portfolio)
  const parent = tree.byId.get(parentId)
  if (!parent) return portfolio.root

  const selected = ids.reduce((sum, id) => sum + (tree.byId.get(id)?.amount ?? 0), 0)
  const each = (selected + parent.remainder) / ids.length

  let root = portfolio.root
  for (const id of ids) {
    const node = findNode(root, id)
    if (!node) continue
    const value =
      node.mode === 'percent'
        ? parent.amount > 0
          ? tidy((each / parent.amount) * 100, 2)
          : 0
        : tidy(each, 2)
    root = updateNode(root, id, { value })
  }
  return root
}

/**
 * The one move primitive: lift a node out and drop it under a new parent at a
 * given index, keeping the money it represents. A pure reorder inside the same
 * parent leaves the percentage alone — only a change of parent re-expresses it.
 */
export function placeUnder(portfolio: Portfolio, id: string, newParentId: string, index?: number): AssetNode {
  const root = portfolio.root
  if (id === ROOT_ID || id === newParentId) return root
  if (isDescendant(root, id, newParentId)) return root
  const moving = findNode(root, id)
  if (!moving) return root

  const currentParentId = findParent(root, id)?.id
  let placed = moving
  if (moving.mode === 'percent' && currentParentId !== newParentId) {
    const tree = computeTree(portfolio)
    const amount = tree.byId.get(id)?.amount ?? 0
    const parentAmount = tree.byId.get(newParentId)?.amount ?? 0
    placed = { ...moving, value: parentAmount > 0 ? tidy((amount / parentAmount) * 100, 2) : 0 }
  }
  return addChild(removeNode(root, id), newParentId, placed, index)
}

export type DropPosition = 'before' | 'after' | 'inside'

/** Drop a node relative to another row, the way an outliner does. */
export function moveRelativeTo(
  portfolio: Portfolio,
  id: string,
  targetId: string,
  position: DropPosition,
): AssetNode {
  const root = portfolio.root
  if (id === targetId || id === ROOT_ID) return root

  if (position === 'inside') return placeUnder(portfolio, id, targetId)

  const parent = findParent(root, targetId)
  if (!parent) return root // nothing sits beside the capital node

  const siblings = parent.children
  const from = siblings.findIndex((c) => c.id === id)
  let to = siblings.findIndex((c) => c.id === targetId) + (position === 'after' ? 1 : 0)
  // lifting the node out first shifts everything below it up by one
  if (from !== -1 && from < to) to -= 1
  return placeUnder(portfolio, id, parent.id, to)
}

/* ---- one step deeper / one step shallower, outliner style ---- */

export function canIndent(root: AssetNode, id: string): boolean {
  const parent = findParent(root, id)
  return parent !== null && parent.children.findIndex((c) => c.id === id) > 0
}

/** Tuck a node under the sibling above it. */
export function indentNode(portfolio: Portfolio, id: string): AssetNode {
  const parent = findParent(portfolio.root, id)
  if (!parent) return portfolio.root
  const index = parent.children.findIndex((c) => c.id === id)
  if (index <= 0) return portfolio.root
  return placeUnder(portfolio, id, parent.children[index - 1].id)
}

export function canOutdent(root: AssetNode, id: string): boolean {
  const parent = findParent(root, id)
  return parent !== null && parent.id !== ROOT_ID
}

/** Lift a node out to sit just after its own parent. */
export function outdentNode(portfolio: Portfolio, id: string): AssetNode {
  const parent = findParent(portfolio.root, id)
  if (!parent || parent.id === ROOT_ID) return portfolio.root
  const grand = findParent(portfolio.root, parent.id)
  if (!grand) return portfolio.root
  const at = grand.children.findIndex((c) => c.id === parent.id) + 1
  return placeUnder(portfolio, id, grand.id, at)
}
