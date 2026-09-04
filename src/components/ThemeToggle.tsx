import { THEMES, type ThemeApi } from '../state/useTheme'

export function ThemeToggle({ theme, setTheme }: Pick<ThemeApi, 'theme' | 'setTheme'>) {
  return (
    <div className="theme-toggle" role="group" aria-label="โทนสีของเว็บ">
      {THEMES.map((option) => (
        <button
          key={option.key}
          className={theme === option.key ? 'is-active' : ''}
          title={option.label}
          aria-label={option.label}
          aria-pressed={theme === option.key}
          onClick={() => setTheme(option.key)}
        >
          {option.glyph}
        </button>
      ))}
    </div>
  )
}
