import { useCallback, useEffect, useState } from 'react'

export type Theme = 'light' | 'dusk' | 'night'

const KEY = 'pansuan:theme'

export const THEMES: { key: Theme; label: string; glyph: string }[] = [
  { key: 'light', label: 'สว่าง', glyph: '☀' },
  { key: 'dusk', label: 'มืดสว่าง', glyph: '◑' },
  { key: 'night', label: 'มืด', glyph: '☾' },
]

const BAR: Record<Theme, string> = { light: '#f1f4fd', dusk: '#0c1128', night: '#04050c' }

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dusk' || value === 'night'
}

/** Saved choice wins; otherwise follow the OS. Mirrors the boot script in index.html. */
function initialTheme(): Theme {
  const attr = document.documentElement.dataset.theme
  if (isTheme(attr)) return attr
  try {
    const saved = localStorage.getItem(KEY)
    if (isTheme(saved)) return saved
  } catch {
    /* private mode — fall through to the OS preference */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dusk'
}

export interface ThemeApi {
  theme: Theme
  /** What the diagram needs to know: which way round the contrast runs. */
  mode: 'light' | 'dark'
  setTheme: (theme: Theme) => void
}

export function useTheme(): ThemeApi {
  const [theme, setThemeState] = useState<Theme>(initialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', BAR[theme])
  }, [theme])

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* the choice just will not survive a reload */
    }
  }, [])

  return { theme, mode: theme === 'light' ? 'light' : 'dark', setTheme }
}
