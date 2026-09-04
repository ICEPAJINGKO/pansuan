import { useCallback, useMemo, useRef, useState } from 'react'
import { Starfield } from './components/Starfield'
import { TopBar } from './components/TopBar'
import { TreePanel } from './components/TreePanel'
import { Inspector } from './components/Inspector'
import { SankeyCanvas } from './components/SankeyCanvas'
import { usePortfolio } from './state/usePortfolio'
import { useTheme } from './state/useTheme'
import { useNodeDrag, type Placement } from './state/useNodeDrag'
import { computeTree, createChildUnder, findNode, moveNodes, updateNode } from './model/portfolio'
import { formatMoney } from './lib/format'

/** null clears; `additive` toggles one node in and out of a multi-selection. */
export type SelectHandler = (id: string | null, additive?: boolean) => void

export default function App() {
  const api = usePortfolio()
  const themeApi = useTheme()
  const { portfolio } = api
  const [selection, setSelection] = useState<string[]>([])
  const [pending, setPending] = useState<Placement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)

  /*
   * A drag in flight is shown, not described: the move it is aiming at is
   * applied to a throwaway portfolio, so the list and the diagram really do
   * open a gap at the landing spot. Nothing here reaches the undo history —
   * only the drop does, and it commits the very same move.
   */
  const shown = useMemo(() => {
    if (!pending) return portfolio
    const root = moveNodes(portfolio, pending.ids, pending.parentId, pending.index)
    return root === portfolio.root ? portfolio : { ...portfolio, root }
  }, [portfolio, pending])

  const tree = useMemo(() => computeTree(shown), [shown])

  const select = useCallback<SelectHandler>((id, additive = false) => {
    setSelection((current) => {
      if (id === null) return current.length === 0 ? current : []
      if (!additive) return current.length === 1 && current[0] === id ? current : [id]
      return current.includes(id) ? current.filter((x) => x !== id) : [...current, id]
    })
  }, [])

  const onToggleCollapse = useCallback(
    (id: string) => {
      api.commit((p) => {
        const node = findNode(p.root, id)
        if (!node) return p
        return { ...p, root: updateNode(p.root, id, { collapsed: !node.collapsed }) }
      })
    },
    [api],
  )

  const onAddChild = useCallback(
    (parentId: string) => {
      let newId = ''
      api.commit((p) => {
        const result = createChildUnder(p, parentId)
        newId = result.id
        return { ...p, root: result.root }
      })
      if (newId) setSelection([newId])
    },
    [api],
  )

  /**
   * Dropping keeps exactly what the preview was showing: the same call, now on
   * the real portfolio and as one undo step. A whole subtree rides along, and
   * dragging any member of a multi-selection takes the entire set.
   */
  const onDrop = useCallback(
    (placement: Placement) => {
      api.commit((p) => {
        const root = moveNodes(p, placement.ids, placement.parentId, placement.index)
        return root === p.root ? p : { ...p, root }
      })
      setPending(null)
      setSelection(placement.ids)
    },
    [api],
  )

  /** One gesture, two places to start it: a diagram node or a tree row. */
  const money = useCallback((amount: number) => formatMoney(amount, portfolio.currency), [portfolio.currency])
  const drag = useNodeDrag({ tree, selection, onPreview: setPending, onDrop, format: money })

  return (
    <div className="app">
      <Starfield mode={themeApi.mode} />
      <div className="nebula" aria-hidden="true" />

      <TopBar portfolio={portfolio} api={api} svgRef={svgRef} onSelect={select} theme={themeApi} />

      <main className="workspace">
        <TreePanel
          portfolio={shown}
          tree={tree}
          api={api}
          selection={selection}
          onSelect={select}
          onDragNode={drag.begin}
        />

        <SankeyCanvas
          tree={tree}
          currency={portfolio.currency}
          title={portfolio.name}
          selection={selection}
          onSelect={select}
          onSelectMany={setSelection}
          onToggleCollapse={onToggleCollapse}
          onAddChild={onAddChild}
          onDragNode={drag.begin}
          dragRef={drag.activeRef}
          dragging={pending !== null}
          svgRef={svgRef}
        />

        <Inspector
          portfolio={shown}
          tree={tree}
          api={api}
          selection={selection}
          onSelect={select}
          onSelectMany={setSelection}
        />
      </main>

      {/*
        The tile a drag carries. It is filled and moved straight from the drag
        hook, so following the pointer costs no React work at all — and it lives
        here because a move can start in either panel.
      */}
      <div className="drag-ghost" ref={drag.ghostRef} hidden aria-hidden="true">
        <span className="ghost-bar" />
        <span className="ghost-text">
          <span className="ghost-head">
            <b className="ghost-name" />
            <span className="ghost-count" hidden />
            <span className="ghost-value" />
          </span>
          <span className="ghost-drop" />
        </span>
      </div>
    </div>
  )
}
