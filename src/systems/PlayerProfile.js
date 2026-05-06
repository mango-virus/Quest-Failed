const NAME_KEY = 'qf.player.name'

export const PlayerProfile = {
  getName()     { return localStorage.getItem(NAME_KEY) ?? '' },
  setName(name) { localStorage.setItem(NAME_KEY, name.trim()) },
  hasName()     { const n = localStorage.getItem(NAME_KEY); return !!n && n.trim().length > 0 },
  clearName()   { localStorage.removeItem(NAME_KEY) },
}
