import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { AssetNode, ComputedTree, CurrencyCode, Portfolio } from '../types'
import type { PortfolioApi } from '../state/usePortfolio'
import type { NodeDragApi } from '../state/useNodeDrag'
import {
  canIndent,
  canOutdent,
  convertMode,
  createChildUnder,
  indentNode,
  moveSibling,
  outdentNode,
  removeNode,
  ROOT_ID,
  updateNode,
} from '../model/portfolio'
import { CURRENCIES, formatMoney, formatNumber, formatPercent, parseValueInput } from '../lib/format'
import { copyrightLine, NOTICES_URL } from '../lib/legal'
import { ValueField } from './ValueField'
import type { SelectHandler } from '../App'

interface Props {
  portfolio: Portfolio
  tree: ComputedTree
  api: PortfolioApi
  selection: string[]
  onSelect: SelectHandler
  onDragNode: NodeDragApi['begin']
}

/**
 * Rows must be *seen* to move: a drag hovering a new slot re-orders this list
 * for real, and a jump cut would hide the very thing that preview is for. Each
 * row is animated from where it was to where it now is through the Web
 * Animations API, so React keeps owning the DOM and nothing is left behind on
 * the element afterwards. Measuring is gated on the order actually changing —
 * typing a name never costs a layout read.
 */
function useReflow(order: string) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const seen = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const origin = host.getBoundingClientRect().top - host.scrollTop
    const next = new Map<string, number>()

    for (const row of host.querySelectorAll<HTMLElement>('[data-flip]')) {
      const id = row.dataset.flip as string
      const top = row.getBoundingClientRect().top - origin
      next.set(id, top)
      const was = seen.current.get(id)
      if (still || was === undefined || Math.abs(was - top) < 0.5) continue
      for (const running of row.getAnimations()) running.cancel()
      row.animate([{ transform: `translateY(${(was - top).toFixed(1)}px)` }, { transform: 'none' }], {
        duration: 180,
        easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)',
      })
    }
    seen.current = next
  }, [order])

  return hostRef
}

export function TreePanel({ portfolio, tree, api, selection, onSelect, onDragNode }: Props) {
  const root = tree.byId.get(ROOT_ID)
  const allocated = root?.allocated ?? 0
  const capital = portfolio.capital
  const pct = capital > 0 ? allocated / capital : 0
  const over = root?.overAllocated ?? false
  const scrollRef = useReflow(useMemo(() => tree.visible.map((node) => node.id).join(','), [tree]))

  const legal = copyrightLine()

  const addChild = (parentId: string) => {
    let newId = ''
    api.commit((p) => {
      const { root: nextRoot, id } = createChildUnder(p, parentId)
      newId = id
      return { ...p, root: nextRoot }
    })
    if (newId) onSelect(newId)
  }

  return (
    <aside className="panel panel-left">
      <div className="panel-block">
        <label className="field-label" htmlFor="capital-input">
          ทุนตั้งต้น
        </label>
        <div className="capital-row">
          <CapitalField portfolio={portfolio} api={api} />
          <select
            className="currency-select"
            value={portfolio.currency}
            aria-label="สกุลเงิน"
            onChange={(e) => api.commit((p) => ({ ...p, currency: e.target.value as CurrencyCode }))}
          >
            {Object.entries(CURRENCIES).map(([code, meta]) => (
              <option key={code} value={code}>
                {meta.symbol} {code}
              </option>
            ))}
          </select>
        </div>

        <div className={`allocation-meter${over ? ' is-over' : ''}`}>
          <div className="meter-track">
            <div className="meter-fill" style={{ width: `${Math.min(100, pct * 100).toFixed(2)}%` }} />
          </div>
          <div className="meter-legend">
            <span>จัดสรรแล้ว {formatPercent(pct)}</span>
            <span className={over ? 'is-warn' : ''}>
              {over
                ? `เกิน ${formatMoney(allocated - capital, portfolio.currency)}`
                : `เหลือ ${formatMoney(Math.max(0, capital - allocated), portfolio.currency)}`}
            </span>
          </div>
        </div>
      </div>

      <div className="panel-head">
        <h2>โครงสร้างพอร์ต</h2>
        <button className="btn btn-ghost btn-sm" onClick={() => addChild(ROOT_ID)} title="เพิ่มก้อนใหม่ระดับบนสุด">
          + ก้อนใหม่
        </button>
      </div>

      {/* data-drop-scroll lets a drag pull this list along when it nears an edge. */}
      <div className="tree-scroll" data-drop-scroll="" ref={scrollRef}>
        {portfolio.root.children.length === 0 ? (
          <p className="tree-empty">ยังไม่มีสินทรัพย์ — กด “+ ก้อนใหม่” เพื่อเริ่ม</p>
        ) : (
          <ul className="tree">
            {portfolio.root.children.map((child, index) => (
              <Row
                key={child.id}
                node={child}
                depth={0}
                index={index}
                siblings={portfolio.root.children.length}
                root={portfolio.root}
                tree={tree}
                api={api}
                currency={portfolio.currency}
                selection={selection}
                onSelect={onSelect}
                onAddChild={addChild}
                onDragNode={onDragNode}
              />
            ))}
          </ul>
        )}

        {/* Shows up only mid-drag: the way back out to the top level. It sits
            under the list, so it drops at the end of it. */}
        <div className="tree-root-drop" data-drop-id={ROOT_ID} data-drop-end="">
          ปล่อยตรงนี้เพื่อย้ายไปท้ายระดับบนสุด
        </div>
      </div>

      {legal && (
        <footer className="panel-legal">
          <small>{legal}</small>
          <span aria-hidden="true">·</span>
          <a
            className="legal-link"
            href={NOTICES_URL}
            target="_blank"
            rel="noreferrer"
            title="ประกาศไลเซนส์ของไลบรารีโอเพนซอร์สที่แอปนี้ใช้"
          >
            โอเพนซอร์ส
          </a>
        </footer>
      )}
    </aside>
  )
}

function CapitalField({ portfolio, api }: { portfolio: Portfolio; api: PortfolioApi }) {
  const [draft, setDraft] = useState<string | null>(null)
  return (
    <input
      id="capital-input"
      className="capital-input"
      value={draft ?? formatNumber(portfolio.capital)}
      inputMode="decimal"
      spellCheck={false}
      onFocus={(e) => {
        api.checkpoint()
        setDraft(String(portfolio.capital))
        requestAnimationFrame(() => e.target.select())
      }}
      onChange={(e) => {
        setDraft(e.target.value)
        const parsed = parseValueInput(e.target.value, 'amount')
        if (parsed && parsed.mode === 'amount') api.amend((p) => ({ ...p, capital: parsed.value }))
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
      }}
    />
  )
}

interface RowProps {
  node: AssetNode
  depth: number
  /** Position among its siblings, for the up/down buttons. */
  index: number
  siblings: number
  root: AssetNode
  tree: ComputedTree
  api: PortfolioApi
  currency: CurrencyCode
  selection: string[]
  onSelect: SelectHandler
  onAddChild: (parentId: string) => void
  onDragNode: NodeDragApi['begin']
}

/* A stroked chevron instead of the "▾" glyph: the character renders thin and
 * differently per font, so it stayed faint however large the font-size went. */
function Chevron() {
  return (
    <svg className="chev-icon" viewBox="0 0 14 14" width="14" height="14" aria-hidden="true" focusable="false">
      <path d="M3.4 5.4 7 9l3.6-3.6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/**
 * Six dots. The colour swatch used to carry the drag on its own, but a dot
 * reads as a status light, not as a handle — this says "grab me" without a
 * caption.
 */
function GripDots() {
  return (
    <svg className="grip-dots" viewBox="0 0 10 16" width="10" height="16" aria-hidden="true" focusable="false">
      {[3.2, 8, 12.8].map((cy) =>
        [2.6, 7.4].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.15" />),
      )}
    </svg>
  )
}

function Row({
  node,
  depth,
  index,
  siblings,
  root,
  tree,
  api,
  currency,
  selection,
  onSelect,
  onAddChild,
  onDragNode,
}: RowProps) {
  const computed = tree.byId.get(node.id)
  const hasChildren = node.children.length > 0
  const collapsed = node.collapsed === true
  const indent = 6 + depth * 15

  const edit = (fn: (portfolio: Portfolio) => AssetNode) =>
    api.commit((p) => {
      const next = fn(p)
      return next === p.root ? p : { ...p, root: next }
    })

  const onPointerDown = (e: React.PointerEvent) => {
    const additive = e.ctrlKey || e.metaKey
    const target = e.target as HTMLElement
    // A finger only drags from the grip; a mouse may drag from anywhere that is
    // not itself a control.
    const draggable =
      e.pointerType === 'touch' ? !!target.closest('.grip') : !target.closest('input, button, select')
    if (additive || !draggable) {
      onSelect(node.id, additive)
      return
    }
    if (!selection.includes(node.id)) onSelect(node.id)
    onDragNode(e, node.id, () => onSelect(node.id))
  }

  return (
    <li className="tree-item" data-flip={node.id} data-drop-id={node.id} data-drop-edge="">
      <div
        className={`tree-row${selection.includes(node.id) ? ' is-selected' : ''}${computed?.overAllocated ? ' is-over' : ''}`}
        style={{ paddingLeft: indent }}
        data-drop-box=""
        onPointerDown={onPointerDown}
      >
        <button
          className={`chev${hasChildren ? '' : ' is-leaf'}${collapsed ? ' is-collapsed' : ''}`}
          tabIndex={hasChildren ? 0 : -1}
          aria-label={collapsed ? 'กางออก' : 'พับเก็บ'}
          onClick={(e) => {
            e.stopPropagation()
            if (hasChildren) {
              api.commit((p) => ({ ...p, root: updateNode(p.root, node.id, { collapsed: !collapsed }) }))
            }
          }}
        >
          {hasChildren ? <Chevron /> : <span className="chev-dot" aria-hidden="true" />}
        </button>

        <span className="grip" title="ลากเพื่อจัดลำดับ หรือลากไปทับก้อนอื่นเพื่อย้ายเข้าไปข้างใน">
          <GripDots />
          <span className="swatch" style={{ background: node.color }} aria-hidden="true" />
        </span>

        <input
          className="name-input"
          value={node.name}
          spellCheck={false}
          aria-label="ชื่อสินทรัพย์"
          onFocus={() => {
            api.checkpoint()
            onSelect(node.id)
          }}
          onChange={(e) => api.amend((p) => ({ ...p, root: updateNode(p.root, node.id, { name: e.target.value }) }))}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              onAddChild(node.id)
            }
          }}
        />

        <ValueField
          mode={node.mode}
          value={node.value}
          currency={currency}
          onBegin={api.checkpoint}
          onChange={(mode, value) => api.amend((p) => ({ ...p, root: updateNode(p.root, node.id, { mode, value }) }))}
        />

        <button
          className={`unit-btn${node.mode === 'percent' ? ' is-percent' : ''}`}
          title={node.mode === 'percent' ? 'สลับเป็นจำนวนเงิน' : 'สลับเป็นเปอร์เซ็นต์ของก้อนแม่'}
          aria-label="สลับหน่วย"
          onClick={(e) => {
            e.stopPropagation()
            const next = node.mode === 'percent' ? 'amount' : 'percent'
            api.commit((p) => ({ ...p, root: convertMode(p, node.id, next) }))
          }}
        >
          {node.mode === 'percent' ? '%' : CURRENCIES[currency].symbol}
        </button>

        <div className="row-actions">
          <button
            className="icon-btn tiny"
            title="เพิ่มก้อนย่อย"
            onClick={(e) => {
              e.stopPropagation()
              onAddChild(node.id)
            }}
          >
            +
          </button>
          <button
            className="icon-btn tiny danger"
            title="ลบ"
            onClick={(e) => {
              e.stopPropagation()
              api.commit((p) => ({ ...p, root: removeNode(p.root, node.id) }))
              if (selection.includes(node.id)) onSelect(null)
            }}
          >
            ×
          </button>
        </div>
      </div>

      {/* The amount line carries the precise-move controls. They live here
          rather than in the row above because the row has no width left, and
          this line is mostly empty. */}
      <div className="tree-amount" style={{ paddingLeft: indent + 54 }}>
        <span className="amount-text">
          {formatMoney(computed?.amount ?? 0, currency)}
          <span className="muted"> · {formatPercent(computed?.share ?? 0)}</span>
        </span>

        <div className="layer-actions">
          <button
            className="icon-btn tiny"
            title="เลื่อนขึ้นในชั้นเดิม"
            aria-label="เลื่อนขึ้นในชั้นเดิม"
            disabled={index === 0}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) => moveSibling(p.root, node.id, -1))
            }}
          >
            ↑
          </button>
          <button
            className="icon-btn tiny"
            title="เลื่อนลงในชั้นเดิม"
            aria-label="เลื่อนลงในชั้นเดิม"
            disabled={index === siblings - 1}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) => moveSibling(p.root, node.id, 1))
            }}
          >
            ↓
          </button>
          <span className="layer-sep" aria-hidden="true" />
          <button
            className="icon-btn tiny"
            title="ย้ายออกไปชั้นนอก — ไปอยู่ถัดจากก้อนแม่"
            aria-label="ย้ายออกไปชั้นนอก"
            disabled={!canOutdent(root, node.id)}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) => outdentNode(p, node.id))
            }}
          >
            ←
          </button>
          <button
            className="icon-btn tiny"
            title="ย้ายเข้าไปชั้นใน — เป็นก้อนย่อยของก้อนที่อยู่เหนือมัน"
            aria-label="ย้ายเข้าไปชั้นใน"
            disabled={!canIndent(root, node.id)}
            onClick={(e) => {
              e.stopPropagation()
              edit((p) => indentNode(p, node.id))
            }}
          >
            →
          </button>
        </div>
      </div>

      {hasChildren && !collapsed && (
        <ul className="tree">
          {node.children.map((child, childIndex) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              index={childIndex}
              siblings={node.children.length}
              root={root}
              tree={tree}
              api={api}
              currency={currency}
              selection={selection}
              onSelect={onSelect}
              onAddChild={onAddChild}
              onDragNode={onDragNode}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
