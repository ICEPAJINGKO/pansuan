import type { ComputedTree, Portfolio } from '../types'
import type { PortfolioApi } from '../state/usePortfolio'
import type { SelectHandler } from '../App'
import {
  convertMode,
  createChildUnder,
  duplicateNode,
  fillRemainder,
  findParent,
  flattenLeaves,
  equalizeSelection,
  equalizeUsingRemainder,
  equalizeWithinParent,
  moveSibling,
  normalizeChildren,
  removeNode,
  ROOT_ID,
  sharedParentOf,
  spreadEvenly,
  updateNode,
} from '../model/portfolio'
import { formatMoney, formatPercent } from '../lib/format'
import { PALETTE } from '../lib/palette'
import { ValueField } from './ValueField'

interface Props {
  portfolio: Portfolio
  tree: ComputedTree
  api: PortfolioApi
  selection: string[]
  onSelect: SelectHandler
  onSelectMany: (ids: string[]) => void
}

export function Inspector({ portfolio, tree, api, selection, onSelect, onSelectMany }: Props) {
  const live = selection.filter((id) => id !== ROOT_ID && tree.byId.has(id))

  if (live.length > 1) {
    return (
      <MultiSelect
        portfolio={portfolio}
        tree={tree}
        api={api}
        ids={live}
        onSelect={onSelect}
        onSelectMany={onSelectMany}
      />
    )
  }
  if (live.length === 1) {
    return <NodeEditor portfolio={portfolio} tree={tree} api={api} id={live[0]} onSelect={onSelect} />
  }
  return <AssetMix portfolio={portfolio} tree={tree} onSelect={onSelect} />
}

function AssetMix({
  portfolio,
  tree,
  onSelect,
}: {
  portfolio: Portfolio
  tree: ComputedTree
  onSelect: SelectHandler
}) {
  const leaves = flattenLeaves(tree, portfolio.root)
  const root = tree.byId.get(ROOT_ID)
  const unallocated = root?.remainder ?? 0

  return (
    <aside className="panel panel-right">
      <div className="panel-head">
        <h2>ส่วนผสมจริง</h2>
        <span className="badge">{leaves.length} รายการ</span>
      </div>
      <p className="panel-note">ปลายทางทุกสายรวมกัน — นี่คือสิ่งที่พอร์ตถืออยู่จริง</p>

      <div className="panel-scroll">
        {leaves.length === 0 ? (
          <p className="tree-empty">เลือกโหนดในแผนภาพเพื่อแก้ไขรายละเอียด</p>
        ) : (
          <ul className="mix-list">
            {leaves.map((leaf) => (
              <li key={leaf.id}>
                <button className="mix-row" onClick={() => onSelect(leaf.id)}>
                  <span className="mix-bar" style={{ background: leaf.color, width: `${Math.max(3, leaf.share * 100)}%` }} />
                  <span className="mix-name">{leaf.name}</span>
                  <span className="mix-pct">{formatPercent(leaf.share)}</span>
                  <span className="mix-amount">{formatMoney(leaf.amount, portfolio.currency)}</span>
                </button>
              </li>
            ))}
            {unallocated > 0.005 && (
              <li>
                <div className="mix-row is-ghost">
                  <span className="mix-bar ghost" style={{ width: `${Math.max(3, (unallocated / Math.max(1, portfolio.capital)) * 100)}%` }} />
                  <span className="mix-name">ยังไม่ได้จัดสรร</span>
                  <span className="mix-pct">{formatPercent(unallocated / Math.max(1, portfolio.capital))}</span>
                  <span className="mix-amount">{formatMoney(unallocated, portfolio.currency)}</span>
                </div>
              </li>
            )}
          </ul>
        )}
      </div>

      <div className="panel-foot">
        <div className="stat">
          <span>มูลค่ารวม</span>
          <b>{formatMoney(portfolio.capital, portfolio.currency)}</b>
        </div>
        <div className="stat">
          <span>ชั้นลึกสุด</span>
          <b>{tree.maxDepth}</b>
        </div>
      </div>
    </aside>
  )
}

function NodeEditor({
  portfolio,
  tree,
  api,
  id,
  onSelect,
}: {
  portfolio: Portfolio
  tree: ComputedTree
  api: PortfolioApi
  id: string
  onSelect: SelectHandler
}) {
  const computed = tree.byId.get(id)!
  const node = computed.node
  const parent = findParent(portfolio.root, id)
  const parentComputed = parent ? tree.byId.get(parent.id) : null
  const siblings = parent?.children ?? []
  const index = siblings.findIndex((c) => c.id === id)
  const children = node.children

  const set = (patch: Parameters<typeof updateNode>[2]) =>
    api.commit((p) => ({ ...p, root: updateNode(p.root, id, patch) }))

  return (
    <aside className="panel panel-right">
      <div className="panel-head">
        <h2>รายละเอียด</h2>
        <button className="icon-btn tiny" title="ปิด (Esc)" onClick={() => onSelect(null)}>
          ×
        </button>
      </div>

      <div className="panel-scroll">
        <input
          className="title-input"
          value={node.name}
          aria-label="ชื่อสินทรัพย์"
          spellCheck={false}
          onFocus={api.checkpoint}
          onChange={(e) => api.amend((p) => ({ ...p, root: updateNode(p.root, id, { name: e.target.value }) }))}
        />

        <div className="swatch-grid" role="group" aria-label="สีของก้อนนี้">
          {PALETTE.map((color) => (
            <button
              key={color}
              className={`swatch-btn${node.color.toLowerCase() === color.toLowerCase() ? ' is-active' : ''}`}
              style={{ background: color }}
              title={color}
              onClick={() => set({ color })}
            />
          ))}
        </div>

        <div className="field-row">
          <ValueField
            mode={node.mode}
            value={node.value}
            currency={portfolio.currency}
            className="big"
            onBegin={api.checkpoint}
            onChange={(mode, value) => api.amend((p) => ({ ...p, root: updateNode(p.root, id, { mode, value }) }))}
          />
          <div className="mode-toggle" role="group" aria-label="หน่วย">
            <button
              className={node.mode === 'percent' ? 'is-active' : ''}
              onClick={() => api.commit((p) => ({ ...p, root: convertMode(p, id, 'percent') }))}
            >
              %
            </button>
            <button
              className={node.mode === 'amount' ? 'is-active' : ''}
              onClick={() => api.commit((p) => ({ ...p, root: convertMode(p, id, 'amount') }))}
            >
              {portfolio.currency}
            </button>
          </div>
        </div>

        <dl className="readout">
          <div>
            <dt>มูลค่า</dt>
            <dd>{formatMoney(computed.amount, portfolio.currency)}</dd>
          </div>
          <div>
            <dt>ของก้อนแม่</dt>
            <dd>{formatPercent(computed.parentShare, 2)}</dd>
          </div>
          <div>
            <dt>ของพอร์ตรวม</dt>
            <dd>{formatPercent(computed.share, 2)}</dd>
          </div>
        </dl>

        {parentComputed && parentComputed.remainder > 0.005 && (
          <button className="btn btn-soft full" onClick={() => api.commit((p) => ({ ...p, root: fillRemainder(p, id) }))}>
            เติมส่วนที่เหลือของก้อนแม่ (+{formatMoney(parentComputed.remainder, portfolio.currency)})
          </button>
        )}

        <div className="btn-grid">
          <button
            className="btn btn-soft"
            onClick={() => {
              let newId = ''
              api.commit((p) => {
                const r = createChildUnder(p, id)
                newId = r.id
                return { ...p, root: r.root }
              })
              if (newId) onSelect(newId)
            }}
          >
            + ก้อนย่อย
          </button>
          <button className="btn btn-soft" onClick={() => api.commit((p) => ({ ...p, root: duplicateNode(p.root, id) }))}>
            ทำซ้ำ
          </button>
          <button
            className="btn btn-soft"
            disabled={index <= 0}
            onClick={() => api.commit((p) => ({ ...p, root: moveSibling(p.root, id, -1) }))}
          >
            ↑ เลื่อนขึ้น
          </button>
          <button
            className="btn btn-soft"
            disabled={index < 0 || index >= siblings.length - 1}
            onClick={() => api.commit((p) => ({ ...p, root: moveSibling(p.root, id, 1) }))}
          >
            ↓ เลื่อนลง
          </button>
        </div>

        {children.length > 0 && (
          <section className="sub-block">
            <div className="sub-head">
              <h3>ก้อนย่อย ({children.length})</h3>
              {computed.overAllocated ? (
                <span className="pill is-warn">เกิน {formatMoney(computed.allocated - computed.amount, portfolio.currency)}</span>
              ) : computed.remainder > 0.005 ? (
                <span className="pill">เหลือ {formatMoney(computed.remainder, portfolio.currency)}</span>
              ) : (
                <span className="pill is-ok">ครบ 100%</span>
              )}
            </div>
            <div className="btn-grid">
              <button className="btn btn-soft" onClick={() => api.commit((p) => ({ ...p, root: spreadEvenly(p.root, id) }))}>
                เกลี่ยเท่ากัน
              </button>
              <button className="btn btn-soft" onClick={() => api.commit((p) => ({ ...p, root: normalizeChildren(p, id) }))}>
                ปรับให้ครบ 100%
              </button>
            </div>
            <ul className="mini-list">
              {children.map((child) => {
                const c = tree.byId.get(child.id)
                return (
                  <li key={child.id}>
                    <button className="mini-row" onClick={() => onSelect(child.id)}>
                      <span className="swatch" style={{ background: child.color }} />
                      <span className="mini-name">{child.name}</span>
                      <span className="mini-pct">{formatPercent(c?.parentShare ?? 0)}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        <label className="field-label" htmlFor="note-input">
          บันทึกย่อ
        </label>
        <textarea
          id="note-input"
          className="note-input"
          rows={3}
          placeholder="เหตุผลที่ถือ, จุดเข้า/ออก, ความเสี่ยง…"
          value={node.note ?? ''}
          onFocus={api.checkpoint}
          onChange={(e) => api.amend((p) => ({ ...p, root: updateNode(p.root, id, { note: e.target.value }) }))}
        />

        <button
          className="btn btn-danger full"
          onClick={() => {
            api.commit((p) => ({ ...p, root: removeNode(p.root, id) }))
            onSelect(null)
          }}
        >
          ลบก้อนนี้{children.length > 0 ? ` และก้อนย่อยอีก ${countDescendants(children)}` : ''}
        </button>
      </div>
    </aside>
  )
}

function countDescendants(children: { children: unknown[] }[]): number {
  let n = 0
  const walk = (list: { children: unknown[] }[]) => {
    for (const c of list) {
      n++
      walk(c.children as { children: unknown[] }[])
    }
  }
  walk(children)
  return n
}

function MultiSelect({
  portfolio,
  tree,
  api,
  ids,
  onSelect,
  onSelectMany,
}: {
  portfolio: Portfolio
  tree: ComputedTree
  api: PortfolioApi
  ids: string[]
  onSelect: SelectHandler
  onSelectMany: (ids: string[]) => void
}) {
  const chosen = ids.map((id) => tree.byId.get(id)!).sort((a, b) => b.amount - a.amount)
  const total = chosen.reduce((sum, node) => sum + node.amount, 0)
  const each = total / chosen.length
  const parentId = sharedParentOf(portfolio, ids)
  const parent = parentId ? tree.byId.get(parentId) : null
  const alreadyEven = chosen.every((node) => Math.abs(node.amount - each) < 0.005)
  // What the parent still has spare, and where the selection lands if it soaks it up.
  const spare = parent?.remainder ?? 0
  const withSpare = (total + spare) / chosen.length

  return (
    <aside className="panel panel-right">
      <div className="panel-head">
        <h2>เลือกไว้ {chosen.length} ก้อน</h2>
        <button className="icon-btn tiny" title="ยกเลิกการเลือก (Esc)" onClick={() => onSelect(null)}>
          ×
        </button>
      </div>
      <p className="panel-note">
        Ctrl+คลิก เพื่อเพิ่มหรือเอาออกทีละก้อน · Shift+ลาก บนแผนภาพเพื่อคลุมเลือก
      </p>

      <div className="panel-scroll">
        <dl className="readout">
          <div>
            <dt>รวมกัน</dt>
            <dd>{formatMoney(total, portfolio.currency)}</dd>
          </div>
          <div>
            <dt>ของพอร์ต</dt>
            <dd>{formatPercent(portfolio.capital > 0 ? total / portfolio.capital : 0, 1)}</dd>
          </div>
          <div>
            <dt>เฉลี่ยแล้วก้อนละ</dt>
            <dd>{formatMoney(each, portfolio.currency)}</dd>
          </div>
        </dl>

        <button
          className="btn btn-primary full"
          disabled={alreadyEven}
          title="แบ่งยอดรวมของก้อนที่เลือกให้เท่ากันทุกก้อน โดยยอดรวมเท่าเดิม"
          onClick={() => api.commit((p) => ({ ...p, root: equalizeSelection(p, ids) }))}
        >
          {alreadyEven ? 'เท่ากันอยู่แล้ว' : `หารเฉลี่ยเท่ากัน · ก้อนละ ${formatMoney(each, portfolio.currency)}`}
        </button>

        {parent && (
          <button
            className="btn btn-soft full"
            disabled={spare <= 0.005}
            title={
              spare > 0.005
                ? `ดึง ${formatMoney(spare, portfolio.currency)} ที่ยังไม่ได้จัดสรรใน “${parent.name}” มารวมกับก้อนที่เลือก แล้วหารให้เท่ากัน — ก้อนอื่นที่ไม่ได้เลือกไม่ขยับ`
                : `“${parent.name}” จัดสรรครบแล้ว ไม่มียอดเหลือให้เกลี่ย`
            }
            onClick={() => api.commit((p) => ({ ...p, root: equalizeUsingRemainder(p, ids) }))}
          >
            {spare > 0.005
              ? `เกลี่ยยอดที่เหลือให้เท่ากัน · ก้อนละ ${formatMoney(withSpare, portfolio.currency)}`
              : 'ไม่มียอดเหลือให้เกลี่ย'}
          </button>
        )}

        {parent && (
          <button
            className="btn btn-soft full"
            title="ใช้ยอดทั้งหมดของก้อนแม่ แล้วหารให้ก้อนที่เลือกเท่า ๆ กัน — ก้อนอื่นที่ไม่ได้เลือกจะทำให้ก้อนแม่เกิน 100%"
            onClick={() => api.commit((p) => ({ ...p, root: equalizeWithinParent(p, ids) }))}
          >
            หารเต็มก้อนแม่ “{parent.name}” · ก้อนละ{' '}
            {formatMoney(parent.amount / chosen.length, portfolio.currency)}
          </button>
        )}

        {!parent && (
          <p className="panel-note tight">ก้อนที่เลือกอยู่คนละก้อนแม่ — “หารเฉลี่ยเท่ากัน” ยังใช้ได้ปกติ</p>
        )}

        <ul className="mix-list">
          {chosen.map((node) => (
            <li key={node.id}>
              <button className="mix-row" onClick={() => onSelect(node.id)}>
                <span
                  className="mix-bar"
                  style={{ background: node.color, width: `${total > 0 ? Math.max(3, (node.amount / total) * 100) : 3}%` }}
                />
                <span className="mix-name">{node.name}</span>
                <span className="mix-pct">{formatPercent(total > 0 ? node.amount / total : 0)}</span>
                <span className="mix-amount">{formatMoney(node.amount, portfolio.currency)}</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          className="btn btn-danger full"
          onClick={() => {
            api.commit((p) => ({ ...p, root: ids.reduce((root, id) => removeNode(root, id), p.root) }))
            onSelectMany([])
          }}
        >
          ลบทั้ง {chosen.length} ก้อน
        </button>
      </div>
    </aside>
  )
}
