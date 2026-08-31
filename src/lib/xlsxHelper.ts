import type * as XLSXType from 'xlsx';

/**
 * Normalizes ZIP buffers where bit 3 (data descriptor) is set or local headers have 0 sizes (streaming ZIPs from ERPs/Tally/SAP/Python/Java).
 * Copies actual CRC32, compressedSize, and uncompressedSize from Central Directory into Local File Headers
 * and clears bit 3 in general purpose bit flag so SheetJS / JSZip never throws "Bad uncompressed size" or "Bad compressed size".
 */
export function fixZipBuffer(buf: ArrayBuffer | Uint8Array): Uint8Array {
  const u8 = buf instanceof Uint8Array 
    ? new Uint8Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    : new Uint8Array(buf.slice(0));
    
  if (u8.length < 22) return u8;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  
  // Check PK\x03\x04
  if (dv.getUint32(0, true) !== 0x04034b50) return u8;

  // Search backwards for End of Central Directory (0x06054b50)
  let eocd = -1;
  const maxSearch = Math.min(u8.length - 22, 65535 + 22);
  for (let i = u8.length - 22; i >= u8.length - 22 - maxSearch && i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return u8;

  const cdOffset = dv.getUint32(eocd + 16, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  if (cdOffset + cdSize > u8.length) return u8;

  let p = cdOffset;
  while (p < cdOffset + cdSize && p + 46 <= u8.length) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const crc = dv.getUint32(p + 16, true);
    const csz = dv.getUint32(p + 20, true);
    const usz = dv.getUint32(p + 24, true);
    const fnLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const localOffset = dv.getUint32(p + 42, true);

    if (localOffset + 30 <= u8.length && dv.getUint32(localOffset, true) === 0x04034b50) {
      const flags = dv.getUint16(localOffset + 6, true);
      // Clear bit 3 flag and inject correct metadata from central directory
      dv.setUint16(localOffset + 6, flags & ~8, true);
      dv.setUint32(localOffset + 14, crc, true);
      dv.setUint32(localOffset + 18, csz, true);
      dv.setUint32(localOffset + 22, usz, true);
    }

    p += 46 + fnLen + extraLen + commentLen;
  }
  return u8;
}

/**
 * Safely reads an Excel / CSV / XLS / XLSX file buffer using SheetJS, automatically fixing streaming zip headers and handling errors.
 */
export function safeReadWorkbook(XLSX: typeof XLSXType, data: ArrayBuffer | Uint8Array, options: XLSXType.ParsingOptions = {}): XLSXType.WorkBook {
  const fixed = fixZipBuffer(data);
  try {
    return XLSX.read(fixed, { type: 'array', ...options });
  } catch (err: any) {
    // If array type failed, try original buffer or fallback to binary string
    try {
      return XLSX.read(data, { type: 'array', ...options });
    } catch {
      const bytes = new Uint8Array(data);
      let binary = '';
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      return XLSX.read(binary, { type: 'binary', ...options });
    }
  }
}
