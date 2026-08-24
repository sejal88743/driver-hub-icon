/**
 * Utility module for Party Name and Salesperson Name cleaning, deduplication,
 * and 70%+ similarity merging.
 */

import type { Bill } from './billStore';

// ── Clean Salesperson Name ───────────────────────────────────────────────────
export function cleanSalespersonName(name: string): string {
  if (!name) return '';
  let s = String(name).trim();
  if (!s) return '';
  // Strip code prefixes like "SMN00017 - ", "SM01 -", "SALES01 -"
  s = s.replace(/^[A-Z0-9_-]{2,15}\s*[-:_]\s*/i, '').trim();
  // Strip code suffixes like " - SMN00017"
  s = s.replace(/\s*[-:_]\s*[A-Z0-9_-]{2,15}$/i, '').trim();
  // Normalize internal whitespace
  s = s.replace(/\s+/g, ' ');
  return s;
}

// ── Clean Party Name ─────────────────────────────────────────────────────────
export function cleanPartyName(name: string): string {
  if (!name) return '';
  let s = String(name).trim();
  if (!s) return '';
  // Strip GST or code prefixes like "GSTIN123 - ", "C00123 - ", "HUL123 - "
  s = s.replace(/^(GST[0-9A-Z]*|[A-Z0-9_-]{2,15})\s*[-:_]\s*/i, '').trim();
  // Strip code suffixes
  s = s.replace(/\s*[-:_]\s*[A-Z0-9_-]{2,15}$/i, '').trim();
  // Normalize internal whitespace
  s = s.replace(/\s+/g, ' ');
  return s;
}

// ── Levenshtein Distance Algorithm ───────────────────────────────────────────
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

// ── Calculate String Similarity (0.0 to 1.0) ─────────────────────────────────
export function calculateSimilarity(str1: string, str2: string): number {
  if (!str1 || !str2) return 0;
  
  const norm1 = str1.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');
  const norm2 = str2.trim().toUpperCase().replace(/[^A-Z0-9\s]/g, '');

  if (norm1 === norm2) return 1.0;
  if (!norm1 || !norm2) return 0;

  // Token set similarity
  const words1 = new Set(norm1.split(/\s+/).filter(w => w.length > 0));
  const words2 = new Set(norm2.split(/\s+/).filter(w => w.length > 0));

  let commonCount = 0;
  for (const w of words1) {
    if (words2.has(w)) commonCount++;
  }

  const tokenDice = (2 * commonCount) / (words1.size + words2.size);

  // Character Levenshtein similarity
  const maxLen = Math.max(norm1.length, norm2.length);
  const dist = levenshteinDistance(norm1, norm2);
  const levSim = maxLen > 0 ? 1 - dist / maxLen : 0;

  // Substring or prefix match bonus
  let subBonus = 0;
  if (norm1.length >= 4 && norm2.length >= 4) {
    if (norm1.includes(norm2) || norm2.includes(norm1)) {
      subBonus = 0.85;
    }
  }

  return Math.max(levSim, tokenDice, subBonus);
}

// ── Is Similar Check (default 70% threshold) ─────────────────────────────────
export function isSimilar(str1: string, str2: string, threshold = 0.70): boolean {
  return calculateSimilarity(str1, str2) >= threshold;
}

// ── Find Best Match from List ────────────────────────────────────────────────
export function findCanonicalName(
  rawName: string,
  existingNames: string[],
  cleanFn: (s: string) => string = cleanPartyName,
  threshold = 0.70
): string {
  const cleaned = cleanFn(rawName);
  if (!cleaned) return '';

  const cleanUpper = cleaned.toUpperCase();

  // 1. Exact case-insensitive match
  const exactMatch = existingNames.find(
    n => cleanFn(n).toUpperCase() === cleanUpper
  );
  if (exactMatch) return cleanFn(exactMatch);

  // 2. 70%+ Similarity match
  let bestMatch = '';
  let highestScore = 0;

  for (const existing of existingNames) {
    const existingClean = cleanFn(existing);
    if (!existingClean) continue;
    const score = calculateSimilarity(cleaned, existingClean);
    if (score >= threshold && score > highestScore) {
      highestScore = score;
      bestMatch = existingClean;
    }
  }

  return bestMatch ? bestMatch : cleaned;
}

// ── Build Canonical Group Mapping ────────────────────────────────────────────
export function buildCanonicalMap(
  rawNames: string[],
  cleanFn: (s: string) => string,
  threshold = 0.70
): Map<string, string> {
  const cleanedSet = new Set<string>();
  for (const n of rawNames) {
    if (!n) continue;
    const c = cleanFn(n);
    if (c) cleanedSet.add(c);
  }
  const cleanedNames = Array.from(cleanedSet);

  // Sort by length descending so longer/more complete names are preferred as canonical
  cleanedNames.sort((a, b) => b.length - a.length);

  const canonicalMap = new Map<string, string>();
  const normToCanonical = new Map<string, string>();
  const distinctCanonicals: Array<{ name: string; norm: string }> = [];

  for (const name of cleanedNames) {
    const norm = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!norm) continue;

    // 1. Fast O(1) exact normalized match
    if (normToCanonical.has(norm)) {
      canonicalMap.set(name, normToCanonical.get(norm)!);
      continue;
    }

    // 2. Fuzzy match against distinct canonicals with early-exit guards
    let matchedCanonical = '';
    let bestScore = 0;

    for (const item of distinctCanonicals) {
      const maxLen = Math.max(norm.length, item.norm.length);
      const lenDiff = Math.abs(norm.length - item.norm.length);

      // Early exit if length difference ratio exceeds 30% threshold
      if (maxLen > 0 && lenDiff / maxLen > 0.30) continue;

      const score = calculateSimilarity(name, item.name);
      if (score >= threshold && score > bestScore) {
        bestScore = score;
        matchedCanonical = item.name;
      }
    }

    if (matchedCanonical) {
      canonicalMap.set(name, matchedCanonical);
      normToCanonical.set(norm, matchedCanonical);
    } else {
      distinctCanonicals.push({ name, norm });
      canonicalMap.set(name, name);
      normToCanonical.set(norm, name);
    }
  }

  return canonicalMap;
}

// ── Standardize & Deduplicate All Bills ──────────────────────────────────────
export function standardizeBills(
  bills: Bill[],
  threshold = 0.70
): {
  updatedBills: Bill[];
  mergedPartiesCount: number;
  mergedSPCount: number;
} {
  const rawParties = bills.map(b => b.partyName).filter(Boolean);
  const rawSPs = bills.map(b => b.salespersonName).filter(Boolean);

  const partyMap = buildCanonicalMap(rawParties, cleanPartyName, threshold);
  const spMap = buildCanonicalMap(rawSPs, cleanSalespersonName, threshold);

  let mergedPartiesCount = 0;
  let mergedSPCount = 0;

  const updatedBills = bills.map(bill => {
    let updated = false;
    let newParty = bill.partyName;
    let newSP = bill.salespersonName;

    if (bill.partyName) {
      const cleaned = cleanPartyName(bill.partyName);
      const canonical = partyMap.get(cleaned) || cleaned;
      if (canonical !== bill.partyName) {
        newParty = canonical;
        updated = true;
        mergedPartiesCount++;
      }
    }

    if (bill.salespersonName) {
      const cleaned = cleanSalespersonName(bill.salespersonName);
      const canonical = spMap.get(cleaned) || cleaned;
      if (canonical !== bill.salespersonName) {
        newSP = canonical;
        updated = true;
        mergedSPCount++;
      }
    }

    if (!updated) return bill;

    return {
      ...bill,
      partyName: newParty,
      salespersonName: newSP,
    };
  });

  return { updatedBills, mergedPartiesCount, mergedSPCount };
}
