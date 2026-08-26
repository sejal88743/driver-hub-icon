/**
 * Shared Bill Wise Sales Register updater.
 *
 * Rules for this report:
 * - Match existing Supabase bills by BillRefNo/bill_no.
 * - Positive BillValue rows provide bill metadata:
 *   beat, party code, party name, and cleaned salesperson name.
 * - Party names are resolved by party code within the uploaded register so
 *   the same party code always has one canonical name.
 * - Negative BillValue rows update only lineCutAmt. No other bill field is
 *   changed from a negative row.
 * - Beat Name column is compulsory — upload is rejected if it is missing.
 * - Unmatched bill numbers are inserted as new bills (not skipped).
 * - Salesperson names are resolved at 60% similarity against existing names.
 */
import type { Bill } from './billStore';
import { cleanSalespersonName, cleanPartyName, findCanonicalName } from './nameStandardizer';
import { mergeBillsInMemoryOnly, addBillsToMemoryOnly, getSalespersonContacts, getBills, excelSerialToDate } from './billStore';

export type BillsReportStatus = {
  status: 'loading' | 'success' | 'error';
  message: string;
  details?: string[];
};

type RegisterRow = Record<string, unknown>;

type BillGroup = {
  positiveBillValue: number;
  negativeBillValue: number;
  hasNonNegativeRow: boolean; // true if any row with billValue >= 0 was seen (includes 0-value)
  beatName: string;
  partyCode: string;
  partyName: string;
  salespersonName: string;
  billDate: string;
};

type BillReportUpdate = {
  billNo: string;
  patch: Partial<Bill>;
  positiveRow: boolean;
  negativeRow: boolean;
};

function isSummaryRow(billNo: string): boolean {
  const upper = billNo.toUpperCase().replace(/\s+/g, ' ').trim();
  return upper === 'GRAND TOTAL' || upper === 'TOTAL' || upper === 'NET TOTAL'
    || upper.includes('GRAND TOTAL') || upper.includes('SUB TOTAL') || upper.includes('NET TOTAL');
}

function text(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function amount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanRegisterPartyName(value: unknown): string {
  // The register appends one "-D" segment per hierarchy level. Remove all of
  // those suffix segments, then apply the shared name normalizer.
  return cleanPartyName(text(value).replace(/(?:-D)+$/i, '').trim());
}

function cleanRegisterSalespersonName(value: unknown): string {
  // Salesperson export values end with a code such as " - SMN00002".
  return cleanSalespersonName(text(value));
}

function findKey(keys: string[], ...patterns: RegExp[]): string | undefined {
  return keys.find(key => patterns.some(pattern => pattern.test(key)));
}

function parseRegister(data: ArrayBuffer, XLSX: any): {
  groups: Map<string, BillGroup>;
  rowCount: number;
  positiveRows: number;
  negativeRows: number;
} {
  const wb = XLSX.read(new Uint8Array(data), {
    type: 'array',
    dense: false,
    cellStyles: false,
    cellNF: false,
    cellFormula: false,
    cellDates: true,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws?.['!ref']) throw new Error('Sheet is empty.');

  const range = XLSX.utils.decode_range(ws['!ref']);
  let headerRow = -1;
  for (let r = 0; r <= Math.min(30, range.e.r); r++) {
    for (let c = 0; c <= range.e.c; c++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell && /billrefno|bill\s*ref\s*no|^bill\s*no$/i.test(text(cell.v))) {
        headerRow = r;
        break;
      }
    }
    if (headerRow !== -1) break;
  }
  if (headerRow === -1) throw new Error('BillRefNo column header was not found.');

  const rows = XLSX.utils.sheet_to_json(ws, { range: headerRow, defval: '', raw: true }) as RegisterRow[];
  if (rows.length === 0) throw new Error(`No data rows found after header row ${headerRow + 1}.`);

  const keys = Object.keys(rows[0]);
  const billNoKey = findKey(keys, /billrefno/i, /bill\s*ref\s*no/i, /bill\s*no/i, /^bill\s*#/i, /invoice\s*no/i, /doc\s*no/i, /document\s*no/i);
  const billValueKey = findKey(keys, /billvalue/i, /bill\s*value/i, /bill\s*amount/i, /bill\s*amt/i, /net\s*amount/i, /net\s*amt/i, /^amount$/i, /inv\s*amt/i, /invoice\s*amount/i);
  const beatKey = findKey(keys, /^beat$/i, /beat\s*name/i, /^route$/i, /route\s*name/i, /beat_name/i);
  const partyCodeKey = findKey(keys, /^party\s*code$/i, /party\s*code/i, /customer\s*code/i, /party\s*id/i, /retailer\s*code/i, /account\s*code/i);
  const partyNameKey = findKey(keys, /party\s*name/i, /customer\s*name/i, /retailer\s*name/i, /^party$/i, /^customer$/i);
  const salespersonKey = findKey(keys, /salesperson/i, /sales\s*person/i, /salesman/i, /salesman\s*name/i, /executive/i, /sp\s*name/i);
  const billDateKey = findKey(keys, /billdate/i, /bill\s*date/i, /sales\s*return\s*date/i, /^date$/i, /invoice\s*date/i, /doc\s*date/i, /document\s*date/i);

  if (!billNoKey || !billValueKey) {
    throw new Error(`Required columns not found (BillRefNo, BillValue). Found: ${keys.slice(0, 14).join(', ')}`);
  }

  // Beat Name is compulsory — reject the file if the column is absent.
  if (!beatKey) {
    throw new Error(
      `Beat Name column nahi mila. File mein "Beat" ya "Beat Name" column hona zaroori hai. ` +
      `Mile columns: ${keys.slice(0, 14).join(', ')}`
    );
  }

  const groups = new Map<string, BillGroup>();
  let positiveRows = 0;
  let negativeRows = 0;

  for (const row of rows) {
    const billNo = text(row[billNoKey]);
    if (!billNo || isSummaryRow(billNo)) continue;
    const billValue = amount(row[billValueKey]);

    let group = groups.get(billNo);
    if (!group) {
      group = {
        positiveBillValue: 0,
        negativeBillValue: 0,
        hasNonNegativeRow: false,
        beatName: '',
        partyCode: '',
        partyName: '',
        salespersonName: '',
        billDate: '',
      };
      groups.set(billNo, group);
    }

    if (billValue < 0) {
      // Sum negative rows for lineCutAmt
      group.negativeBillValue += Math.abs(billValue);
      negativeRows++;
      // If metadata is present in negative row and group doesn't have it yet, capture it
      if (beatKey && !group.beatName) group.beatName = text(row[beatKey]);
      if (partyCodeKey && !group.partyCode) group.partyCode = text(row[partyCodeKey]);
      if (partyNameKey && !group.partyName) group.partyName = cleanRegisterPartyName(row[partyNameKey]);
      if (salespersonKey && !group.salespersonName) group.salespersonName = cleanRegisterSalespersonName(row[salespersonKey]);
      if (billDateKey && !group.billDate) group.billDate = excelSerialToDate(row[billDateKey]);
      continue;
    }

    group.hasNonNegativeRow = true;
    group.positiveBillValue += billValue;
    positiveRows++;
    const beatName = beatKey ? text(row[beatKey]) : '';
    const partyCode = partyCodeKey ? text(row[partyCodeKey]) : '';
    const partyName = partyNameKey ? cleanRegisterPartyName(row[partyNameKey]) : '';
    const salespersonName = salespersonKey ? cleanRegisterSalespersonName(row[salespersonKey]) : '';
    const billDate = billDateKey ? excelSerialToDate(row[billDateKey]) : '';
    if (beatName) group.beatName = beatName;
    if (partyCode) group.partyCode = partyCode;
    if (partyName) group.partyName = partyName;
    if (salespersonName) group.salespersonName = salespersonName;
    if (billDate) group.billDate = billDate;
  }

  // Resolve party names by party code. The first non-empty cleaned name is
  // canonical for every row sharing that code.
  const partyNameByCode = new Map<string, string>();
  for (const group of groups.values()) {
    if (group.partyCode && group.partyName && !partyNameByCode.has(group.partyCode)) {
      partyNameByCode.set(group.partyCode, group.partyName);
    }
  }
  for (const group of groups.values()) {
    if (group.partyCode && partyNameByCode.has(group.partyCode)) {
      group.partyName = partyNameByCode.get(group.partyCode)!;
    }
  }

  return { groups, rowCount: rows.length, positiveRows, negativeRows };
}

function buildUpdates(groups: Map<string, BillGroup>, existingBills: Bill[]): {
  updates: BillReportUpdate[];
  missing: Map<string, BillGroup>;
} {
  const existingByBillNo = new Map<string, Bill>();
  for (const bill of existingBills) {
    const billNo = text(bill.billNo);
    if (billNo) existingByBillNo.set(billNo, bill);
  }

  const updates: BillReportUpdate[] = [];
  const missing = new Map<string, BillGroup>();

  for (const [billNo, group] of groups) {
    const existing = existingByBillNo.get(billNo);
    if (!existing) {
      // Collect groups for new bill creation. Any group that had at least one
      // non-negative row (including 0-value bills) is accepted; pure
      // line-cut-only groups (only negative rows) are still skipped.
      if (group.hasNonNegativeRow) missing.set(billNo, group);
      continue;
    }

    const patch: Partial<Bill> = {};

    // 1. Bill Date update
    if (group.billDate) {
      patch.date = group.billDate;
    }

    // 2. Party Name, Party Code, Beat Name, Salesperson Name updates
    if (group.hasNonNegativeRow || group.beatName) {
      if (group.beatName) patch.beatName = group.beatName;
      if (group.partyCode) patch.partyCode = group.partyCode;
      if (group.partyName) patch.partyName = group.partyName;
      if (group.salespersonName) patch.salespersonName = group.salespersonName;
    }

    // 3. Positive Bill Value (+ amount -> billNetAmt)
    if (group.positiveBillValue > 0) {
      patch.billNetAmt = group.positiveBillValue;
    }

    // 4. Negative Bill Value (- amount -> lineCutAmt)
    if (group.negativeBillValue > 0) {
      patch.lineCutAmt = group.negativeBillValue;
    }

    // 5. Calculate effective net bill amount & effective line cut amount
    const effectiveBillAmt = (patch.billNetAmt !== undefined)
      ? patch.billNetAmt
      : (Number(existing.billNetAmt) || 0);

    const effectiveLineCutAmt = (patch.lineCutAmt !== undefined)
      ? (patch.lineCutAmt || 0)
      : (Number(existing.lineCutAmt) || 0);

    const cash = Number(existing.cashAmount) || 0;
    const upi = Number(existing.upiAmount) || 0;
    const cheque = Number(existing.chequeAmount) || 0;
    const recAmt = (Number(existing.collectedAmount) || 0) + cash + upi + cheque;

    const curMode = (existing.paymentMode || '').toLowerCase();
    const isLockedPayment = cash > 0 || upi > 0 || cheque > 0 || (recAmt > 0 && curMode === 'paid');

    if (recAmt === 0 && !isLockedPayment) {
      // If rec amount is 0 and line cut amt >= bill amount (net balance = 0), auto set FBR
      if (effectiveBillAmt > 0 && (effectiveBillAmt - effectiveLineCutAmt <= 0 || Math.abs(effectiveBillAmt - effectiveLineCutAmt) <= 1)) {
        patch.paymentMode = 'FBR';
        patch.paymentMethod = 'FBR';
        patch.outstandingAmount = 0;
      } else {
        if (curMode === 'fbr' || curMode === 'cancel') {
          patch.paymentMode = 'Unpaid';
          patch.paymentMethod = undefined;
        }
        patch.outstandingAmount = Math.max(0, effectiveBillAmt - effectiveLineCutAmt);
      }
    } else {
      // Money has been received on this bill
      patch.outstandingAmount = Math.max(0, effectiveBillAmt - effectiveLineCutAmt - recAmt);
    }

    // Calculate ageing from new or existing date
    const targetDateStr = patch.date || existing.date;
    if (targetDateStr) {
      const today = new Date();
      let parsedTs = today.getTime();
      const [dd, mm, yyyy] = targetDateStr.split('/').map(Number);
      if (dd && mm && yyyy) parsedTs = new Date(yyyy, mm - 1, dd).getTime();
      patch.billAgeing = Math.max(0, Math.floor((today.getTime() - parsedTs) / 86400000));
    }

    if (Object.keys(patch).length > 0) {
      updates.push({
        billNo,
        patch,
        positiveRow: group.positiveBillValue > 0,
        negativeRow: group.negativeBillValue > 0,
      });
    }
  }
  return { updates, missing };
}

/** Build new Bill objects from groups that were not found in Supabase. */
function buildNewBills(missing: Map<string, BillGroup>, spNames: string[]): Bill[] {
  const today = new Date();
  const todayStr = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
  const newBills: Bill[] = [];

  for (const [billNo, g] of missing) {
    const billAmt = g.positiveBillValue;
    const lineCutAmt = g.negativeBillValue;
    const isFBR = billAmt > 0 && (billAmt - lineCutAmt <= 0 || Math.abs(billAmt - lineCutAmt) <= 1);

    let parsedTs = today.getTime();
    if (g.billDate) {
      const [dd, mm, yyyy] = g.billDate.split('/').map(Number);
      if (dd && mm && yyyy) parsedTs = new Date(yyyy, mm - 1, dd).getTime();
    }
    const ageing = Math.max(0, Math.floor((today.getTime() - parsedTs) / 86400000));

    // Resolve salesperson name at 60% similarity against known names
    const resolvedSP = g.salespersonName
      ? findCanonicalName(g.salespersonName, spNames, cleanSalespersonName, 0.60)
      : '';

    newBills.push({
      id: crypto.randomUUID(),
      srNo: '',
      date: g.billDate || todayStr,
      salespersonName: resolvedSP,
      collectionCode: '',
      billNo,
      partyCode: g.partyCode,
      partyHulCode: '',
      partyName: g.partyName,
      beatName: g.beatName,
      billNetAmt: billAmt,
      collectedAmount: 0,
      outstandingAmount: isFBR ? 0 : Math.max(0, billAmt - lineCutAmt),
      billAgeing: ageing,
      lineCutAmt: lineCutAmt || 0,
      cancelLine: '',
      ...(isFBR ? { paymentMode: 'FBR' } : {}),
    } as Bill);
  }

  return newBills;
}

async function readFileAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') return file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error || new Error('Could not read file.'));
    reader.readAsArrayBuffer(file);
  });
}

export async function processBillsReportFile(
  file: File,
  onStatus: (s: BillsReportStatus) => void
): Promise<void> {
  return processBillsReportBuffer(await readFileAsArrayBuffer(file), onStatus);
}

export async function processBillsReportBuffer(
  buffer: ArrayBuffer,
  onStatus: (s: BillsReportStatus) => void
): Promise<void> {
  onStatus({ status: 'loading', message: 'Reading Sales Register...' });
  try {
    const XLSX = await import('xlsx');
    onStatus({ status: 'loading', message: 'Supabase se existing bills fetch ho rahe hain...' });
    const { apiFetchAllData, apiPatchBills, apiBulkInsertWithProgress } = await import('@/lib/apiSync');
    const data = await apiFetchAllData();
    const parsed = parseRegister(buffer, XLSX);

    // Build list of all known SP names for 60% resolution (existing bills + contacts)
    const spNames: string[] = Array.from(new Set([
      ...getSalespersonContacts().map(c => c.name).filter(Boolean),
      ...getBills().map(b => b.salespersonName).filter(Boolean),
      ...data.bills.map((b: Bill) => b.salespersonName).filter(Boolean),
    ])) as string[];

    // Apply 60% SP name resolution to every group in the register
    for (const group of parsed.groups.values()) {
      if (group.salespersonName) {
        group.salespersonName = findCanonicalName(
          group.salespersonName, spNames, cleanSalespersonName, 0.60
        );
      }
    }

    const { updates, missing } = buildUpdates(parsed.groups, data.bills);
    const newBills = buildNewBills(missing, spNames);

    if (updates.length === 0 && newBills.length === 0) {
      onStatus({ status: 'error', message: 'Koi bill update ya add nahi hua. File format check karein.' });
      return;
    }

    const totalToSave = updates.length + newBills.length;
    onStatus({ status: 'loading', message: `Supabase me save ho raha hai... 0 / ${totalToSave}` });

    // ── Patch existing bills ─────────────────────────────────────────────────
    const byBillNo = new Map(data.bills.map((bill: Bill) => [text(bill.billNo), bill]));
    let savedUpdates = 0;

    if (updates.length > 0) {
      const patches = updates
        .map(update => {
          const bill = byBillNo.get(update.billNo);
          return bill?.id ? { id: bill.id, patch: update.patch } : null;
        })
        .filter((value): value is { id: string; patch: Partial<Bill> } => value !== null);

      const BATCH_SIZE = 250;
      for (let i = 0; i < patches.length; i += BATCH_SIZE) {
        const result = await apiPatchBills(patches.slice(i, i + BATCH_SIZE));
        savedUpdates += result.count;
        onStatus({ status: 'loading', message: `Supabase me save ho raha hai... ${savedUpdates} / ${totalToSave}` });
        if (result.count !== Math.min(BATCH_SIZE, patches.length - i)) {
          onStatus({ status: 'error', message: `Supabase update incomplete: ${savedUpdates} / ${patches.length} bills saved.` });
          return;
        }
      }

      const mergedBills = updates.map(update => {
        const existing = byBillNo.get(update.billNo)!;
        return { ...existing, ...update.patch };
      });
      mergeBillsInMemoryOnly(mergedBills);
    }

    // ── Insert new bills ─────────────────────────────────────────────────────
    let savedNew = 0;
    if (newBills.length > 0) {
      addBillsToMemoryOnly(newBills);
      await apiBulkInsertWithProgress(newBills, (saved) => {
        savedNew = saved;
        onStatus({ status: 'loading', message: `Supabase me save ho raha hai... ${savedUpdates + savedNew} / ${totalToSave}` });
      });
    }

    // ── Build result details ─────────────────────────────────────────────────
    const identityUpdates = updates.filter(u => u.positiveRow).length;
    const lineCutUpdates = updates.filter(u => u.negativeRow).length;
    const fbrUpdatedCount = updates.filter(u => u.patch.paymentMode === 'FBR').length;
    const fbrNewCount = newBills.filter(b => b.paymentMode === 'FBR').length;
    const details: string[] = [
      `Identity updated (beat/party/salesperson): ${identityUpdates}`,
      `Line cut updated: ${lineCutUpdates}`,
      ...(fbrUpdatedCount > 0 ? [`Auto FBR updated (Line cut = Bill Amt): ${fbrUpdatedCount}`] : []),
      `Register rows: ${parsed.rowCount} · positive: ${parsed.positiveRows} · negative: ${parsed.negativeRows}`,
    ];
    if (newBills.length > 0) {
      details.push(`New bills added: ${newBills.length}${fbrNewCount ? ` (${fbrNewCount} FBR)` : ''}`);
    }
    const missingPureLineCut = [...parsed.groups.entries()]
      .filter(([bn, g]) => g.positiveBillValue === 0 && g.negativeBillValue > 0 && !byBillNo.has(bn)).length;
    if (missingPureLineCut > 0) {
      details.push(`Skipped (only line-cut, no bill amount — naya bill nahi banega): ${missingPureLineCut}`);
    }

    onStatus({
      status: 'success',
      message: `${updates.length} updated · ${newBills.length} new added`,
      details,
    });
  } catch (err: any) {
    onStatus({ status: 'error', message: `Sales Register update failed: ${err?.message || 'Unknown error'}` });
  }
}
