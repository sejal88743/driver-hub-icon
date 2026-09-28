/**
 * Salesperson Name Synchronization Utility (Bill No Wise).
 * 
 * Supports:
 * - LeverEDGE Sales Register (.csv, .xlsx, .xls)
 * - Any custom Excel/CSV with Bill No + Salesperson Name
 * - Raw CSV/TSV pasted text
 * - Cleans salesperson names (strips - SMN00001, designations, roles)
 * - Automatic Master Salesperson Directory resolution (preserving permanent phone numbers)
 * - Batch updates to Supabase bills table + Instant Local Cache Sync
 */

import { supabase } from './supabase';
import { cleanSalespersonName } from './nameStandardizer';
import { findMasterSalesperson, MASTER_SALESPERSON_DIRECTORY } from './salespersonDirectory';
import { getBills, mergeBillsInMemoryOnly, type Bill } from './billStore';
import { safeReadWorkbook } from './xlsxHelper';

export interface SalespersonSyncRow {
  billNo: string;
  matchedDbBillNo?: string;
  rawSalesperson: string;
  cleanedSalesperson: string;
  masterSalesperson?: string;
  finalSalesperson: string;
  partyName?: string;
  billDate?: string;
  currentDbSalesperson?: string;
  status: 'will_update' | 'already_matches' | 'not_found_in_db';
}

export interface ParseSalespersonResult {
  rows: SalespersonSyncRow[];
  totalRowsParsed: number;
  uniqueBills: number;
  uniqueSalespersons: { name: string; count: number; masterName?: string }[];
  missingCount: number;
  warnings: string[];
}

function text(val: unknown): string {
  if (val === null || val === undefined) return '';
  return String(val).trim();
}

function findKey(keys: string[], ...patterns: RegExp[]): string | undefined {
  return keys.find(k => patterns.some(p => p.test(k)));
}

function isSummaryRow(billNo: string): boolean {
  const upper = billNo.toUpperCase().replace(/\s+/g, ' ').trim();
  return (
    upper === 'GRAND TOTAL' ||
    upper === 'TOTAL' ||
    upper === 'NET TOTAL' ||
    upper.includes('GRAND TOTAL') ||
    upper.includes('SUB TOTAL') ||
    upper.includes('NET TOTAL')
  );
}

/**
 * Parses CSV/TSV string or Excel ArrayBuffer and extracts BillNo + SalespersonName mappings.
 */
export async function parseSalespersonRegister(
  input: ArrayBuffer | string,
  options: { preferMasterNames?: boolean } = {}
): Promise<ParseSalespersonResult> {
  const preferMaster = options.preferMasterNames !== false; // default true
  const XLSX = await import('xlsx');

  let rows: Record<string, unknown>[] = [];
  const warnings: string[] = [];

  if (typeof input === 'string') {
    // String could be CSV or TSV
    const trimmed = input.trim();
    if (!trimmed) {
      return { rows: [], totalRowsParsed: 0, uniqueBills: 0, uniqueSalespersons: [], missingCount: 0, warnings: ['Empty input'] };
    }
    // SheetJS reads CSV/TSV strings cleanly
    try {
      const wb = XLSX.read(trimmed, { type: 'string', raw: true });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: '', raw: true });
    } catch (e: any) {
      warnings.push(`CSV parsing warning: ${e.message || String(e)}`);
    }
  } else {
    // ArrayBuffer (Excel or CSV file upload)
    try {
      const wb = safeReadWorkbook(XLSX, input, {
        dense: false,
        cellStyles: false,
        cellNF: false,
        cellFormula: false,
        cellDates: false,
      });
      const ws = wb.Sheets[wb.SheetNames[0]];
      if (!ws?.['!ref']) throw new Error('Sheet is empty');

      const range = XLSX.utils.decode_range(ws['!ref']);
      let headerRow = -1;
      for (let r = 0; r <= Math.min(35, range.e.r); r++) {
        for (let c = 0; c <= range.e.c; c++) {
          const cell = ws[XLSX.utils.encode_cell({ r, c })];
          if (cell && /billrefno|bill\s*ref\s*no|^bill\s*no$|salesperson|invoice\s*no/i.test(text(cell.v))) {
            headerRow = r;
            break;
          }
        }
        if (headerRow !== -1) break;
      }

      const effectiveRange = headerRow !== -1 ? headerRow : 0;
      rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
        range: effectiveRange,
        defval: '',
        raw: true,
      });
    } catch (e: any) {
      throw new Error(`Failed to parse file: ${e.message || String(e)}`);
    }
  }

  if (rows.length === 0) {
    throw new Error('No data rows found in file.');
  }

  // Detect column headers
  const keys = Object.keys(rows[0]);
  const billNoKey = findKey(
    keys,
    /billrefno/i,
    /bill\s*ref\s*no/i,
    /^bill\s*no$/i,
    /bill\s*#|invoice\s*no|doc\s*no|document\s*no/i,
    /bill_no/i
  );
  const salespersonKey = findKey(
    keys,
    /salesperson\s*name/i,
    /salesperson/i,
    /sales\s*person/i,
    /salesman\s*name/i,
    /salesman/i,
    /executive/i,
    /sp\s*name/i,
    /^dsm$/i,
    /salesperson_name/i
  );
  const partyNameKey = findKey(keys, /party\s*name/i, /customer\s*name/i, /^party$/i, /retailer\s*name/i);
  const billDateKey = findKey(keys, /billdate/i, /bill\s*date/i, /sales\s*return\s*date/i, /^date$/i, /invoice\s*date/i);

  if (!billNoKey) {
    throw new Error(
      `Bill Number column nahi mila. File me BillRefNo, Bill No ya Invoice No column hona zaroori hai. Mile columns: ${keys.slice(0, 10).join(', ')}`
    );
  }
  if (!salespersonKey) {
    throw new Error(
      `Salesperson Name column nahi mila. File me "Salesperson Name" ya "Salesman" column hona zaroori hai. Mile columns: ${keys.slice(0, 10).join(', ')}`
    );
  }

  // Load existing local bills to compare
  const localBills = getBills();
  const dbBillMap = new Map<string, Bill>();
  for (const b of localBills) {
    if (b.billNo) {
      dbBillMap.set(b.billNo.trim().toUpperCase(), b);
      const stripped = b.billNo.replace(/^GST[-_]?/i, '').trim().toUpperCase();
      if (stripped && !dbBillMap.has(stripped)) {
        dbBillMap.set(stripped, b);
      }
    }
  }

  // Map rows by billNo (preserve latest or non-empty)
  const mapByBillNo = new Map<string, SalespersonSyncRow>();
  const spCounter = new Map<string, { count: number; masterName?: string }>();

  for (const row of rows) {
    const rawBill = text(row[billNoKey]);
    if (!rawBill || isSummaryRow(rawBill)) continue;

    const rawSp = text(row[salespersonKey]);
    if (!rawSp) continue;

    const cleanedSp = cleanSalespersonName(rawSp);
    if (!cleanedSp) continue;

    const masterMatch = findMasterSalesperson(cleanedSp);
    const finalSp = (preferMaster && masterMatch?.name) ? masterMatch.name : cleanedSp;

    // Track salesperson counts
    const prevSp = spCounter.get(finalSp) || { count: 0, masterName: masterMatch?.name };
    prevSp.count++;
    spCounter.set(finalSp, prevSp);

    // Look for bill in database
    const billUpper = rawBill.toUpperCase();
    const strippedUpper = rawBill.replace(/^GST[-_]?/i, '').toUpperCase();
    const existing = dbBillMap.get(billUpper) || dbBillMap.get(strippedUpper) || dbBillMap.get(`GST${strippedUpper}`);

    const party = partyNameKey ? text(row[partyNameKey]) : (existing?.partyName || '');
    const date = billDateKey ? text(row[billDateKey]) : (existing?.date || '');

    const currentDbSp = existing?.salespersonName ? cleanSalespersonName(existing.salespersonName) : '';

    let status: SalespersonSyncRow['status'] = 'not_found_in_db';
    if (existing) {
      if (currentDbSp && currentDbSp.toUpperCase() === finalSp.toUpperCase()) {
        status = 'already_matches';
      } else {
        status = 'will_update';
      }
    }

    mapByBillNo.set(billUpper, {
      billNo: rawBill,
      matchedDbBillNo: existing?.billNo,
      rawSalesperson: rawSp,
      cleanedSalesperson: cleanedSp,
      masterSalesperson: masterMatch?.name,
      finalSalesperson: finalSp,
      partyName: party,
      billDate: date,
      currentDbSalesperson: existing?.salespersonName,
      status,
    });
  }

  const resultRows = Array.from(mapByBillNo.values());
  const uniqueSalespersons = Array.from(spCounter.entries()).map(([name, data]) => ({
    name,
    count: data.count,
    masterName: data.masterName,
  }));

  return {
    rows: resultRows,
    totalRowsParsed: rows.length,
    uniqueBills: resultRows.length,
    uniqueSalespersons,
    missingCount: resultRows.filter(r => r.status === 'not_found_in_db').length,
    warnings,
  };
}

/**
 * Updates matching bills in Supabase and the in-memory bill store.
 */
export async function syncSalespersonUpdatesToSupabase(
  rows: SalespersonSyncRow[],
  onProgress?: (done: number, total: number, message: string) => void
): Promise<{
  updatedCount: number;
  skippedCount: number;
  notFoundCount: number;
  errors: string[];
}> {
  if (!supabase) {
    throw new Error('Supabase client is not initialized.');
  }

  // Filter to rows that actually need updating or exist in DB
  const toUpdate = rows.filter(r => r.status === 'will_update' || r.matchedDbBillNo);
  const total = toUpdate.length;

  if (total === 0) {
    return {
      updatedCount: 0,
      skippedCount: rows.length,
      notFoundCount: rows.filter(r => r.status === 'not_found_in_db').length,
      errors: [],
    };
  }

  onProgress?.(0, total, `Updating ${total} bills in Supabase...`);

  const BATCH_SIZE = 40;
  let updatedCount = 0;
  const errors: string[] = [];
  const updatedBillsForMemory: Bill[] = [];
  const localBills = getBills();
  const localByBillNo = new Map(localBills.map(b => [b.billNo.toUpperCase(), b]));

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const chunk = toUpdate.slice(i, i + BATCH_SIZE);

    await Promise.all(
      chunk.map(async item => {
        const targetBillNo = item.matchedDbBillNo || item.billNo;
        try {
          const { error } = await supabase
            .from('bills')
            .update({
              salesperson_name: item.finalSalesperson,
              updated_at: new Date().toISOString(),
            })
            .eq('bill_no', targetBillNo);

          if (error) {
            errors.push(`Bill ${targetBillNo}: ${error.message}`);
          } else {
            updatedCount++;
            // Prepare memory update
            const existing = localByBillNo.get(targetBillNo.toUpperCase());
            if (existing) {
              updatedBillsForMemory.push({
                ...existing,
                salespersonName: item.finalSalesperson,
              });
            }
          }
        } catch (e: any) {
          errors.push(`Bill ${targetBillNo}: ${e.message || String(e)}`);
        }
      })
    );

    const currentDone = Math.min(i + BATCH_SIZE, total);
    onProgress?.(currentDone, total, `${currentDone}/${total} bills updated in Supabase...`);
  }

  // Update in-memory store so UI updates immediately
  if (updatedBillsForMemory.length > 0) {
    mergeBillsInMemoryOnly(updatedBillsForMemory);
  }

  onProgress?.(total, total, `Finished! ${updatedCount} bills updated successfully.`);

  return {
    updatedCount,
    skippedCount: rows.length - total,
    notFoundCount: rows.filter(r => r.status === 'not_found_in_db').length,
    errors,
  };
}
