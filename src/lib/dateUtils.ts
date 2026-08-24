// ── Centralized, robust date parsing and formatting utilities ──────────────

/**
 * Normalizes any date string or Date object to standard display format "DD/MM/YYYY".
 * Handles: DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, YYYY/MM/DD, D/M/YYYY, Excel serial numbers, Date instances, ISO strings.
 */
export function normDateStr(v: unknown): string | undefined {
  if (v == null || v === '') return undefined;
  const res = excelSerialToDate(v);
  return res || undefined;
}

export function getTodayISO(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function getTodayDMY(): string {
  const now = new Date();
  return `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
}

/**
 * Converts any standard date representation (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.)
 * to HTML5 date input format "YYYY-MM-DD".
 */
export function displayToIso(disp: string | undefined | null): string {
  if (!disp) return '';
  const s = String(disp).trim();
  if (!s) return '';

  // Already ISO: YYYY-MM-DD or YYYY-M-D
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // YYYY/MM/DD or YYYY/M/D
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('/');
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY, DD-MM-YYYY, D/M/YYYY, D-M-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // ISO timestamp with 'T' (e.g. 2026-08-15T00:00:00.000Z)
  if (s.includes('T')) {
    const isoPart = s.split('T')[0];
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(isoPart)) {
      const [y, m, d] = isoPart.split('-');
      return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  }

  // Fallback: try Date constructor
  const parsed = new Date(s);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getUTCFullYear();
    const m = String(parsed.getUTCMonth() + 1).padStart(2, '0');
    const d = String(parsed.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return s;
}

/**
 * Converts any standard date representation (YYYY-MM-DD, YYYY/MM/DD, DD-MM-YYYY, etc.)
 * to standard display format "DD/MM/YYYY".
 */
export function isoToDisplay(iso: string | undefined | null): string {
  if (!iso) return '';
  const s = String(iso).trim();
  if (!s) return '';

  // Already standard DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  // DD-MM-YYYY
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s.replace(/-/g, '/');

  // YYYY-MM-DD or YYYY-M-D
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('-');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // YYYY/MM/DD or YYYY/M/D
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('/');
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // D/M/YYYY or D-M-YYYY
  const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
  }

  // ISO timestamp with 'T'
  if (s.includes('T')) {
    const isoPart = s.split('T')[0];
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(isoPart)) {
      const [y, m, d] = isoPart.split('-');
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
  }

  return s;
}

/**
 * Universal date parser for Excel serial numbers, Date instances, ISO strings,
 * and text dates (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD, etc.).
 * Always outputs "DD/MM/YYYY".
 */
export function excelSerialToDate(serial: number | string | Date | unknown): string {
  if (serial == null || serial === '') return '';

  if (serial instanceof Date) {
    if (isNaN(serial.getTime())) return '';
    const d = String(serial.getDate()).padStart(2, '0');
    const m = String(serial.getMonth() + 1).padStart(2, '0');
    const y = serial.getFullYear();
    return `${d}/${m}/${y}`;
  }

  if (typeof serial === 'string') {
    const s = serial.trim();
    if (!s) return '';

    // Standard DD/MM/YYYY
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

    // DD-MM-YYYY
    if (/^\d{2}-\d{2}-\d{4}$/.test(s)) {
      const [d, m, y] = s.split('-');
      return `${d}/${m}/${y}`;
    }

    // D/M/YYYY or D-M-YYYY (single digit day/month)
    const dmyMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
      const [, d, m, y] = dmyMatch;
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }

    // YYYY-MM-DD or YYYY-M-D
    if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }

    // YYYY/MM/DD or YYYY/M/D
    if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
      const [y, m, d] = s.split('/');
      return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }

    // ISO timestamp format
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
      const dt = new Date(s);
      if (!isNaN(dt.getTime())) {
        const d = String(dt.getUTCDate()).padStart(2, '0');
        const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
        const y = dt.getUTCFullYear();
        return `${d}/${m}/${y}`;
      }
    }

    // If it's a numeric string (e.g. "45519" from Excel)
    if (/^\d{5}$/.test(s)) {
      const num = Number(s);
      if (!isNaN(num) && num > 30000 && num < 60000) {
        return excelSerialToDate(num);
      }
    }

    return s;
  }

  if (typeof serial === 'number') {
    if (isNaN(serial) || serial <= 0) return '';
    // Excel epoch offset (1900 date system with leap year bug)
    const date = new Date((serial - 25569) * 86400 * 1000);
    if (isNaN(date.getTime())) return '';
    const d = String(date.getUTCDate()).padStart(2, '0');
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const y = date.getUTCFullYear();
    return `${d}/${m}/${y}`;
  }

  return '';
}
