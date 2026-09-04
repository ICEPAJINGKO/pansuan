/** How a node's value is expressed relative to its parent. */
export type AllocMode = 'percent' | 'amount'

export interface AssetNode {
  id: string
  name: string
  /** 'percent' = % of parent's amount, 'amount' = absolute currency value */
  mode: AllocMode
  value: number
  color: string
  note?: string
  collapsed?: boolean
  children: AssetNode[]
}

export type CurrencyCode = 'THB' | 'USD' | 'EUR' | 'GBP' | 'JPY' | 'SGD'

export interface Portfolio {
  version: 1
  name: string
  currency: CurrencyCode
  /** Starting capital — the amount that flows out of the root node. */
  capital: number
  root: AssetNode
  updatedAt: number
}

/** A node after amounts have been resolved against the capital. */
export interface ComputedNode {
  id: string
  name: string
  color: string
  node: AssetNode
  parentId: string | null
  depth: number
  /** Index among its siblings. */
  index: number
  /** Resolved value in currency units. */
  amount: number
  /** Fraction of total capital (0..1). */
  share: number
  /** Fraction of the parent's amount (0..1). */
  parentShare: number
  /** Sum of children's amounts. */
  allocated: number
  /** amount - allocated, clamped at 0. */
  remainder: number
  /** True when children add up to more than this node holds. */
  overAllocated: boolean
  /** True when this node is hidden because an ancestor is collapsed. */
  hidden: boolean
  /** True when it has children but they are folded away. */
  folded: boolean
  childIds: string[]
  /** Root -> this node, inclusive. */
  path: string[]
}

export interface ComputedTree {
  byId: Map<string, ComputedNode>
  /** Depth-first order, visible nodes only. */
  visible: ComputedNode[]
  maxDepth: number
  leafCount: number
  totalAllocated: number
  unallocated: number
  overAllocatedIds: string[]
}
