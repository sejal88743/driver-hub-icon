export type CommissionMoc = {
  id: string;
  month: string;  // e.g. "MAY", "JUN", "JUL", "AUG"
  code: string;   // e.g. "MOC 5", "MOC 6", "MOC 7", "MOC 8"
  label: string;  // e.g. "MAY = MOC 5"
  active?: boolean;
};

export const DEFAULT_COMMISSION_MOCS: CommissionMoc[] = [
  { id: 'moc_1', month: 'JAN', code: 'MOC 1', label: 'JAN = MOC 1', active: true },
  { id: 'moc_2', month: 'FEB', code: 'MOC 2', label: 'FEB = MOC 2', active: true },
  { id: 'moc_3', month: 'MAR', code: 'MOC 3', label: 'MAR = MOC 3', active: true },
  { id: 'moc_4', month: 'APR', code: 'MOC 4', label: 'APR = MOC 4', active: true },
  { id: 'moc_5', month: 'MAY', code: 'MOC 5', label: 'MAY = MOC 5', active: true },
  { id: 'moc_6', month: 'JUN', code: 'MOC 6', label: 'JUN = MOC 6', active: true },
  { id: 'moc_7', month: 'JUL', code: 'MOC 7', label: 'JUL = MOC 7', active: true },
  { id: 'moc_8', month: 'AUG', code: 'MOC 8', label: 'AUG = MOC 8', active: true },
  { id: 'moc_9', month: 'SEP', code: 'MOC 9', label: 'SEP = MOC 9', active: true },
  { id: 'moc_10', month: 'OCT', code: 'MOC 10', label: 'OCT = MOC 10', active: true },
  { id: 'moc_11', month: 'NOV', code: 'MOC 11', label: 'NOV = MOC 11', active: true },
  { id: 'moc_12', month: 'DEC', code: 'MOC 12', label: 'DEC = MOC 12', active: true },
];

const LS_KEY = 'vitratrack_commission_mocs';

export function getCommissionMocs(): CommissionMoc[] {
  if (typeof window === 'undefined') return DEFAULT_COMMISSION_MOCS;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
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
    localStorage.setItem(LS_KEY, JSON.stringify(mocs));
    window.dispatchEvent(new CustomEvent('vt-commission-mocs-updated', { detail: mocs }));
    // Try background sync with server setting if available
    import('./apiSync').then(m => {
      m.apiPushSetting('commission_mocs', JSON.stringify(mocs)).catch(() => {});
    }).catch(() => {});
  } catch (e) {
    console.error('Error saving Commission MOCs:', e);
  }
}

export function addCommissionMoc(month: string, code: string): CommissionMoc[] {
  const cleanMonth = (month || '').trim().toUpperCase();
  let cleanCode = (code || '').trim().toUpperCase();
  if (!cleanCode.startsWith('MOC')) {
    cleanCode = `MOC ${cleanCode}`.trim();
  }
  const current = getCommissionMocs();
  const newMoc: CommissionMoc = {
    id: `moc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    month: cleanMonth,
    code: cleanCode,
    label: `${cleanMonth} = ${cleanCode}`,
    active: true,
  };
  const updated = [...current, newMoc];
  saveCommissionMocs(updated);
  return updated;
}

export function updateCommissionMoc(id: string, month: string, code: string): CommissionMoc[] {
  const cleanMonth = (month || '').trim().toUpperCase();
  let cleanCode = (code || '').trim().toUpperCase();
  if (!cleanCode.startsWith('MOC')) {
    cleanCode = `MOC ${cleanCode}`.trim();
  }
  const current = getCommissionMocs();
  const updated = current.map(m => {
    if (m.id === id) {
      return {
        ...m,
        month: cleanMonth,
        code: cleanCode,
        label: `${cleanMonth} = ${cleanCode}`,
      };
    }
    return m;
  });
  saveCommissionMocs(updated);
  return updated;
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

  const cleanMonth = (moc.month || '').trim().toUpperCase();
  const cleanCode = (moc.code || '').trim().toUpperCase();
  const cleanCodeNoSpace = cleanCode.replace(/\s+/g, '');
  const mocNumOnly = cleanCode.replace(/[^0-9]/g, '');

  return allBills.some(b => {
    if (!b) return false;
    const bn = (b.billNo || '').trim().toUpperCase();
    const bnNoSpace = bn.replace(/\s+/g, '');
    const pt = (b.partyName || '').trim().toUpperCase();
    const cc = (b.collectionCode || '').trim().toUpperCase();
    const sp = (b.salespersonName || '').trim().toUpperCase();
    const bt = (b.beatName || '').trim().toUpperCase();

    // 1. Direct BillNo match: "MOC 5", "MOC5", or Month like "MAY"
    if (bn === cleanCode || bnNoSpace === cleanCodeNoSpace) return true;
    if (cleanMonth && bn === cleanMonth) return true;

    // 2. Collection code or beatName or salesperson is MOC
    const isMocType = sp === 'MOC' || cc === 'MOC' || bt === 'COMMISSION' || bn.startsWith('MOC') || pt.includes('COMMISSION');
    if (isMocType) {
      if (cleanMonth && (bn.includes(cleanMonth) || pt.includes(cleanMonth) || cc.includes(cleanMonth))) {
        return true;
      }
      if (cleanCode && (bn.includes(cleanCode) || bnNoSpace.includes(cleanCodeNoSpace) || pt.includes(cleanCode) || cc.includes(cleanCode))) {
        return true;
      }
      if (mocNumOnly && (bn === `MOC${mocNumOnly}` || bn === `MOC ${mocNumOnly}` || pt.includes(`MOC ${mocNumOnly}`) || pt.includes(`MOC${mocNumOnly}`))) {
        return true;
      }
    }

    // 3. Formatted party name match
    if (cleanMonth && pt.includes(`COMMISSION - ${cleanMonth}`)) return true;
    if (cleanCode && (pt.includes(`(${cleanCode})`) || pt.includes(`(${cleanCodeNoSpace})`))) return true;

    return false;
  });
}

export function deleteCommissionMoc(id: string, customBills?: any[]): { success: boolean; updated: CommissionMoc[]; error?: string } {
  const current = getCommissionMocs();
  const target = current.find(m => m.id === id);
  if (!target) {
    return { success: true, updated: current };
  }

  // STRICT INTEGRITY CHECK: Never remove if ANY entry exists for this MOC month (even by Owner)
  if (hasMocEntries(target, customBills)) {
    return {
      success: false,
      updated: current,
      error: `CANNOT REMOVE ${target.month} = ${target.code}: ENTRY ALREADY EXISTS IN RECORDS/BILLS FOR THIS MOC MONTH! (CANNOT BE REMOVED BY OWNER/ADMIN)`
    };
  }

  const updated = current.filter(m => m.id !== id);
  saveCommissionMocs(updated);
  return { success: true, updated };
}

export function resetCommissionMocsToDefault(customBills?: any[]): CommissionMoc[] {
  const current = getCommissionMocs();
  // Preserve any custom or existing MOCs that already have entries in bills
  const preservedMocs = current.filter(m => hasMocEntries(m, customBills));
  
  // Merge default MOCs with preserved MOCs without duplicate codes
  const combined = [...DEFAULT_COMMISSION_MOCS];
  for (const pres of preservedMocs) {
    if (!combined.some(c => c.code.toUpperCase() === pres.code.toUpperCase() || (c.month.toUpperCase() === pres.month.toUpperCase() && c.code.toUpperCase() === pres.code.toUpperCase()))) {
      combined.push(pres);
    }
  }
  saveCommissionMocs(combined);
  return combined;
}

export function isMocBill(bill: { billNo?: string; salespersonName?: string; partyName?: string }): boolean {
  if (!bill) return false;
  const bn = (bill.billNo || '').toUpperCase().trim();
  const sp = (bill.salespersonName || '').toUpperCase().trim();
  const pt = (bill.partyName || '').toUpperCase().trim();

  return (
    sp === 'MOC' ||
    sp.includes('COMMISSION') ||
    bn.startsWith('MOC') ||
    bn.includes('MOC') ||
    pt.includes('COMMISSION') ||
    pt.includes('MOC')
  );
}

export function formatMocBillNo(code: string): string {
  const clean = (code || '').trim().toUpperCase();
  return clean.startsWith('MOC') ? clean : `MOC ${clean}`;
}

export function formatMocPartyName(month: string, code: string): string {
  const m = (month || '').trim().toUpperCase();
  const c = formatMocBillNo(code);
  return m ? `COMMISSION - ${m} (${c})` : `COMMISSION (${c})`;
}

export function isBillMatchingMocCode(b: any, targetMonthOrCode: string): boolean {
  if (!b || !targetMonthOrCode) return false;
  const cleanTarget = targetMonthOrCode.trim().toUpperCase();
  const cleanTargetNoSpace = cleanTarget.replace(/\s+/g, '');
  const targetNumOnly = cleanTarget.replace(/[^0-9]/g, '');

  const bn = (b.billNo || '').trim().toUpperCase();
  const bnNoSpace = bn.replace(/\s+/g, '');
  const pt = (b.partyName || '').trim().toUpperCase();
  const cc = (b.collectionCode || '').trim().toUpperCase();
  const sp = (b.salespersonName || '').trim().toUpperCase();
  const bt = (b.beatName || '').trim().toUpperCase();

  if (bn === cleanTarget || bnNoSpace === cleanTargetNoSpace) return true;
  if (pt.includes(`(${cleanTarget})`) || pt.includes(`(${cleanTargetNoSpace})`)) return true;
  if (pt.includes(`COMMISSION - ${cleanTarget}`)) return true;

  const isMoc = sp === 'MOC' || cc === 'MOC' || bt === 'COMMISSION' || bn.startsWith('MOC') || pt.includes('COMMISSION') || pt.includes('MOC');
  if (!isMoc) return false;

  if (cleanTarget && (bn.includes(cleanTarget) || pt.includes(cleanTarget) || cc.includes(cleanTarget))) return true;
  if (cleanTargetNoSpace && (bnNoSpace.includes(cleanTargetNoSpace) || pt.replace(/\s+/g, '').includes(cleanTargetNoSpace))) return true;
  if (targetNumOnly && (bn === `MOC${targetNumOnly}` || bn === `MOC ${targetNumOnly}` || pt.includes(`MOC ${targetNumOnly}`) || pt.includes(`MOC${targetNumOnly}`))) return true;

  return false;
}

export function getMocEntries(mocMonthOrCode: string, customBills?: any[]): any[] {
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
    return isSaved && isBillMatchingMocCode(b, mocMonthOrCode);
  });
}

export function getNextMocSrNo(mocMonthOrCode: string, customBills?: any[]): number {
  const entries = getMocEntries(mocMonthOrCode, customBills);
  return entries.length + 1;
}
