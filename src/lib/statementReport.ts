import type { Bill } from '@/lib/billStore';
import { getDisplayBillNo } from '@/lib/commissionMoc';

function stripGST(bn: string) {
  return (bn || '').replace(/^GST[-_]/i, '').trim();
}

function normalizeBillDate(v?: string): string {
  if (!v) return '';
  const raw = v.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('-');
    return `${d}/${m}/${y}`;
  }
  if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) return raw.replace(/-/g, '/');
  if (/^\d{4}\/\d{2}\/\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split('/');
    return `${d}/${m}/${y}`;
  }
  return raw;
}

export function getEffAmt(b: Bill) {
  const ca = Number(b.cashAmount) || 0;
  const up = Number(b.upiAmount) || 0;
  const ch = Number(b.chequeAmount) || 0;
  const col = Number(b.collectedAmount) || 0;
  if (ca === 0 && up === 0 && ch === 0 && col > 0) {
    const m = (b.paymentMode || '').toLowerCase();
    if (m === 'upi') return { cash: 0, upi: col, chq: 0 };
    if (m === 'cheque') return { cash: 0, upi: 0, chq: col };
    return { cash: col, upi: 0, chq: 0 };
  }
  return { cash: ca, upi: up, chq: ch };
}

export type BankStatementItem = {
  bill: Bill;
  billNo: string;
  billDate: string;
  partyName: string;
  salespersonName: string;
  driverName: string;
  billNetAmt: number;
  lineCut: number;
  recAmt: number;
  status: string;
  mode: 'GPAY' | 'CHEQUE';
  chequeNo: string;
  bankName: string;
  recDate: string;
  groupKey: string;
};

export type BankStatementGroup = {
  groupKey: string;
  mode: 'GPAY' | 'CHEQUE';
  recDate: string;
  chequeNo: string;
  bankName: string;
  partyName: string;
  totalBankAmount: number;
  items: BankStatementItem[];
};

/**
 * Builds the dedicated "Statement" worksheet for 1-to-1 matching with Bank Statements.
 *
 * Requirements:
 * 1. For multi-bill payments (GPay or Cheque), columns 0 to 7 are MERGED.
 *    - The "STATEMENT / BANK AMOUNT (₹)" cell is merged across all bills in that payment,
 *      showing the single consolidated deposit amount that appears in the Bank Statement!
 * 2. Each bill is shown in its own row with its individual "BILL REC AMT (₹)",
 *    "BILL NET AMT", "LINE CUT", and "BILL NO" for instant single-bill breakdown.
 * 3. Reconciles both GPay / UPI and Cheque transactions with summary at bottom.
 */
export function buildStatementWorksheet(XLSX: any, billsList: Bill[]) {
  const bankItems: BankStatementItem[] = [];

  for (const b of billsList) {
    const eff = getEffAmt(b);
    const lineCut = (b.lineCutAmt || 0) || Number(b.cancelLine) || 0;
    const billNet = Number(b.billNetAmt || 0);
    const cleanBn = stripGST(getDisplayBillNo(b));
    const recDate = normalizeBillDate(b.paymentDate) || normalizeBillDate(b.deliveryDate) || normalizeBillDate(b.date) || '-';
    const isFbr = b.paymentMode === 'FBR' || b.paymentMode === 'Cancel';
    const isCredit = b.paymentMode === 'Credit';
    const isDelPend = b.paymentMode === 'Del Pending';
    const status = isFbr ? 'FBR' : isCredit ? 'CREDIT' : isDelPend ? 'DEL PEND' : ((b.collectedAmount || 0) > 0 ? 'PAID' : 'UNPAID');

    // 1. GPay / UPI transaction
    if (eff.upi > 0 || (b.paymentMode || '').toLowerCase() === 'upi') {
      const upiAmt = eff.upi > 0 ? eff.upi : (b.collectedAmount || 0);
      if (upiAmt > 0) {
        let gKey = '';
        const nb = (b.nextBillNo || '').trim();
        if (nb.startsWith('GPAY:')) {
          gKey = nb;
        } else if (nb.includes('+')) {
          gKey = `GPAY:${nb}`;
        } else {
          const pName = (b.partyName || '').trim().toLowerCase();
          const rDate = recDate.trim();
          const pTime = (b.paymentTime || '').trim();
          if (pTime && pTime !== '—') {
            gKey = `GPAY_${pName}_${rDate}_${pTime}`;
          } else {
            gKey = `GPAY_SINGLE_${b.id || cleanBn}`;
          }
        }

        bankItems.push({
          bill: b,
          billNo: cleanBn,
          billDate: normalizeBillDate(b.date) || '-',
          partyName: b.partyName || '-',
          salespersonName: b.salespersonName || '',
          driverName: b.driverName || '-',
          billNetAmt: billNet,
          lineCut,
          recAmt: upiAmt,
          status,
          mode: 'GPAY',
          chequeNo: '-',
          bankName: b.bankName || '-',
          recDate,
          groupKey: gKey,
        });
      }
    }

    // 2. Cheque transaction
    if (eff.chq > 0 || (b.paymentMode || '').toLowerCase() === 'cheque' || (b.chequeNo && b.chequeNo.trim().length > 0)) {
      const chqAmt = eff.chq > 0 ? eff.chq : (b.collectedAmount || 0);
      if (chqAmt > 0) {
        const chqNo = (b.chequeNo || '').trim();
        const nb = (b.nextBillNo || '').trim();
        let gKey = '';
        if (chqNo) {
          gKey = `CHQ_${chqNo.toUpperCase()}`;
        } else if (nb.startsWith('CHQ:')) {
          gKey = nb;
        } else if (nb.includes('+')) {
          gKey = `CHQ:${nb}`;
        } else {
          gKey = `CHQ_SINGLE_${b.id || cleanBn}`;
        }

        bankItems.push({
          bill: b,
          billNo: cleanBn,
          billDate: normalizeBillDate(b.date) || '-',
          partyName: b.partyName || '-',
          salespersonName: b.salespersonName || '',
          driverName: b.driverName || '-',
          billNetAmt: billNet,
          lineCut,
          recAmt: chqAmt,
          status,
          mode: 'CHEQUE',
          chequeNo: chqNo || '-',
          bankName: b.bankName || '-',
          recDate,
          groupKey: gKey,
        });
      }
    }
  }

  // Group items by transaction key
  const groupsMap = new Map<string, BankStatementGroup>();
  for (const item of bankItems) {
    let grp = groupsMap.get(item.groupKey);
    if (!grp) {
      grp = {
        groupKey: item.groupKey,
        mode: item.mode,
        recDate: item.recDate,
        chequeNo: item.chequeNo,
        bankName: item.bankName,
        partyName: item.partyName,
        totalBankAmount: 0,
        items: [],
      };
      groupsMap.set(item.groupKey, grp);
    }
    grp.totalBankAmount += item.recAmt;
    grp.items.push(item);
    if (item.chequeNo && item.chequeNo !== '-') grp.chequeNo = item.chequeNo;
    if (item.bankName && item.bankName !== '-') grp.bankName = item.bankName;
  }

  const groupsList = Array.from(groupsMap.values());
  // Sort: Multi-bill payments first (highest bill count on top), then by date
  groupsList.sort((a, b) => {
    if (a.items.length !== b.items.length) {
      return b.items.length - a.items.length;
    }
    return (a.recDate || '').localeCompare(b.recDate || '');
  });

  const headers = [
    '#',
    'REC DATE',
    'PAYMENT MODE',
    'CHQ / REF NO',
    'RETAILER BANK',
    'PARTY NAME',
    'BILLS IN PAYMENT',
    'STATEMENT / BANK AMOUNT (₹)',
    'BILL NO',
    'BILL DATE',
    'BILL NET AMT (₹)',
    'LINE CUT (₹)',
    'BILL REC AMT (₹)',
    'STATUS',
    'SALESPERSON',
    'DRIVER',
  ];

  const aoa: any[][] = [headers];
  const merges: any[] = [];

  let grandBankTotal = 0;
  let totalGpayTotal = 0;
  let totalChequeTotal = 0;
  let multiBillGroupsCount = 0;
  let totalBillsInStatement = 0;

  groupsList.forEach((grp, gIdx) => {
    const startRow = aoa.length;
    const count = grp.items.length;
    const endRow = startRow + count - 1;

    grandBankTotal += grp.totalBankAmount;
    if (grp.mode === 'GPAY') totalGpayTotal += grp.totalBankAmount;
    if (grp.mode === 'CHEQUE') totalChequeTotal += grp.totalBankAmount;
    if (count > 1) multiBillGroupsCount++;
    totalBillsInStatement += count;

    const billsCountText = count > 1 ? `${count} Bills (Merged)` : '1 Bill';
    const uniqueParties = Array.from(new Set(grp.items.map(x => x.partyName))).join(' / ');

    grp.items.forEach((item, itemIdx) => {
      if (itemIdx === 0) {
        // Master row for group: contains merged statement amount and first bill
        aoa.push([
          gIdx + 1,
          grp.recDate,
          grp.mode,
          grp.chequeNo,
          grp.bankName,
          uniqueParties || grp.partyName,
          billsCountText,
          grp.totalBankAmount, // Number value for accurate Excel calculations
          item.billNo,
          item.billDate,
          item.billNetAmt,
          item.lineCut,
          item.recAmt, // Exact individual single amount for this bill!
          item.status,
          item.salespersonName || '',
          item.driverName || '',
        ]);
      } else {
        // Child rows: empty for merged columns 0-7, distinct for bill columns 8-15
        aoa.push([
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          '',
          item.billNo,
          item.billDate,
          item.billNetAmt,
          item.lineCut,
          item.recAmt, // Exact individual single amount for this bill!
          item.status,
          item.salespersonName || '',
          item.driverName || '',
        ]);
      }
    });

    // Merge columns 0 to 7 across all rows of this multi-bill payment
    if (count > 1) {
      for (let col = 0; col <= 7; col++) {
        merges.push({
          s: { r: startRow, c: col },
          e: { r: endRow, c: col },
        });
      }
    }
  });

  // Reconciliation summary
  aoa.push([]);
  aoa.push(['', '', '', '', '', '', 'BANK STATEMENT RECONCILIATION SUMMARY']);
  aoa.push(['', '', 'TOTAL GPAY / UPI DEPOSITS:', '', '', '', '', totalGpayTotal]);
  aoa.push(['', '', 'TOTAL CHEQUE DEPOSITS:', '', '', '', '', totalChequeTotal]);
  aoa.push(['', '', 'GRAND TOTAL BANK DEPOSITS:', '', '', `${multiBillGroupsCount} Multi-Bill Batches`, `${totalBillsInStatement} Bills Total`, grandBankTotal]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [7, 13, 15, 16, 22, 32, 18, 26, 15, 13, 16, 14, 18, 12, 18, 16].map((w: number) => ({ wch: w }));
  ws['!merges'] = merges;
  return ws;
}
