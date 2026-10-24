let activeProfileId = 'default'

export function getActiveProfileId() {
  return activeProfileId
}
export function setActiveProfileId(id: string) {
  activeProfileId = id
}

const deviceKeys = new Set(['playerVideoDelayMs', 'playerVideoDelayEnabled', 'anime4kEnabled'])
function keyFor(key: string) {
  return activeProfileId === 'default' || deviceKeys.has(key)
    ? key
    : `dango:profile:${activeProfileId}:${key}`
}

export const profileStorage = {
  keyFor,
  getItem: (key: string) => localStorage.getItem(keyFor(key)),
  setItem: (key: string, value: string) => localStorage.setItem(keyFor(key), value),
  removeItem: (key: string) => localStorage.removeItem(keyFor(key)),
}

export function reloadProfiles() {
  localStorage.setItem('dango:profile-session-change', `${Date.now()}-${Math.random()}`)
  window.location.assign('/')
}
