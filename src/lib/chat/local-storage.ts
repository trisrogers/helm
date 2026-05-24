/**
 * Safe localStorage accessor — returns null in non-browser contexts or when
 * storage access is blocked (e.g. private browsing quota).
 */

function isStorage(value: unknown): value is Storage {
  return (
    Boolean(value) &&
    typeof (value as Storage).getItem === 'function' &&
    typeof (value as Storage).setItem === 'function'
  );
}

export function getSafeLocalStorage(): Storage | null {
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    const storage = window.localStorage;
    return isStorage(storage) ? storage : null;
  } catch {
    return null;
  }
}
