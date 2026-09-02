export type CommissionMoc = {
  id: string;
  code: string;   // e.g. "MOC 1", "MOC 2", "MOC 8"
  label: string;  // e.g. "MOC 1", "MOC 2", "MOC 8"
  month?: string; // Optional legacy compatibility (not displayed)
  active?: boolean;
};

export const DEFAULT_COMMISSION_MOCS: CommissionMoc[] = [
  { id: 'moc_1', code: 'MOC 1', label: 'MOC 1', active: true },
  { id: 'moc_2', code: 'MOC 2', label: 'MOC 2', active: true },
  { id: 'moc_3', code: 'MOC 3', label: 'MOC 3', active: true },
  { id: 'moc_4', code: 'MOC 4', label: 'MOC 4', active: true },
  { id: 'moc_5', code: 'MOC 5', label: 'MOC 5', active: true },
  { id: 'moc_6', code: 'MOC 6', label: 'MOC 6', active: true },
  { id: 'moc_7', code: 'MOC 7', label: 'MOC 7', active: true },
  { id: 'moc_8', code: 'MOC 8', label: 'MOC 8', active: true },
  { id: 'moc_9', code: 'MOC 9', label: 'MOC 9', active: true },
  { id: 'moc_10', code: 'MOC 10', label: 'MOC 10', active: true },
  { id: 'moc_11', code: 'MOC 11', label: 'MOC 11', active: true },
  { id: 'moc_12', code: 'MOC 12', label: 'MOC 12', active: true },
];

const LS_KEY = 'vitratrack_commission_mocs';

export function getCommissionMocs(): CommissionMoc[] {
  if (typeof window === 'undefined') return DEFAULT_COMMISSION_MOCS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((m: any, idx: number) => {
          const rawCode = (m.code || `MOC ${idx + 1}`).trim().toUpperCase();
          const cleanCode = rawCode.startsWith('MOC') ? rawCode : `MOC ${rawCode}`;
          return {
            id: m.id || `moc_${idx + 1}`,
            code: cleanCode,
            label: cleanCode,
            active: m.active !== false,
          };
        });
      }
    }
  } catch (e) {
    console.error('Error loading Commission MOCs:', e);
  }
  return DEFAULT_COMMISSION_MOCS;
}

export function saveCommissionMocs(mocs: CommissionMoc[]): void {
  if (typeof window === 'undefined') return;
  try {
    const cleaned = mocs.map(m => {
      const cleanCode = (m.code || '').trim().toUpperCase();
      const code = cleanCode.startsWith('MOC') ? cleanCode : `MOC ${cleanCode}`;
      return {
        id: m.id,
        code,
        label: code,
        active: m.active !== false,
      };
    });
    localStorage.setItem(LS_KEY, JSON.stringify(cleaned));
    window.dispatchEvent(new CustomEvent('vt-commission-mocs-updated', { detail: cleaned }));
    // Try background sync with server setting if available
    import('./apiSync').then(m => {
      m.apiPushSetting('commission_mocs', JSON.stringify(cleaned)).catch(() => {});
    }).catch(() => {});
  } catch (e) {
    console.error('Error saving Commission MOCs:', e);
  }
}

export function addCommissionMoc(_monthOrCode: string, code?: string): CommissionMoc[] {
  let cleanCode = (code || _monthOrCode || '').trim().toUpperCase();
  if (!cleanCode.startsWith('MOC')) {
    cleanCode = `MOC ${cleanCode}`.trim();
  }
  const current = getCommissionMocs();
  const newMoc: CommissionMoc = {
    id: `moc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    code: cleanCode,
    label: cleanCode,
    active: true,
  };
  const updated = [...current, newMoc];
  saveCommissionMocs(updated);
  return updated;
}

export function updateCommissionMoc(id: string, _monthOrCode: string, code?: string): CommissionMoc[] {
  let cleanCode = (code || _monthOrCode || '').trim().toUpperCase();
  if (!cleanCode.startsWith('MOC')) {
    cleanCode = `MOC ${cleanCode}`.trim();
  }
  const current = getCommissionMocs();
  const updated = current.map(m => {
    if (m.id === id) {
      return {
        ...m,
        code: cleanCode,
        label: cleanCode,
      };
    }
    return m;
  });
  saveCommissionMocs(updated);
  return updated;
}

export function extractMocNumber(input?: string): string {
  if (!input) return '';
  const clean = input.toUpperCase().trim();
  const match = clean.match(/MOC\s*(\d+)/i);
  if (match) return match[1];
  const numOnly = clean.replace(/[^0-9]/g, '');
  return numOnly || '';
}

export function extractMocSrNumber(input?: string): number | null {
  if (!input) return null;
  const clean = input.toUpperCase().trim();
  const match = clean.match(/SR\s*(\d+)/i);
  if (match) return parseInt(match[1], 10);
  return null;
}

export function formatMocSerialBillNo(mocCodeOrNum: string, srNo: number | string): string {
  const mocNum = extractMocNumber(mocCodeOrNum) || '1';
  return `MOC${mocNum}-SR${srNo}`;
}

export function isMocBill(bill: any, alt?: any): boolean {
  if (!bill) return alt ? isMocBill(alt) : false;
  if (typeof bill === 'string') {
    const clean = bill.toUpperCase().trim();
    const strMatch = clean.startsWith('MOC') || clean.includes('MOC') || clean.includes('COMMISSION');
    if (strMatch) return true;
    return alt ? isMocBill(alt) : false;
  }

  const bn = (bill.billNo || '').toUpperCase().trim();
  const sp = (bill.salespersonName || '').toUpperCase().trim();
  const pt = (bill.partyName || '').toUpperCase().trim();
  const cc = (bill.collectionCode || '').toUpperCase().trim();
  const bt = (bill.beatName || '').toUpperCase().trim();
  const id = (bill.id || '').toLowerCase();

  return (
    sp === 'MOC' ||
    cc === 'MOC' ||
    bt === 'COMMISSION' ||
    id.startsWith('moc_') ||
    bn.startsWith('MOC') ||
    bn.includes('MOC') ||
    pt.includes('COMMISSION') ||
    pt.includes('MOC')
  );
}

export function getDisplayBillNo(b: any): string {
  if (!b) return '';
  if (typeof b === 'string') {
    const str = b.trim();
    if (isMocBill(str)) {
      const mocNum = extractMocNumber(str) || '1';
      const srMatch = extractMocSrNumber(str);
      const sr = srMatch ? String(srMatch) : '1';
      return `MOC${mocNum}-SR${sr}`;
    }
    return str;
  }

  if (isMocBill(b)) {
    const bn = (b.billNo || '').trim();
    const mocNum = extractMocNumber(bn) || extractMocNumber(b.partyName) || extractMocNumber(b.partyCode) || '1';
    const srMatch = extractMocSrNumber(bn);
    const sr = srMatch ? String(srMatch) : (b.srNo && b.srNo !== '0' && b.srNo !== '' ? String(b.srNo) : '1');
    return `MOC${mocNum}-SR${sr}`;
  }

  return b.billNo || '';
}

export function hasMocEntries(moc: CommissionMoc, customBills?: any[]): boolean {
  if (!moc) return false;
  let allBills: any[] = [];
  if (Array.isArray(customBills) && customBills.length > 0) {
    allBills = customBills;
  } else if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('vt_cached_bills_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allBills = parsed;
      }
    } catch {}
  }

  if (allBills.length === 0) return false;
  const mocNum = extractMocNumber(moc.code);

  return allBills.some(b => {
    if (!b) return false;
    if (!isMocBill(b)) return false;
    const bMocNum = extractMocNumber(b.billNo) || extractMocNumber(b.partyName) || extractMocNumber(b.partyCode);
    return bMocNum === mocNum;
  });
}

export function deleteCommissionMoc(id: string, customBills?: any[]): { success: boolean; updated: CommissionMoc[]; error?: string } {
  const current = getCommissionMocs();
  const target = current.find(m => m.id === id);
  if (!target) {
    return { success: true, updated: current };
  }

  if (hasMocEntries(target, customBills)) {
    return {
      success: false,
      updated: current,
      error: `CANNOT REMOVE ${target.code}: ENTRY ALREADY EXISTS IN RECORDS/BILLS FOR THIS MOC! (CANNOT BE REMOVED BY OWNER/ADMIN)`
    };
  }

  const updated = current.filter(m => m.id !== id);
  saveCommissionMocs(updated);
  return { success: true, updated };
}

export function resetCommissionMocsToDefault(customBills?: any[]): CommissionMoc[] {
  const current = getCommissionMocs();
  const preservedMocs = current.filter(m => hasMocEntries(m, customBills));
  
  const combined = [...DEFAULT_COMMISSION_MOCS];
  for (const pres of preservedMocs) {
    if (!combined.some(c => (c?.code || '').toUpperCase() === (pres?.code || '').toUpperCase())) {
      combined.push(pres);
    }
  }
  saveCommissionMocs(combined);
  return combined;
}

export function formatMocBillNo(code: string): string {
  const clean = (code || '').trim().toUpperCase();
  return clean.startsWith('MOC') ? clean : `MOC ${clean}`;
}

export function formatMocPartyName(_monthOrCode: string, code?: string): string {
  const c = code || _monthOrCode || 'MOC';
  const num = extractMocNumber(c);
  return num ? `COMMISSION (MOC ${num})` : 'COMMISSION (MOC)';
}

export function isBillMatchingMocCode(b: any, targetCode: string): boolean {
  if (!b || !targetCode) return false;
  const cleanTarget = targetCode.trim().toUpperCase();
  if (cleanTarget === 'MOC' || cleanTarget === 'ALL MOC' || cleanTarget === 'COMMISSION') {
    return isMocBill(b);
  }
  const targetMocNum = extractMocNumber(cleanTarget);
  if (!targetMocNum) return isMocBill(b);

  const bn = (b.billNo || '').trim().toUpperCase();
  const pt = (b.partyName || '').trim().toUpperCase();
  const pc = (b.partyCode || '').trim().toUpperCase();
  const cc = (b.collectionCode || '').trim().toUpperCase();

  const bMocNum = extractMocNumber(bn) || extractMocNumber(pt) || extractMocNumber(pc) || extractMocNumber(cc);
  return isMocBill(b) && bMocNum === targetMocNum;
}

export function getMocEntries(mocCodeOrNum: string, customBills?: any[]): any[] {
  let allBills: any[] = [];
  if (Array.isArray(customBills) && customBills.length > 0) {
    allBills = customBills;
  } else if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('vt_cached_bills_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allBills = parsed;
      }
    } catch {}
  }
  return allBills.filter(b => {
    if (!b) return false;
    const isSaved = (Number(b.collectedAmount) || 0) > 0 || (Number(b.cashAmount) || 0) > 0 || (Number(b.upiAmount) || 0) > 0 || (Number(b.chequeAmount) || 0) > 0 || (!!b.paymentDate && b.paymentDate.trim() !== '' && b.paymentDate !== '—');
    return isSaved && isBillMatchingMocCode(b, mocCodeOrNum);
  });
}

export function getNextMocSrNo(mocCodeOrNum: string, customBills?: any[]): number {
  const mocNum = extractMocNumber(mocCodeOrNum) || '1';
  let allBills: any[] = [];
  if (Array.isArray(customBills) && customBills.length > 0) {
    allBills = customBills;
  } else if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem('vt_cached_bills_v2');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) allBills = parsed;
      }
    } catch {}
  }

  const usedSrNumbers = new Set<number>();
  for (const b of allBills) {
    if (!b) continue;
    if (!isMocBill(b)) continue;
    const bMocNum = extractMocNumber(b.billNo) || extractMocNumber(b.partyName) || extractMocNumber(b.partyCode);
    if (bMocNum === mocNum) {
      const srFromBn = extractMocSrNumber(b.billNo);
      if (srFromBn && srFromBn > 0) {
        usedSrNumbers.add(srFromBn);
      } else if (b.srNo && Number(b.srNo) > 0) {
        usedSrNumbers.add(Number(b.srNo));
      }
    }
  }

  // Find next sequential unused integer >= 1
  let candidate = 1;
  while (usedSrNumbers.has(candidate)) {
    candidate++;
  }
  return candidate;
}

