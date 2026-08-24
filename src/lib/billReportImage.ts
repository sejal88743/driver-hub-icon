import { Bill } from '@/lib/billStore';

export interface BillReportItem {
  salesmanName: string;
  partyName: string;
  delDate: string;
  billAmt: number;
  driverName: string;
  billStatus: 'FBR' | 'CREDIT' | 'DEL PENDING' | 'LINE CUT';
}

export function getPreviousDateInfo(selDate: string, dispDate: string): { dmy: string; iso: string } {
  let dt: Date;
  if (selDate && selDate.includes('-')) {
    const [y, m, d] = selDate.split('-').map(Number);
    dt = new Date(y, m - 1, d);
  } else if (dispDate && dispDate.includes('/')) {
    const [d, m, y] = dispDate.split('/').map(Number);
    dt = new Date(y, m - 1, d);
  } else {
    dt = new Date();
  }
  dt.setDate(dt.getDate() - 1);
  const d = String(dt.getDate()).padStart(2, '0');
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const y = dt.getFullYear();
  return {
    dmy: `${d}/${m}/${y}`,
    iso: `${y}-${m}-${d}`
  };
}

export function isDeliveryDateMatch(val: string | undefined, targetDMY: string, targetISO: string): boolean {
  if (!val) return false;
  const clean = val.trim();
  if (!clean) return false;
  if (clean === targetDMY || clean === targetISO) return true;
  const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (parts.length === 3) {
    const [p1, p2, p3] = parts;
    if (p1.length === 4) {
      const dmy = `${p3.padStart(2, '0')}/${p2.padStart(2, '0')}/${p1}`;
      return dmy === targetDMY;
    } else {
      const yr = p3.length === 2 ? '20' + p3 : p3;
      const dmy = `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${yr}`;
      return dmy === targetDMY;
    }
  }
  return false;
}

export function filterBillReportItems(bills: Bill[], targetDMY: string, targetISO: string): BillReportItem[] {
  // STRICT: Only bills where DEL DATE (deliveryDate) matches target date (Selected Date - 1)
  const activeBills = bills.filter(b => isDeliveryDateMatch(b.deliveryDate, targetDMY, targetISO));

  const items: BillReportItem[] = [];

  activeBills.forEach(b => {
    const sp = (b.salespersonName || '-').trim();
    const party = (b.partyName || '-').trim();
    const driver = (b.driverName || '-').trim();
    const mode = (b.paymentMode || b.paymentMethod || '').toUpperCase().trim();
    const cancelLine = (b.cancelLine || '').toUpperCase().trim();
    const delStatus = (b.deliveryStatus || '').toUpperCase().trim();

    let lineCut = 0;
    if (typeof b.lineCutAmt === 'number' && !isNaN(b.lineCutAmt) && b.lineCutAmt > 0) {
      lineCut = b.lineCutAmt;
    } else if (b.collectedAmount && b.collectedAmount > 0 && b.billNetAmt > b.collectedAmount) {
      lineCut = b.billNetAmt - b.collectedAmount;
    }

    let amt = 0;
    if (typeof b.billNetAmt === 'number') {
      amt = isNaN(b.billNetAmt) ? 0 : b.billNetAmt;
    } else if (b.billNetAmt) {
      const parsed = parseFloat(String(b.billNetAmt).replace(/[^0-9.-]+/g, ''));
      amt = isNaN(parsed) ? 0 : parsed;
    }

    let status: 'FBR' | 'CREDIT' | 'DEL PENDING' | 'LINE CUT' | null = null;
    if (mode === 'FBR' || mode === 'CANCEL' || cancelLine === 'FBR' || cancelLine === 'CANCEL') {
      status = 'FBR';
    } else if (mode === 'CREDIT') {
      status = 'CREDIT';
    } else if (mode === 'DEL PENDING' || mode === 'DELIVERY PENDING' || mode === 'PENDING' || delStatus === 'PENDING' || delStatus === 'DEL PENDING') {
      status = 'DEL PENDING';
    } else if (lineCut > 0) {
      status = 'LINE CUT';
    }

    if (!status) return;

    items.push({
      salesmanName: sp,
      partyName: party,
      delDate: targetDMY,
      billAmt: amt,
      driverName: driver,
      billStatus: status
    });
  });

  items.sort((a, b) => {
    const spCmp = a.salesmanName.localeCompare(b.salesmanName);
    if (spCmp !== 0) return spCmp;
    return a.partyName.localeCompare(b.partyName);
  });

  return items;
}

export function getStatusColorInfo(status: 'FBR' | 'CREDIT' | 'DEL PENDING' | 'LINE CUT') {
  switch (status) {
    case 'FBR':
      return {
        bg: '#FEE2E2', // RED
        pdfBg: [254, 226, 226] as [number, number, number],
        text: '#000000'
      };
    case 'CREDIT':
      return {
        bg: '#DCFCE7', // GREEN
        pdfBg: [220, 252, 231] as [number, number, number],
        text: '#000000'
      };
    case 'DEL PENDING':
      return {
        bg: '#FEF9C3', // YELLOW
        pdfBg: [254, 249, 195] as [number, number, number],
        text: '#000000'
      };
    case 'LINE CUT':
      return {
        bg: '#DBEAFE', // BLUE
        pdfBg: [219, 234, 254] as [number, number, number],
        text: '#000000'
      };
  }
}

function drawBillReportCanvas(
  items: BillReportItem[],
  targetDMY: string,
  pageNumber: number,
  totalPages: number,
  isLastPage: boolean,
  grandTotalAmt: number,
  totalItemsCount: number
): HTMLCanvasElement {
  const scale = 2; // 2x supersampling for crisp 9px font
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const headerH = 34;
  const colHeaderH = 22;
  const rowH = 18;
  const totalRowH = isLastPage ? 20 : 0;
  const paddingX = 14;
  const bottomPad = 14;

  const rowCount = items.length;
  const totalLogicalH = headerH + colHeaderH + (rowCount * rowH) + totalRowH + bottomPad;

  // Column widths:
  // SALESMAN NAME (160), PARTY NAME (260), DEL DATE (100), BILL AMT (100), DRIVER NAME (140), BILL STATUS (110)
  const colWidths = [160, 260, 100, 100, 140, 110];
  const tableWidth = colWidths.reduce((a, b) => a + b, 0); // 870
  const logicalW = tableWidth + (paddingX * 2); // 898

  canvas.width = Math.round(logicalW * scale);
  canvas.height = Math.round(totalLogicalH * scale);

  ctx.scale(scale, scale);

  // Background
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, logicalW, totalLogicalH);

  // Header Title: "<DATE> BILL REPORTS" in 12px RED BOLD
  ctx.fillStyle = '#DC2626';
  ctx.font = 'bold 12px Arial, "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  let titleText = `${targetDMY} BILL REPORTS`;
  if (totalPages > 1) {
    titleText += `  (Part ${pageNumber} of ${totalPages})`;
  }
  ctx.fillText(titleText, paddingX, 18);

  let curY = headerH;
  const startX = paddingX;

  // Draw Column Headers
  const colTitles = ['SALEMAN NAME', 'PARTY NAME', 'DEL DATE', 'BILL AMT', 'DRIVER NAME', 'BILL STATUS'];
  ctx.fillStyle = '#F0F3F6';
  ctx.fillRect(startX, curY, tableWidth, colHeaderH);

  // Column Header text
  ctx.font = 'bold 9px Arial, "Segoe UI", sans-serif';
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'middle';

  let curX = startX;
  colTitles.forEach((t, i) => {
    const w = colWidths[i];
    if (i === 2 || i === 5) {
      ctx.textAlign = 'center';
      ctx.fillText(t, curX + w / 2, curY + colHeaderH / 2);
    } else if (i === 3) {
      ctx.textAlign = 'right';
      ctx.fillText(t, curX + w - 6, curY + colHeaderH / 2);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(t, curX + 6, curY + colHeaderH / 2);
    }
    curX += w;
  });

  // Header border
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 1;
  ctx.strokeRect(startX, curY, tableWidth, colHeaderH);

  curY += colHeaderH;

  // Draw Rows
  items.forEach((item) => {
    const colorInfo = getStatusColorInfo(item.billStatus);
    ctx.fillStyle = colorInfo.bg;
    ctx.fillRect(startX, curY, tableWidth, rowH);

    ctx.font = 'bold 9px Arial, "Segoe UI", sans-serif';
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';

    let rX = startX;

    // 0: Salesman Name
    ctx.textAlign = 'left';
    ctx.fillText(item.salesmanName, rX + 6, curY + rowH / 2);
    rX += colWidths[0];

    // 1: Party Name
    ctx.textAlign = 'left';
    // Truncate party name if too long
    const pName = item.partyName.length > 36 ? item.partyName.substring(0, 34) + '...' : item.partyName;
    ctx.fillText(pName, rX + 6, curY + rowH / 2);
    rX += colWidths[1];

    // 2: Del Date
    ctx.textAlign = 'center';
    ctx.fillText(item.delDate, rX + colWidths[2] / 2, curY + rowH / 2);
    rX += colWidths[2];

    // 3: Bill Amt
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(item.billAmt).toLocaleString('en-IN'), rX + colWidths[3] - 6, curY + rowH / 2);
    rX += colWidths[3];

    // 4: Driver Name
    ctx.textAlign = 'left';
    ctx.fillText(item.driverName, rX + 6, curY + rowH / 2);
    rX += colWidths[4];

    // 5: Bill Status
    ctx.textAlign = 'center';
    ctx.fillText(item.billStatus, rX + colWidths[5] / 2, curY + rowH / 2);

    // Row bottom border
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(startX, curY + rowH);
    ctx.lineTo(startX + tableWidth, curY + rowH);
    ctx.stroke();

    curY += rowH;
  });

  // Total Row if last page
  if (isLastPage) {
    ctx.fillStyle = '#E2E8F0';
    ctx.fillRect(startX, curY, tableWidth, totalRowH);

    ctx.font = 'bold 9px Arial, "Segoe UI", sans-serif';
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';

    // TOTAL label
    ctx.textAlign = 'left';
    ctx.fillText('TOTAL', startX + 6, curY + totalRowH / 2);

    // Bill count in party column
    ctx.fillText(`${totalItemsCount} BILLS`, startX + colWidths[0] + 6, curY + totalRowH / 2);

    // Total Amount
    const amtX = startX + colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3];
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(grandTotalAmt).toLocaleString('en-IN'), amtX - 6, curY + totalRowH / 2);

    // Total row bottom border
    ctx.strokeStyle = '#CBD5E1';
    ctx.lineWidth = 1;
    ctx.strokeRect(startX, curY, tableWidth, totalRowH);

    curY += totalRowH;
  }

  // Draw Vertical Column Dividers for entire table
  const totalTableH = curY - headerH;
  let lineX = startX;
  ctx.strokeStyle = '#D1D5DB';
  ctx.lineWidth = 1;

  // Leftmost line
  ctx.beginPath();
  ctx.moveTo(startX, headerH);
  ctx.lineTo(startX, curY);
  ctx.stroke();

  colWidths.forEach(w => {
    lineX += w;
    ctx.beginPath();
    ctx.moveTo(lineX, headerH);
    ctx.lineTo(lineX, curY);
    ctx.stroke();
  });

  return canvas;
}

function downloadCanvas(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement('a');
  link.download = filename;
  link.href = canvas.toDataURL('image/png');
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

export async function generateBillReportImages(
  bills: Bill[],
  displayDate: string,
  selectedDate: string
): Promise<{ success: boolean; message?: string }> {
  const { dmy: targetDMY, iso: targetISO } = getPreviousDateInfo(selectedDate, displayDate);
  const items = filterBillReportItems(bills, targetDMY, targetISO);

  if (items.length === 0) {
    return {
      success: false,
      message: `No FBR / CREDIT / DEL PENDING / LINE CUT bills found for date: ${targetDMY}`
    };
  }

  const grandTotalAmt = items.reduce((sum, item) => sum + item.billAmt, 0);
  const totalItemsCount = items.length;

  const MAX_PER_IMAGE = 55;

  if (items.length <= MAX_PER_IMAGE) {
    const canvas = drawBillReportCanvas(items, targetDMY, 1, 1, true, grandTotalAmt, totalItemsCount);
    downloadCanvas(canvas, `${targetDMY.replace(/\//g, '-')}_BILL_REPORTS.png`);
  } else {
    // Split into strictly max 2 images
    const splitIndex = Math.ceil(items.length / 2);
    const page1Items = items.slice(0, splitIndex);
    const page2Items = items.slice(splitIndex);

    const canvas1 = drawBillReportCanvas(page1Items, targetDMY, 1, 2, false, grandTotalAmt, totalItemsCount);
    downloadCanvas(canvas1, `${targetDMY.replace(/\//g, '-')}_BILL_REPORTS_Part1.png`);

    await new Promise(r => setTimeout(r, 300));

    const canvas2 = drawBillReportCanvas(page2Items, targetDMY, 2, 2, true, grandTotalAmt, totalItemsCount);
    downloadCanvas(canvas2, `${targetDMY.replace(/\//g, '-')}_BILL_REPORTS_Part2.png`);
  }

  return { success: true };
}
