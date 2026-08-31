/**
 * Utility module for Party Name and Salesperson Name cleaning, deduplication,
 * and 70%+ similarity merging.
 */

import type { Bill } from './billStore';

// Caches for high-frequency operations to ensure ultra-fast processing without UI freeze
const spCleanCache = new Map<string, string>();
const partyCleanCache = new Map<string, string>();
const similarityCache = new Map<string, number>();

// ── Clean Salesperson Name ───────────────────────────────────────────────────
export function cleanSalespersonName(name: string): string {
  if (!name) return '';
  const rawKey = String(name);
  const cached = spCleanCache.get(rawKey);
  if (cached !== undefined) return cached;

  let s = rawKey.trim();
  if (!s) {
    spCleanCache.set(rawKey, '');
    return '';
  }

  // Strip code prefixes like "SMN00017 - ", "SM01 -", "SALES01 -"
  s = s.replace(/^[A-Z0-9_-]{2,15}\s*[-:_]\s*/i, '').trim();

  // Strip code suffixes like " - SMN00017"
  s = s.replace(/\s*[-:_]\s*[A-Z0-9_-]{2,15}$/i, '').trim();

  // Repeatedly strip role/designation suffixes like (ME), TL, (TL), (FL), FL, ME, etc.
  let prev = '';
  while (prev !== s) {
    prev = s;
    // 1. Parenthetical / bracketed suffixes anywhere at end: (ME), [TL], (FL), (T.L.), (M.E.), (F.L.), etc.
    s = s.replace(/\s*[\(\[\{]\s*(?:ME|TL|FL|M\.E\.|T\.L\.|F\.L\.|M\.E|T\.L|F\.L|SR|JR)\s*[\)\]\}]\s*$/i, '').trim();
    // 2. Suffixes with hyphen or slash: - TL, / (ME), - (FL), etc.
    s = s.replace(/\s*[-/:]\s*(?:[\(\[\{]?\s*(?:ME|TL|FL|M\.E\.|T\.L\.|F\.L\.|SR|JR)\s*[\)\]\}]?)\s*$/i, '').trim();
    // 3. Standalone trailing words: " PATEL TL", " VERMA FL", " SHARMA ME"
    s = s.replace(/\s+(?:ME|TL|FL|M\.E\.|T\.L\.|F\.L\.|SR|JR)\.?\s*$/i, '').trim();
  }

  // Strip trailing punctuation if left after suffix removal
  s = s.replace(/[\s\-_/.,:;]+$/, '').trim();

  // Normalize internal whitespace
  s = s.replace(/\s+/g, ' ');

  if (spCleanCache.size > 8000) spCleanCache.clear();
  spCleanCache.set(rawKey, s);
  return s;
}

// ── Check if two salesperson names are equivalent (handles surname front/back) ──
export function areSalespersonNamesEquivalent(name1: string, name2: string): boolean {
  if (!name1 || !name2) return false;
  const c1 = cleanSalespersonName(name1).trim().toUpperCase();
  const c2 = cleanSalespersonName(name2).trim().toUpperCase();
  if (c1 === c2) return true;

  // Extract clean alphanumeric tokens (words)
  const tokens1 = c1.split(/[^A-Z0-9]+/).filter(w => w.length > 0);
  const tokens2 = c2.split(/[^A-Z0-9]+/).filter(w => w.length > 0);

  if (tokens1.length === 0 || tokens2.length === 0) return false;

  // Exact token set equality (e.g. ["RAHUL", "SHARMA"] vs ["SHARMA", "RAHUL"])
  const sorted1 = [...tokens1].sort().join(' ');
  const sorted2 = [...tokens2].sort().join(' ');
  if (sorted1 === sorted2) return true;

  // Check token containment if multi-word (e.g., "PATEL JIGNESH" in "PATEL JIGNESH K")
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);
  if (tokens1.length >= 2 && tokens2.length >= 2) {
    let common = 0;
    for (const t of tokens1) {
      if (set2.has(t)) common++;
    }
    const tokenDice = (2 * common) / (tokens1.length + tokens2.length);
    if (tokenDice >= 0.80) return true;
  }

  // Fuzzy similarity check (>= 75%)
  return calculateSimilarity(c1, c2) >= 0.75;
}

// ── Clean Party Name ─────────────────────────────────────────────────────────
export function cleanPartyName(name: string): string {
  if (!name) return '';
  const rawKey = String(name);
  const cached = partyCleanCache.get(rawKey);
  if (cached !== undefined) return cached;

  let s = rawKey.trim();
  if (!s) {
    partyCleanCache.set(rawKey, '');
    return '';
  }
  // Strip GST or code prefixes like "GSTIN123 - ", "C00123 - ", "HUL123 - "
  s = s.replace(/^(GST[0-9A-Z]*|[A-Z0-9_-]{2,15})\s*[-:_]\s*/i, '').trim();
  // Strip code suffixes
  s = s.replace(/\s*[-:_]\s*[A-Z0-9_-]{2,15}$/i, '').trim();
  // Normalize internal whitespace
  s = s.replace(/\s+/g, ' ');

  if (partyCleanCache.size > 8000) partyCleanCache.clear();
  partyCleanCache.set(rawKey, s);
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

  const cacheKey = norm1 < norm2 ? `${norm1}||${norm2}` : `${norm2}||${norm1}`;
  const cached = similarityCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const wordsList1 = norm1.split(/\s+/).filter(w => w.length > 0);
  const wordsList2 = norm2.split(/\s+/).filter(w => w.length > 0);

  // Reordered words check: ["PATEL", "JIGNESH"] vs ["JIGNESH", "PATEL"]
  const sorted1 = [...wordsList1].sort().join(' ');
  const sorted2 = [...wordsList2].sort().join(' ');
  if (sorted1 && sorted2 && sorted1 === sorted2) {
    if (similarityCache.size > 15000) similarityCache.clear();
    similarityCache.set(cacheKey, 1.0);
    return 1.0;
  }

  // Token set similarity
  const words1 = new Set(wordsList1);
  const words2 = new Set(wordsList2);

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

  const result = Math.max(levSim, tokenDice, subBonus);
  if (similarityCache.size > 15000) similarityCache.clear();
  similarityCache.set(cacheKey, result);
  return result;
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

  // Fast pre-cleaned list
  const cleanedExisting: Array<{ raw: string; clean: string; upper: string }> = [];
  for (const n of existingNames) {
    const c = cleanFn(n);
    if (c) {
      const u = c.toUpperCase();
      if (u === cleanUpper) return c; // Immediate exact match O(1)
      cleanedExisting.push({ raw: n, clean: c, upper: u });
    }
  }

  // 2. Equivalent salesperson match (reordered surname etc.)
  if (cleanFn === cleanSalespersonName) {
    for (const item of cleanedExisting) {
      if (areSalespersonNamesEquivalent(cleaned, item.clean)) {
        return item.clean;
      }
    }
  }

  // 3. Similarity match (highest score >= threshold)
  let bestMatch = '';
  let highestScore = 0;

  for (const item of cleanedExisting) {
    const score = calculateSimilarity(cleaned, item.clean);
    if (score >= threshold && score > highestScore) {
      highestScore = score;
      bestMatch = item.clean;
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
  const tokenSortToCanonical = new Map<string, string>();
  const distinctCanonicals: Array<{ name: string; norm: string; sortedTokens: string }> = [];

  const isSalesperson = cleanFn === cleanSalespersonName;

  for (const name of cleanedNames) {
    const norm = name.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!norm) continue;

    const words = name.trim().toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 0);
    const sortedTokens = [...words].sort().join(' ');

    // 1. Fast O(1) exact normalized match
    if (normToCanonical.has(norm)) {
      canonicalMap.set(name, normToCanonical.get(norm)!);
      continue;
    }

    // 2. Fast O(1) sorted tokens match (handles surname front vs back)
    if (sortedTokens && tokenSortToCanonical.has(sortedTokens)) {
      const canon = tokenSortToCanonical.get(sortedTokens)!;
      canonicalMap.set(name, canon);
      normToCanonical.set(norm, canon);
      continue;
    }

    // 3. Salesperson equivalence check
    if (isSalesperson) {
      const eqItem = distinctCanonicals.find(item => areSalespersonNamesEquivalent(name, item.name));
      if (eqItem) {
        canonicalMap.set(name, eqItem.name);
        normToCanonical.set(norm, eqItem.name);
        continue;
      }
    }

    // 4. Fuzzy match against distinct canonicals
    let matchedCanonical = '';
    let bestScore = 0;

    for (const item of distinctCanonicals) {
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
      distinctCanonicals.push({ name, norm, sortedTokens });
      canonicalMap.set(name, name);
      normToCanonical.set(norm, name);
      if (sortedTokens) tokenSortToCanonical.set(sortedTokens, name);
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
