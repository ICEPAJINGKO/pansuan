import type { AllocMode, CurrencyCode } from '../types'

export const CURRENCIES: Record<CurrencyCode, { symbol: string; label: string; locale: string }> = {
  THB: { symbol: '฿', label: 'บาท', locale: 'th-TH' },
  USD: { symbol: '$', label: 'US Dollar', locale: 'en-US' },
  EUR: { symbol: '€', label: 'Euro', locale: 'de-DE' },
  GBP: { symbol: '£', label: 'Pound', locale: 'en-GB' },
  JPY: { symbol: '¥', label: 'Yen', locale: 'ja-JP' },
  SGD: { symbol: 'S$', label: 'SG Dollar', locale: 'en-SG' },
}

const cache = new Map<string, Intl.NumberFormat>()
function nf(key: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  let f = cache.get(key)
  if (!f) {
    f = new Intl.NumberFormat('en-US', opts)
    cache.set(key, f)
  }
  return f
}

/** 1234567.8 -> "1,234,568" (decimals only when the number is small) */
export function formatNumber(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 0 : abs >= 1 ? 2 : 4
  return nf(`n${digits}`, { minimumFractionDigits: 0, maximumFractionDigits: digits }).format(v)
}

export function formatMoney(v: number, currency: CurrencyCode): string {
  return `${CURRENCIES[currency].symbol}${formatNumber(v)}`
}

/** 1234567 -> "1.23M" — for tight labels inside the diagram. */
export function formatCompact(v: number): string {
  if (!Number.isFinite(v)) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e12) return trim(v / 1e12) + 'T'
  if (abs >= 1e9) return trim(v / 1e9) + 'B'
  if (abs >= 1e6) return trim(v / 1e6) + 'M'
  if (abs >= 1e4) return trim(v / 1e3) + 'K'
  return formatNumber(v)
}

function trim(v: number): string {
  return dropTrailingZeros(v.toFixed(Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2))
}

/** "1.50" -> "1.5", "100" -> "100" — never eats zeros that carry magnitude. */
function dropTrailingZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

export function formatPercent(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '0%'
  const p = fraction * 100
  const d = p >= 100 || p === 0 ? 0 : p < 1 ? 2 : digits
  return `${dropTrailingZeros(p.toFixed(d))}%`
}

const SUFFIXES: Record<string, number> = {
  k: 1e3,
  พัน: 1e3,
  m: 1e6,
  ล: 1e6,
  ล้าน: 1e6,
  b: 1e9,
  พันล้าน: 1e9,
  t: 1e12,
}

export interface ParsedValue {
  mode: AllocMode
  value: number
}

/**
 * Smart single-field parser. Accepts:
 *   "35%" / "35 %"        -> percent
 *   "250000" / "250,000"  -> amount
 *   "1.5m" / "250k" / "2b"-> amount with a magnitude suffix
 *   "฿1,000" / "1000 บาท" -> amount
 * Returns null when nothing numeric can be read.
 */
export function parseValueInput(raw: string, fallbackMode: AllocMode = 'amount'): ParsedValue | null {
  const text = raw.trim().toLowerCase()
  if (!text) return null

  const isPercent = text.includes('%')
  const cleaned = text
    .replace(/[%,\s฿$€£¥]/g, '')
    .replace(/บาท|usd|thb|eur|gbp|jpy|sgd|s\$/g, '')

  const m = cleaned.match(/^(-?\d*\.?\d+)([a-zก-๙]*)$/)
  if (!m) return null

  const n = Number(m[1])
  if (!Number.isFinite(n)) return null

  const suffix = m[2]
  const factor = suffix ? SUFFIXES[suffix] : undefined
  if (suffix && !factor) return null

  if (isPercent) return { mode: 'percent', value: clamp(n, 0, 1000) }
  if (factor) return { mode: 'amount', value: Math.max(0, n * factor) }
  // A bare number keeps whatever unit the field is already showing.
  return fallbackMode === 'percent'
    ? { mode: 'percent', value: clamp(n, 0, 1000) }
    : { mode: 'amount', value: Math.max(0, n) }
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** Round to a sane number of decimals so drag-editing doesn't produce 12.300000000001 */
export function tidy(v: number, decimals = 2): number {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}
