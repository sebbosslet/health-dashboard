import { createContext, useContext, useState, useEffect } from 'react'
import { translations } from './i18n'

const LangContext = createContext()

export function LangProvider({ children }) {
  const [lang, setLangState] = useState(() => {
    return localStorage.getItem('sebs_lang') || 'en'
  })

  function setLang(code) {
    localStorage.setItem('sebs_lang', code)
    setLangState(code)
  }

  const t = (key) => translations[lang]?.[key] || translations['en']?.[key] || key

  return (
    <LangContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
