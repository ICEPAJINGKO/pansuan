import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { Portfolio } from '../types'
import { emptyPortfolio } from '../model/portfolio'
import { clearPortfolio, loadAutosave, loadPortfolio, saveAutosave, savePortfolio } from '../model/storage'

const HISTORY_LIMIT = 80

interface HistoryState {
  past: Portfolio[]
  present: Portfolio
  future: Portfolio[]
}

type Action =
  | { type: 'commit'; portfolio: Portfolio }
  | { type: 'amend'; portfolio: Portfolio }
  | { type: 'checkpoint' }
  | { type: 'undo' }
  | { type: 'redo' }

function push(past: Portfolio[], entry: Portfolio): Portfolio[] {
  const next = past.length >= HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT + 1) : past.slice()
  next.push(entry)
  return next
}

function reducer(state: HistoryState, action: Action): HistoryState {
  switch (action.type) {
    case 'commit': {
      if (action.portfolio === state.present) return state
      return { past: push(state.past, state.present), present: action.portfolio, future: [] }
    }
    case 'amend': {
      if (action.portfolio === state.present) return state
      return { ...state, present: action.portfolio, future: [] }
    }
    case 'checkpoint':
      return { ...state, past: push(state.past, state.present), future: [] }
    case 'undo': {
      const previous = state.past[state.past.length - 1]
      if (!previous) return state
      return { past: state.past.slice(0, -1), present: previous, future: [state.present, ...state.future] }
    }
    case 'redo': {
      const [next, ...rest] = state.future
      if (!next) return state
      return { past: push(state.past, state.present), present: next, future: rest }
    }
    default:
      return state
  }
}

export type Mutator = (portfolio: Portfolio) => Portfolio

export interface PortfolioApi {
  portfolio: Portfolio
  canUndo: boolean
  canRedo: boolean
  /** Edit + a new undo step. */
  commit: (fn: Mutator) => void
  /** Edit without a new undo step — for continuous gestures. */
  amend: (fn: Mutator) => void
  /** Snapshot the current state; call once when a gesture starts. */
  checkpoint: () => void
  undo: () => void
  redo: () => void
  replace: (portfolio: Portfolio) => void
  /** True while the portfolio is kept in this browser between visits. */
  autosave: boolean
  /** Turning it off also forgets the copy already stored. */
  setAutosave: (on: boolean) => void
}

export function usePortfolio(): PortfolioApi {
  const [state, dispatch] = useReducer(reducer, undefined, (): HistoryState => ({
    past: [],
    present: loadPortfolio() ?? emptyPortfolio(),
    future: [],
  }))

  const presentRef = useRef(state.present)
  presentRef.current = state.present

  const apply = useCallback((type: 'commit' | 'amend', fn: Mutator) => {
    const current = presentRef.current
    const next = fn(current)
    if (next === current) return
    dispatch({ type, portfolio: { ...next, updatedAt: Date.now() } })
  }, [])

  const commit = useCallback((fn: Mutator) => apply('commit', fn), [apply])
  const amend = useCallback((fn: Mutator) => apply('amend', fn), [apply])
  const checkpoint = useCallback(() => dispatch({ type: 'checkpoint' }), [])
  const undo = useCallback(() => dispatch({ type: 'undo' }), [])
  const redo = useCallback(() => dispatch({ type: 'redo' }), [])
  const replace = useCallback((portfolio: Portfolio) => dispatch({ type: 'commit', portfolio }), [])

  const [autosave, setAutosaveState] = useState(loadAutosave)

  const setAutosave = useCallback((on: boolean) => {
    setAutosaveState(on)
    saveAutosave(on)
  }, [])

  // Off takes the stored copy with it — and runs on mount too, so a copy left
  // behind by another tab cannot outlive the setting that forbids it. React
  // flushes the cleanup below before this, so a save already in flight is
  // cancelled first and can never land after the wipe.
  useEffect(() => {
    if (!autosave) clearPortfolio()
  }, [autosave])

  // Debounced persistence so a drag does not hammer localStorage.
  useEffect(() => {
    if (!autosave) return
    const id = window.setTimeout(() => savePortfolio(state.present), 320)
    return () => window.clearTimeout(id)
  }, [state.present, autosave])

  // Undo / redo shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const key = e.key.toLowerCase()
      if (key !== 'z' && key !== 'y') return
      const target = e.target as HTMLElement | null
      if (target && /^(input|textarea|select)$/i.test(target.tagName) && !e.shiftKey && key === 'z') {
        // let the browser undo text edits inside a field
        return
      }
      e.preventDefault()
      if (key === 'y' || e.shiftKey) dispatch({ type: 'redo' })
      else dispatch({ type: 'undo' })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return useMemo(
    () => ({
      portfolio: state.present,
      canUndo: state.past.length > 0,
      canRedo: state.future.length > 0,
      commit,
      amend,
      checkpoint,
      undo,
      redo,
      replace,
      autosave,
      setAutosave,
    }),
    [
      state.present,
      state.past.length,
      state.future.length,
      commit,
      amend,
      checkpoint,
      undo,
      redo,
      replace,
      autosave,
      setAutosave,
    ],
  )
}
