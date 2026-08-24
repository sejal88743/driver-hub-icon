import { Bill } from '@/lib/billStore';

interface TableRow {
  driverName: string;
  isFirstRowForDriver: boolean;
  beatName: string;
  billDate: string;
  count: number;
}

function isDateMatching(dt?: string, displayDate?: string, selectedDate?: string): boolean {
  if (!dt) return false;
  const clean = dt.trim();
  if (!clean) return false;
  if (clean === displayDate || clean === selectedDate) return true;
  const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (parts.length === 3) {
    let [p1, p2, p3] = parts;
    if (p1.length === 4) {
      const dmy = `${p3.padStart(2, '0')}/${p2.padStart(2, '0')}/${p1}`;
      return dmy === displayDate;
    } else {
      const dmy = `${p1.padStart(2, '0')}/${p2.padStart(2, '0')}/${p3}`;
      return dmy === displayDate;
    }
  }
  return false;
}

function formatToDDMMYYYY(dateStr?: string, fallback?: string): string {
  if (!dateStr || !dateStr.trim()) {
    return fallback ? formatToDDMMYYYY(fallback) : '';
  }
  const clean = dateStr.trim();
  const parts = clean.includes('/') ? clean.split('/') : clean.split('-');
  if (parts.length === 3) {
    let [p1, p2, p3] = parts;
    if (p1.length === 4) {
      // YYYY-MM-DD -> DD-MM-YYYY
      return `${p3.padStart(2, '0')}-${p2.padStart(2, '0')}-${p1}`;
    } else {
      if (p3.length === 2) p3 = '20' + p3;
      return `${p1.padStart(2, '0')}-${p2.padStart(2, '0')}-${p3}`;
    }
  }
  return clean;
}

function drawTablePage(
  rows: TableRow[],
  grandTotal: number | null,
  pageInfo?: { current: number; total: number }
): HTMLCanvasElement {
  const colWidths = [120, 240, 85, 55];
  const totalW = colWidths.reduce((a, b) => a + b, 0); // 500px
  const headerH = 22;
  const rowH = 19;
  const grandTotalH = grandTotal !== null ? 21 : 0;
  const pageFooterH = pageInfo && pageInfo.total > 1 ? 16 : 0;
  const totalH = headerH + rows.length * rowH + grandTotalH + pageFooterH;

  const scale = 2; // High-DPI 2x supersampling for crisp bold 9px text
  const canvas = document.createElement('canvas');
  canvas.width = totalW * scale;
  canvas.height = totalH * scale;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.scale(scale, scale);

  // Background white
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, totalW, totalH);

  // Header background
  ctx.fillStyle = '#EEF2F6';
  ctx.fillRect(0, 0, totalW, headerH);

  // Header bottom border
  ctx.strokeStyle = '#B6C4D4';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerH - 0.5);
  ctx.lineTo(totalW, headerH - 0.5);
  ctx.stroke();

  // Draw Header Columns
  const headers = ['HHT VAN', 'BEAT_NAME', 'Bill Date', 'Total'];
  let curX = 0;
  headers.forEach((h, colIdx) => {
    const w = colWidths[colIdx];

    // Vertical separator
    ctx.strokeStyle = '#C6D0DC';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    ctx.moveTo(curX + w - 0.5, 0);
    ctx.lineTo(curX + w - 0.5, headerH);
    ctx.stroke();

    // Header text: Bold 9px
    ctx.fillStyle = '#0F172A';
    ctx.font = 'bold 9px Arial, "Segoe UI", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(h, curX + 6, headerH / 2);

    // Excel dropdown filter icon button (small square with down arrow)
    const iconW = 10;
    const iconH = 11;
    const iconX = curX + w - iconW - 4;
    const iconY = (headerH - iconH) / 2;

    ctx.fillStyle = '#E2E9F2';
    ctx.fillRect(iconX, iconY, iconW, iconH);
    ctx.strokeStyle = '#ADC0D5';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(iconX + 0.5, iconY + 0.5, iconW - 1, iconH - 1);

    // Small down triangle
    ctx.fillStyle = '#475569';
    ctx.beginPath();
    ctx.moveTo(iconX + 2.5, iconY + 4);
    ctx.lineTo(iconX + 7.5, iconY + 4);
    ctx.lineTo(iconX + 5, iconY + 7.5);
    ctx.closePath();
    ctx.fill();

    curX += w;
  });

  // Draw Data Rows
  let curY = headerH;
  rows.forEach((r) => {
    // Row background (white)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, curY, totalW, rowH);

    // Row bottom grid line
    ctx.strokeStyle = '#D1D5DB';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.moveTo(0, curY + rowH - 0.5);
    ctx.lineTo(totalW, curY + rowH - 0.5);
    ctx.stroke();

    // Vertical column lines
    let xOffset = 0;
    colWidths.forEach((w) => {
      ctx.strokeStyle = '#D1D5DB';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(xOffset + w - 0.5, curY);
      ctx.lineTo(xOffset + w - 0.5, curY + rowH);
      ctx.stroke();
      xOffset += w;
    });

    ctx.font = 'bold 9px Arial, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';

    // Col 0: HHT VAN (Driver Name)
    if (r.isFirstRowForDriver && r.driverName) {
      // Draw minus square icon [-]
      const boxSize = 8;
      const boxX = 4;
      const boxY = curY + (rowH - boxSize) / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(boxX, boxY, boxSize, boxSize);
      ctx.strokeStyle = '#94A3B8';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(boxX + 0.5, boxY + 0.5, boxSize - 1, boxSize - 1);

      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(boxX + 2, boxY + boxSize / 2);
      ctx.lineTo(boxX + boxSize - 2, boxY + boxSize / 2);
      ctx.stroke();

      // Driver Name text
      ctx.fillStyle = '#000000';
      ctx.textAlign = 'left';
      ctx.fillText(r.driverName.toUpperCase(), boxX + boxSize + 4, curY + rowH / 2);
    }

    // Col 1: BEAT_NAME
    const col1X = colWidths[0];
    const beatBoxSize = 8;
    const beatBoxX = col1X + 4;
    const beatBoxY = curY + (rowH - beatBoxSize) / 2;
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(beatBoxX, beatBoxY, beatBoxSize, beatBoxSize);
    ctx.strokeStyle = '#94A3B8';
    ctx.lineWidth = 0.8;
    ctx.strokeRect(beatBoxX + 0.5, beatBoxY + 0.5, beatBoxSize - 1, beatBoxSize - 1);

    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(beatBoxX + 2, beatBoxY + beatBoxSize / 2);
    ctx.lineTo(beatBoxX + beatBoxSize - 2, beatBoxY + beatBoxSize / 2);
    ctx.stroke();

    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.fillText(r.beatName.toUpperCase(), beatBoxX + beatBoxSize + 4, curY + rowH / 2);

    // Col 2: Bill Date
    const col2X = colWidths[0] + colWidths[1];
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'left';
    ctx.fillText(r.billDate, col2X + 6, curY + rowH / 2);

    // Col 3: Total (count)
    const col3X = colWidths[0] + colWidths[1] + colWidths[2];
    ctx.fillStyle = '#000000';
    ctx.textAlign = 'right';
    ctx.fillText(String(r.count), col3X + colWidths[3] - 6, curY + rowH / 2);

    curY += rowH;
  });

  // Draw Grand Total Row if on final page
  if (grandTotal !== null) {
    ctx.fillStyle = '#DCE6F5';
    ctx.fillRect(0, curY, totalW, grandTotalH);

    ctx.strokeStyle = '#ADC0D5';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, curY + 0.5);
    ctx.lineTo(totalW, curY + 0.5);
    ctx.moveTo(0, curY + grandTotalH - 0.5);
    ctx.lineTo(totalW, curY + grandTotalH - 0.5);
    ctx.stroke();

    // Col separators
    let xOffset = 0;
    colWidths.forEach((w) => {
      ctx.strokeStyle = '#ADC0D5';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(xOffset + w - 0.5, curY);
      ctx.lineTo(xOffset + w - 0.5, curY + grandTotalH);
      ctx.stroke();
      xOffset += w;
    });

    ctx.font = 'bold 9.5px Arial, "Segoe UI", sans-serif';
    ctx.fillStyle = '#000000';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Grand Total', 6, curY + grandTotalH / 2);

    ctx.textAlign = 'right';
    ctx.fillText(String(grandTotal), totalW - 6, curY + grandTotalH / 2);

    curY += grandTotalH;
  }

  // Draw Page Footer if multi-page
  if (pageInfo && pageInfo.total > 1) {
    ctx.fillStyle = '#F8FAFC';
    ctx.fillRect(0, curY, totalW, pageFooterH);
    ctx.font = 'bold 8px Arial, sans-serif';
    ctx.fillStyle = '#64748B';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Part ${pageInfo.current} of ${pageInfo.total}`, totalW / 2, curY + pageFooterH / 2);
  }

  // Blue Right Border on Total Column (Excel Selection Look from sample)
  ctx.strokeStyle = '#1D4ED8';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(totalW - 1, 0);
  ctx.lineTo(totalW - 1, totalH);
  ctx.stroke();

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

export async function generateDriverAssignmentImages(
  bills: Bill[],
  displayDate: string,
  selectedDate: string
): Promise<{ success: boolean; imageCount: number; message?: string }> {
  // Filter assigned bills for selected displayDate
  const activeBills = bills.filter(
    (b) =>
      b.driverName &&
      b.driverName.trim() !== '' &&
      (isDateMatching(b.deliveryDate, displayDate, selectedDate) ||
        isDateMatching(b.date, displayDate, selectedDate))
  );

  if (activeBills.length === 0) {
    return {
      success: false,
      imageCount: 0,
      message: `Selected date (${displayDate}) par koi assigned driver bills nahi mile.`
    };
  }

  // Group by driverName -> Map of (beatName + '____' + billDate) -> count
  const driverMap = new Map<string, Map<string, { beatName: string; billDate: string; count: number }>>();

  activeBills.forEach((b) => {
    const driver = (b.driverName || 'UNASSIGNED').trim();
    const beat = (b.beatName || 'UNASSIGNED').trim();
    const dateFormatted = formatToDDMMYYYY(b.date, b.deliveryDate || displayDate);

    const driverKey = driver.toLowerCase();
    if (!driverMap.has(driverKey)) {
      driverMap.set(driverKey, new Map());
    }
    const beatMap = driverMap.get(driverKey)!;

    const rowKey = `${beat.toLowerCase()}____${dateFormatted}`;
    const existing = beatMap.get(rowKey);
    if (existing) {
      existing.count += 1;
    } else {
      beatMap.set(rowKey, {
        beatName: beat,
        billDate: dateFormatted,
        count: 1
      });
    }
  });

  // Build sorted flat rows
  const allRows: TableRow[] = [];
  const sortedDriverKeys = Array.from(driverMap.keys()).sort((a, b) => a.localeCompare(b));

  sortedDriverKeys.forEach((driverKey) => {
    const beatMap = driverMap.get(driverKey)!;
    // Find canonical driver name
    const origDriverName =
      activeBills.find((b) => (b.driverName || '').trim().toLowerCase() === driverKey)?.driverName?.trim() ||
      driverKey.toUpperCase();

    const sortedRows = Array.from(beatMap.values()).sort((a, b) => {
      const cmpBeat = a.beatName.localeCompare(b.beatName);
      if (cmpBeat !== 0) return cmpBeat;
      return a.billDate.localeCompare(b.billDate);
    });

    sortedRows.forEach((rowItem, idx) => {
      allRows.push({
        driverName: idx === 0 ? origDriverName : '',
        isFirstRowForDriver: idx === 0,
        beatName: rowItem.beatName,
        billDate: rowItem.billDate,
        count: rowItem.count
      });
    });
  });

  const grandTotal = allRows.reduce((sum, r) => sum + r.count, 0);
  const safeDate = displayDate.replace(/\//g, '-');

  // If rows fit in 1 image (up to 55 rows)
  if (allRows.length <= 55) {
    const canvas = drawTablePage(allRows, grandTotal);
    downloadCanvas(canvas, `Driver_Assignment_${safeDate}.png`);
    return { success: true, imageCount: 1 };
  }

  // If > 55 rows, strictly split into maximum 2 images (Part 1 and Part 2)
  const splitIdx = Math.ceil(allRows.length / 2);
  const part1Rows = allRows.slice(0, splitIdx);
  const part2Rows = allRows.slice(splitIdx);

  // If Part 2 starts with a continuation row without driverName, populate driverName for clarity
  if (part2Rows.length > 0 && !part2Rows[0].isFirstRowForDriver) {
    // Find which driver this row belongs to from allRows
    let prevDriver = '';
    for (let i = splitIdx; i >= 0; i--) {
      if (allRows[i].driverName) {
        prevDriver = allRows[i].driverName;
        break;
      }
    }
    if (prevDriver) {
      part2Rows[0] = {
        ...part2Rows[0],
        driverName: prevDriver,
        isFirstRowForDriver: true
      };
    }
  }

  const canvas1 = drawTablePage(part1Rows, null, { current: 1, total: 2 });
  downloadCanvas(canvas1, `Driver_Assignment_${safeDate}_Part1.png`);

  await new Promise((resolve) => setTimeout(resolve, 400));

  const canvas2 = drawTablePage(part2Rows, grandTotal, { current: 2, total: 2 });
  downloadCanvas(canvas2, `Driver_Assignment_${safeDate}_Part2.png`);

  return { success: true, imageCount: 2 };
}
