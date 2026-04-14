import { useLang } from '../lib/LangContext'
import { LANGUAGES } from '../lib/i18n'

export default function LangToggle({ style }) {
  const { lang, setLang } = useLang()

  return (
    <div style={{
      display: 'flex',
      gap: 4,
      background: 'var(--surface2)',
      borderRadius: 20,
      padding: 3,
      border: '0.5px solid var(--border)',
      ...style,
    }}>
      {LANGUAGES.map(l => (
        <button
          key={l.code}
          onClick={() => setLang(l.code)}
          title={l.label}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '5px 10px',
            borderRadius: 16,
            border: 'none',
            background: lang === l.code ? 'var(--surface)' : 'transparent',
            cursor: 'pointer',
            fontFamily: 'inherit',
            fontSize: 12,
            fontWeight: lang === l.code ? 600 : 400,
            color: lang === l.code ? 'var(--text)' : 'var(--text3)',
            transition: 'all 0.15s',
            boxShadow: lang === l.code ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
          }}
        >
          <span style={{ fontSize: 16 }}>{l.flag}</span>
          <span>{l.code.toUpperCase()}</span>
        </button>
      ))}
    </div>
  )
}
