/** Shared writes into the cashflow document. One function per fact. */
export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2))
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

export function setCardBalance(d, cardId, balance, date) {
  return {
    ...d,
    cards: d.cards.map((c) => c.id === cardId
      ? (cmp(date, c.balanceAsOf || '0000-01-01') >= 0 ? { ...c, currentBalance: balance, balanceAsOf: date } : c)
      : c),
    observations: [...(d.observations || []).filter((o) => !(o.cardId === cardId && o.date === date)),
      { id: uid(), cardId, date, balance }],
  }
}

export const setAnchor = (d, balance, date) => ({ ...d, anchor: { date, balance } })

export const setAssetBalance = (d, assetId, balance, date) => ({
  ...d,
  assets: (d.assets || []).map((a) => a.id === assetId ? { ...a, balance, asOf: date } : a),
})
