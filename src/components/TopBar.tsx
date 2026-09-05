import { useState } from 'react'
import type { Portfolio } from '../types'
import type { PortfolioApi } from '../state/usePortfolio'
import { TEMPLATES } from '../model/templates'
import { exportJson, exportSvg, importJson, pickJsonFile } from '../model/storage'
import type { ThemeApi } from '../state/useTheme'
import { ThemeToggle } from './ThemeToggle'
import { SaveToggle } from './SaveToggle'

interface Props {
  portfolio: Portfolio
  api: PortfolioApi
  svgRef: React.RefObject<SVGSVGElement | null>
  onSelect: (id: string | null) => void
  theme: ThemeApi
}

export function TopBar({ portfolio, api, svgRef, onSelect, theme }: Props) {
  const [toast, setToast] = useState<string | null>(null)

  const flash = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((t) => (t === message ? null : t)), 2400)
  }

  const onImport = async () => {
    const file = await pickJsonFile()
    if (!file) return
    try {
      const next = await importJson(file)
      api.replace(next)
      onSelect(null)
      flash(`นำเข้า “${next.name}” แล้ว`)
    } catch {
      flash('ไฟล์ไม่ถูกต้อง — ต้องเป็น JSON ที่ export จาก Pansuan')
    }
  }

  return (
    <header className="topbar">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">
          Pan<em>suan</em>
        </span>
      </div>

      <input
        className="portfolio-name"
        value={portfolio.name}
        aria-label="ชื่อพอร์ต"
        spellCheck={false}
        onFocus={api.checkpoint}
        onChange={(e) => api.amend((p) => ({ ...p, name: e.target.value }))}
      />

      <div className="topbar-actions">
        <ThemeToggle theme={theme.theme} setTheme={theme.setTheme} />

        <select
          className="template-select"
          value=""
          aria-label="เทมเพลตเริ่มต้น"
          onChange={(e) => {
            const template = TEMPLATES.find((t) => t.key === e.target.value)
            if (!template) return
            api.replace(template.make())
            onSelect(null)
            flash(`โหลดเทมเพลต “${template.label}”  (Ctrl+Z เพื่อย้อนกลับ)`)
            e.target.value = ''
          }}
        >
          <option value="" disabled>
            เทมเพลต
          </option>
          {TEMPLATES.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label} — {t.hint}
            </option>
          ))}
        </select>

        <div className="btn-group">
          <button className="icon-btn" title="ย้อนกลับ (Ctrl+Z)" disabled={!api.canUndo} onClick={api.undo}>
            ↶
          </button>
          <button className="icon-btn" title="ทำซ้ำ (Ctrl+Shift+Z)" disabled={!api.canRedo} onClick={api.redo}>
            ↷
          </button>
        </div>

        <SaveToggle
          autosave={api.autosave}
          setAutosave={(on) => {
            api.setAutosave(on)
            flash(
              on
                ? 'เก็บพอร์ตไว้ในเครื่องแล้ว — ปิดแท็บแล้วเปิดใหม่จะได้ของเดิม'
                : 'ปิดการเก็บแล้ว — ลบสำเนาในเครื่องทิ้ง ปิดแท็บเมื่อไหร่พอร์ตนี้หาย · กด “บันทึก JSON” ถ้าอยากเก็บเป็นไฟล์',
            )
          }}
        />

        <button className="btn btn-ghost" onClick={onImport}>
          นำเข้า
        </button>
        <button className="btn btn-ghost" onClick={() => exportJson(portfolio)}>
          บันทึก JSON
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            if (svgRef.current) exportSvg(svgRef.current, portfolio)
          }}
        >
          ส่งออกภาพ SVG
        </button>
      </div>

      <div className={`toast${toast ? ' is-show' : ''}`} role="status">
        {toast}
      </div>
    </header>
  )
}
