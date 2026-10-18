import { useCallback, useMemo, useRef, useState } from 'react'
import { COL_GAP, COL_GAP_MAX, COL_GAP_MIN, COL_GAP_STEP } from '../model/layout'

const KEY = 'pansuan:colgap'

function clampGap(value: number): number {
  return Math.min(COL_GAP_MAX, Math.max(COL_GAP_MIN, Math.round(value)))
}

/** A stored value is only trusted if it is a number; anything else is the default. */
function initialGap(): number {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw !== null) {
      const stored = Number(raw)
      if (Number.isFinite(stored)) return clampGap(stored)
    }
  } catch {
    /* private mode — fall through to the default */
  }
  return COL_GAP
}

export interface ColumnGapApi {
  /** Horizontal space between a parent's column and its children's. */
  gap: number
  /** One step wider (+1) or tighter (-1), landing on a multiple of the step. */
  nudge: (direction: 1 | -1) => void
  reset: () => void
}

/**
 * How far apart the columns sit. Like the theme, this is how the diagram is
 * *viewed*, not part of the portfolio — it is kept apart from the saved graph,
 * so it neither rides along in an exported file nor takes a step of undo.
 */
export function useColumnGap(): ColumnGapApi {
  const [gap, setGapState] = useState(initialGap)

  // What the next nudge starts from. Written here as well as on render: two
  // nudges that land before React has re-rendered must build on each other, not
  // both start from the value the first one found.
  const latest = useRef(gap)
  latest.current = gap

  const setGap = useCallback((next: number) => {
    const value = clampGap(next)
    latest.current = value
    setGapState(value)
    try {
      // The default is the absence of a choice, so it leaves nothing behind.
      if (value === COL_GAP) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, String(value))
    } catch {
      /* the choice just will not survive a reload */
    }
  }, [])

  // Snapping to the step keeps the readout tidy: from the default 146 a click
  // goes to 160 or 140 rather than 166 or 126, and stays on round numbers after.
  const nudge = useCallback(
    (direction: 1 | -1) => {
      const slot = latest.current / COL_GAP_STEP
      setGap((direction > 0 ? Math.floor(slot) + 1 : Math.ceil(slot) - 1) * COL_GAP_STEP)
    },
    [setGap],
  )

  const reset = useCallback(() => setGap(COL_GAP), [setGap])

  return useMemo(() => ({ gap, nudge, reset }), [gap, nudge, reset])
}
