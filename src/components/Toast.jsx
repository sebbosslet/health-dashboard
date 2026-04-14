import { useState, useCallback } from 'react'

let toastFn = null

export function Toast() {
  const [state, setState] = useState({ msg: '', show: false })

  toastFn = useCallback((msg) => {
    setState({ msg, show: true })
    setTimeout(() => setState(s => ({ ...s, show: false })), 2200)
  }, [])

  return <div className={`toast ${state.show ? 'show' : ''}`}>{state.msg}</div>
}

export function showToast(msg) {
  if (toastFn) toastFn(msg)
}
