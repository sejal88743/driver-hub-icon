const KEY = 'vitratrack_role';
const NAME_KEY = 'vitratrack_user_name';

export type Role = 'owner' | 'user' | 'driver';

export function getRole(): Role | null {
  // Clear any legacy localStorage role on check
  try { localStorage.removeItem(KEY); } catch {}
  return (sessionStorage.getItem(KEY) as Role | null);
}

export function setRole(role: Role) {
  try { sessionStorage.setItem(KEY, role); } catch {}
  try { localStorage.removeItem(KEY); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vt-auth-changed'));
}

export function clearRole() {
  try { sessionStorage.removeItem(KEY); } catch {}
  try { sessionStorage.removeItem(NAME_KEY); } catch {}
  try { localStorage.removeItem(KEY); } catch {}
  try { localStorage.removeItem(NAME_KEY); } catch {}
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('vt-auth-changed'));
}

export function getLoggedInName(): string {
  try { localStorage.removeItem(NAME_KEY); } catch {}
  return sessionStorage.getItem(NAME_KEY) || '';
}

export function setLoggedInName(name: string) {
  try { sessionStorage.setItem(NAME_KEY, name); } catch {}
  try { localStorage.removeItem(NAME_KEY); } catch {}
}

