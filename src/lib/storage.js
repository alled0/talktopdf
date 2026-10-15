// localStorage helpers that never throw (storage can be disabled or full in private modes).

export function readStorage(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback
  } catch {
    return fallback
  }
}

export function writeStorage(key, value) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore: the app keeps working for this session
  }
}
