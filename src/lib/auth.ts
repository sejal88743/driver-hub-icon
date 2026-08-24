const KEY = 'vitratrack_role';
const NAME_KEY = 'vitratrack_user_name';

export type Role = 'owner' | 'user' | 'driver';

export function getRole(): Role | null {
  return (sessionStorage.getItem(KEY) as Role | null);
}

export function setRole(role: Role) {
  sessionStorage.setItem(KEY, role);
}

export function clearRole() {
  sessionStorage.removeItem(KEY);
  sessionStorage.removeItem(NAME_KEY);
}

export function getLoggedInName(): string {
  return sessionStorage.getItem(NAME_KEY) || '';
}

export function setLoggedInName(name: string) {
  sessionStorage.setItem(NAME_KEY, name);
}
