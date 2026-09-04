import { useState } from 'react'
import type { AllocMode, CurrencyCode } from '../types'
import { CURRENCIES, formatNumber, parseValueInput } from '../lib/format'

export function numText(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100) / 100)
}

interface Props {
  mode: AllocMode
  value: number
  currency: CurrencyCode
  onBegin: () => void
  onChange: (mode: AllocMode, value: number) => void
  className?: string
  title?: string
  ariaLabel?: string
}

/**
 * One field for both units. Typing "35%" switches to percent, "1.5m" or
 * "250,000" switches to an absolute amount — no mode toggle required.
 */
export function ValueField({ mode, value, currency, onBegin, onChange, className, title, ariaLabel }: Props) {
  const [draft, setDraft] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)

  const formatted = mode === 'percent' ? `${numText(value)}%` : formatNumber(value)
  const display = draft ?? formatted

  return (
    <input
      className={`value-field${invalid ? ' is-invalid' : ''}${mode === 'percent' ? ' is-percent' : ' is-amount'} ${className ?? ''}`}
      value={display}
      title={title ?? (mode === 'percent' ? 'สัดส่วนของก้อนแม่ — พิมพ์ตัวเลขล้วนเพื่อใส่เป็นจำนวนเงิน' : `จำนวนเงิน (${CURRENCIES[currency].symbol})`)}
      aria-label={ariaLabel ?? 'สัดส่วนหรือจำนวนเงิน'}
      inputMode="decimal"
      spellCheck={false}
      onFocus={(e) => {
        onBegin()
        setDraft(mode === 'percent' ? numText(value) : numText(value))
        requestAnimationFrame(() => e.target.select())
      }}
      onChange={(e) => {
        const text = e.target.value
        setDraft(text)
        const parsed = parseValueInput(text, mode)
        if (parsed) {
          setInvalid(false)
          onChange(parsed.mode, parsed.value)
        } else {
          setInvalid(text.trim().length > 0)
        }
      }}
      onBlur={() => {
        setDraft(null)
        setInvalid(false)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          ;(e.target as HTMLInputElement).blur()
          return
        }
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        const step = (e.shiftKey ? 10 : e.altKey ? 0.1 : 1) * (mode === 'percent' ? 1 : Math.max(1, 10 ** (Math.floor(Math.log10(Math.max(1, value))) - 1)))
        const next = Math.max(0, value + (e.key === 'ArrowUp' ? step : -step))
        setDraft(numText(next))
        onChange(mode, Math.round(next * 100) / 100)
      }}
    />
  )
}
