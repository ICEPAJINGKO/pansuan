import { useRef } from 'react'
import type { ComputedTree, Portfolio } from '../types'
import type { PortfolioApi } from '../state/usePortfolio'
import type { SelectHandler } from '../App'
import {
  canTrimExcess,
  convertMode,
  createChildUnder,
  duplicateNode,
  excessOf,
  fillRemainderAcross,
  findParent,
  flattenLeaves,
  equalizeSelection,
  equalizeWithinParent,
  moveSibling,
  normalizeChildren,
  removeNode,
  ROOT_ID,
  sharedParentOf,
  spareOf,
  spreadEvenly,
  trimExcessAcross,
  trimShares,
  updateNode,
  type FillSplit,
  type ShareSplit,
} from '../model/portfolio'
import { formatMoney, formatPercent } from '../lib/format'
import { hex6, SWATCHES } from '../lib/palette'
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
  // Only the parent's own children can be cut to fit it or filled up from it —
  // not anything deeper.
  const excess = parentComputed ? excessOf(parentComputed) : 0
  const spare = parentComputed ? spareOf(parentComputed) : 0
  const canTrim = parentComputed ? canTrimExcess(computed, parentComputed) : false
  const money = (amount: number) => formatMoney(amount, portfolio.currency)

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

        <ColorPicker id={id} color={node.color} api={api} />

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

        {parent && spare > 0 && (
          <div className="shift-box is-spare">
            <p className="shift-note">
              ก้อนแม่ <b>“{parent.name}”</b> ยังเหลือ <b>{money(spare)}</b> ที่ยังไม่ได้จัดสรร
            </p>
            <button
              className="btn btn-soft btn-spare full"
              title="เอายอดที่เหลือของก้อนแม่ใส่เข้าก้อนนี้ก้อนเดียว ก้อนอื่นไม่ขยับ แล้วก้อนแม่จะครบ 100% พอดี"
              onClick={() =>
                api.commit((p) => {
                  const next = fillRemainderAcross(p, [id])
                  return next === p.root ? p : { ...p, root: next }
                })
              }
            >
              เติมส่วนที่เหลือของก้อนแม่ (+{money(spare)})
            </button>
            <p className="shift-note is-soft">
              ก้อนนี้จะเป็น {money(computed.amount + spare)} จาก {money(computed.amount)} · ก้อนอื่นไม่ขยับ · ก้อนแม่ครบ 100% พอดี
            </p>
            {children.length > 0 && (
              <p className="shift-note is-soft">
                ก้อนย่อยของก้อนนี้ที่ตั้งเป็น % จะเพิ่มตามยอดใหม่ ส่วนที่ตั้งเป็นจำนวนเงินจะคงเดิม
              </p>
            )}
            <p className="shift-note is-soft">
              เลือกหลายก้อน (Ctrl+คลิก) เพื่อเกลี่ยเข้าหลายก้อนพร้อมกัน — ตามจำนวนเงิน ตามสัดส่วน หรือหารเท่ากัน
            </p>
          </div>
        )}

        {parent && excess > 0 && (
          <div className="shift-box is-over">
            <p className="shift-note">
              ก้อนแม่ <b>“{parent.name}”</b> จัดสรรเกิน <b className="is-warn">{money(excess)}</b>
            </p>
            <button
              className="btn btn-soft btn-warn full"
              disabled={!canTrim}
              title="เอายอดที่เกินออกจากก้อนนี้ก้อนเดียว ก้อนอื่นไม่ขยับ แล้วก้อนแม่จะครบ 100% พอดี"
              onClick={() =>
                api.commit((p) => {
                  const next = trimExcessAcross(p, [id])
                  return next === p.root ? p : { ...p, root: next }
                })
              }
            >
              ตัดยอดที่เกินออกจากก้อนนี้ (−{money(excess)})
            </button>
            <p className="shift-note is-soft">
              {canTrim
                ? `ก้อนนี้จะเหลือ ${money(computed.amount - excess)} จาก ${money(computed.amount)} · ก้อนอื่นไม่ขยับ · ก้อนแม่ครบ 100% พอดี`
                : `ก้อนนี้มี ${money(computed.amount)} น้อยกว่ายอดที่เกิน — ตัดทั้งก้อนก็ยังไม่พอ ลองเลือกก้อนที่ใหญ่กว่า`}
            </p>
            {canTrim && children.length > 0 && (
              <p className="shift-note is-soft">
                ก้อนย่อยของก้อนนี้ที่ตั้งเป็น % จะลดตามยอดใหม่ ส่วนที่ตั้งเป็นจำนวนเงินจะคงเดิม
              </p>
            )}
          </div>
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
            {computed.overAllocated && (
              <p className="shift-note is-soft">
                เลือกก้อนย่อยก้อนใดก้อนหนึ่งด้านล่าง แล้วกด “ตัดยอดที่เกินออกจากก้อนนี้” เพื่อให้ก้อนนี้กลับมาครบ 100%
              </p>
            )}
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

/**
 * The preset grid, then a free picker for anything it does not hold. The native
 * picker reports every step of a drag across its colour field, so it is given
 * one undo step per opening rather than one per step — and only once something
 * actually changed, which is why the checkpoint waits for the first change
 * instead of running on open.
 */
function ColorPicker({ id, color, api }: { id: string; color: string; api: PortfolioApi }) {
  const fresh = useRef(false)
  const current = color.toLowerCase()
  const isPreset = SWATCHES.includes(current)

  return (
    <>
      <div className="swatch-grid" role="group" aria-label="สีของก้อนนี้">
        {SWATCHES.map((swatch) => (
          <button
            key={swatch}
            className={`swatch-btn${swatch === current ? ' is-active' : ''}`}
            style={{ background: swatch }}
            title={swatch}
            aria-label={swatch}
            aria-pressed={swatch === current}
            onClick={() => api.commit((p) => ({ ...p, root: updateNode(p.root, id, { color: swatch }) }))}
          />
        ))}
      </div>

      <label
        className={`swatch-custom${isPreset ? '' : ' is-active'}`}
        style={{ '--chip': hex6(color) } as React.CSSProperties}
      >
        <span className="swatch-chip" aria-hidden="true" />
        <span className="swatch-custom-text">เลือกสีเอง</span>
        <code>{hex6(color)}</code>
        {/* Covers the whole label, invisibly: the click lands on the real input. */}
        <input
          type="color"
          value={hex6(color)}
          aria-label="เลือกสีเอง"
          onClick={() => {
            fresh.current = true
          }}
          onChange={(e) => {
            if (fresh.current) {
              fresh.current = false
              api.checkpoint()
            }
            const next = e.target.value
            api.amend((p) => ({ ...p, root: updateNode(p.root, id, { color: next }) }))
          }}
        />
      </label>
    </>
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
  const spare = parent ? spareOf(parent) : 0
  const withSpare = (total + spare) / chosen.length

  // When the parent holds more than it has, the selection can be what gives it back.
  const money = (amount: number) => formatMoney(amount, portfolio.currency)
  const excess = parent ? excessOf(parent) : 0
  const evenShares = trimShares(
    chosen.map((node) => node.amount),
    excess,
    'equal',
  )
  // Null means the selection together holds less than the excess: no way to cover it.
  const canTrim = evenShares !== null
  // True when everyone can afford the same baht — no small node is emptied for the others.
  const evenCut =
    evenShares !== null && evenShares.every((share) => Math.abs(share - excess / chosen.length) <= 1e-6 + excess * 1e-9)
  const trim = (split: ShareSplit) =>
    api.commit((p) => {
      const next = trimExcessAcross(p, ids, split)
      return next === p.root ? p : { ...p, root: next }
    })
  // The other way round: the parent has money nobody holds yet, and the selection takes it.
  const fill = (split: FillSplit) =>
    api.commit((p) => {
      const next = fillRemainderAcross(p, ids, split)
      return next === p.root ? p : { ...p, root: next }
    })

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

        {parent && excess > 0 && (
          <div className="shift-box is-over">
            <p className="shift-note">
              ก้อนแม่ <b>“{parent.name}”</b> จัดสรรเกิน <b className="is-warn">{money(excess)}</b>
            </p>
            <button
              className="btn btn-soft btn-warn full"
              disabled={!canTrim}
              title="เอายอดที่เกินออกจากทุกก้อนที่เลือกก้อนละเท่า ๆ กัน ก้อนที่มียอดไม่พอจะเหลือ ฿0 แล้วก้อนอื่นรับส่วนที่ขาดแทน"
              onClick={() => trim('equal')}
            >
              {!canTrim
                ? 'ตัดเท่า ๆ กัน'
                : evenCut
                  ? `ตัดเท่า ๆ กัน · ก้อนละ −${money(excess / chosen.length)}`
                  : 'ตัดเท่า ๆ กัน · ก้อนเล็กถูกตัดจนหมดก่อน'}
            </button>
            <button
              className="btn btn-soft btn-warn full"
              disabled={!canTrim}
              title="เอายอดที่เกินออกจากทุกก้อนที่เลือกในสัดส่วนเดียวกัน ก้อนใหญ่เสียมากกว่า ก้อนเล็กเสียน้อยกว่า และไม่มีก้อนไหนติดลบ"
              onClick={() => trim('proportional')}
            >
              {canTrim ? `ตัดตามสัดส่วนยอด · ทุกก้อนลด ${formatPercent(excess / total)}` : 'ตัดตามสัดส่วนยอด'}
            </button>
            <p className="shift-note is-soft">
              {canTrim
                ? `ก้อนที่เลือกรวม ${money(total)} จะเหลือ ${money(total - excess)} · ก้อนที่ไม่ได้เลือกไม่ขยับ · ก้อนแม่ครบ 100% พอดี`
                : `ก้อนที่เลือกรวมกันมี ${money(total)} น้อยกว่ายอดที่เกิน — ตัดทั้งหมดก็ยังไม่พอ เลือกก้อนเพิ่มอีก`}
            </p>
          </div>
        )}

        {parent && spare > 0 && (
          <div className="shift-box is-spare">
            <p className="shift-note">
              ก้อนแม่ <b>“{parent.name}”</b> ยังเหลือ <b>{money(spare)}</b> ที่ยังไม่ได้จัดสรร
            </p>
            <button
              className="btn btn-soft btn-spare full"
              title="แบ่งยอดที่เหลือให้ทุกก้อนที่เลือกก้อนละเท่า ๆ กัน"
              onClick={() => fill('equal')}
            >
              เพิ่มตามจำนวนเงิน · ก้อนละ +{money(spare / chosen.length)}
            </button>
            <button
              className="btn btn-soft btn-spare full"
              disabled={total <= 0}
              title="แบ่งยอดที่เหลือตามสัดส่วนยอดของแต่ละก้อน ก้อนใหญ่ได้มากกว่า ก้อนเล็กได้น้อยกว่า"
              onClick={() => fill('proportional')}
            >
              {total > 0 ? `เพิ่มตามสัดส่วนยอด · ทุกก้อน +${formatPercent(spare / total)}` : 'เพิ่มตามสัดส่วนยอด'}
            </button>
            <button
              className="btn btn-soft btn-spare full"
              title="ดึงยอดที่เหลือมารวมกับก้อนที่เลือก แล้วหารให้เท่ากันทุกก้อน — ก้อนที่ใหญ่กว่าค่าเฉลี่ยใหม่จะลดลงด้วย ส่วนก้อนที่ไม่ได้เลือกไม่ขยับ"
              onClick={() => fill('level')}
            >
              เกลี่ยยอดที่เหลือให้เท่ากัน · ก้อนละ {money(withSpare)}
            </button>
            <p className="shift-note is-soft">
              ก้อนที่เลือกรวม {money(total)} จะเป็น {money(total + spare)} · ก้อนที่ไม่ได้เลือกไม่ขยับ · ก้อนแม่ครบ 100% พอดี
              {total <= 0 && ' · ก้อนที่เลือกยังเป็น ฿0 หมด จึงไม่มีสัดส่วนให้ยึด'}
            </p>
          </div>
        )}

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
