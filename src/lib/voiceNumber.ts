// ─── Hindi / Hinglish spoken-number parser ────────────────────────────────────
// Converts spoken words like "bara so bis", "tera hajar tinso baes",
// "28 pachso nabbe" into exact numeric strings (1220, 13322, 28590).

const UNITS: Record<string, number> = {
  // roman / hinglish
  shunya: 0, sunya: 0, zero: 0, jeero: 0, jiro: 0,
  ek: 1, one: 1, do: 2, two: 2, teen: 3, tin: 3, three: 3,
  char: 4, chaar: 4, four: 4, panch: 5, paanch: 5, pach: 5, pandh: 5, five: 5,
  chhe: 6, che: 6, chah: 6, chay: 6, chhah: 6, six: 6,
  saat: 7, sat: 7, seven: 7, aath: 8, aat: 8, ath: 8, eight: 8,
  nau: 9, no: 9, nine: 9, das: 10, dus: 10, ten: 10,
  gyarah: 11, gyara: 11, eleven: 11,
  barah: 12, bara: 12, baara: 12, twelve: 12,
  terah: 13, tera: 13, teraah: 13, thirteen: 13,
  chaudah: 14, chauda: 14, chaudha: 14, fourteen: 14,
  pandrah: 15, pandra: 15, fifteen: 15,
  solah: 16, sola: 16, sixteen: 16,
  satrah: 17, satra: 17, seventeen: 17,
  atharah: 18, athara: 18, eighteen: 18,
  unnis: 19, unis: 19, nineteen: 19,
  bees: 20, bis: 20, bees20: 20, twenty: 20,
  ikkis: 21, ikees: 21, ikkees: 21,
  bais: 22, baees: 22, baes: 22, bayees: 22, bavis: 22, bayis: 22,
  teis: 23, tais: 23, teees: 23, teiis: 23,
  chaubis: 24, chaubees: 24,
  pachchis: 25, pachees: 25, pachis: 25, pachchees: 25,
  chhabbis: 26, chhabis: 26, chabbis: 26,
  sattais: 27, sataees: 27, sattaees: 27,
  atthais: 28, athais: 28, atthaees: 28,
  untis: 29, unatis: 29,
  tees: 30, tis: 30, thirty: 30,
  ikatis: 31, ikkatis: 31, batis: 32, battis: 32, tetis: 33, taitis: 33,
  chautis: 34, chauntis: 34, paitis: 35, paintis: 35, chhattis: 36, chhatis: 36,
  saintis: 37, santis: 37, adtis: 38, athtis: 38, untalis: 39, unchalis: 39,
  chalis: 40, chaalis: 40, forty: 40,
  iktalis: 41, ikkatalis: 41, bayalis: 42, byalis: 42, taintalis: 43, tetalis: 43,
  chavalis: 44, chauvalis: 44, paitalis: 45, paintalis: 45, chhiyalis: 46, chhialis: 46,
  saintalis: 47, santalis: 47, adtalis: 48, athtalis: 48, unchas: 49, unpachas: 49,
  pachas: 50, pachaas: 50, fifty: 50,
  ikyavan: 51, ikavan: 51, bavan: 52, bawan: 52, tirpan: 53, tirapan: 53,
  chauvan: 54, chawan: 54, pachpan: 55, chhappan: 56, chhapan: 56,
  sattavan: 57, satavan: 57, atthavan: 58, athavan: 58, unsath: 59,
  saath: 60, sath: 60, sixty: 60,
  iksath: 61, ikasath: 61, basath: 62, basat: 62, tirsath: 63, tirasath: 63,
  chausath: 64, paisath: 65, painsath: 65, chhiyasath: 66, sarsath: 67, satsath: 67,
  adsath: 68, athsath: 68, unhattar: 69, unahattar: 69,
  sattar: 70, satar: 70, seventy: 70,
  ikhattar: 71, ikahattar: 71, bahattar: 72, bahatar: 72, tihattar: 73,
  chauhattar: 74, pachhattar: 75, pachahattar: 75, chhihattar: 76,
  sathattar: 77, satahattar: 77, athhattar: 78, athahattar: 78, unasi: 79, unyasi: 79,
  ashi: 80, ashee: 80, asi: 80, eighty: 80,
  dosoo: 200, doso: 200, dosow: 200, tinso: 300, teenso: 300, charso: 400, pachso: 500, panso: 500,
  pachasi: 85, pichasi: 85, pachyasi: 85, pachhyasi: 85, chhiyasi: 86, sattasi: 87, satasi: 87,
  atthasi: 88, athasi: 88, navasi: 89, nawasi: 89,
  nabbe: 90, nabhe: 90, navve: 90, nabe: 90, ninety: 90,
  ikyanve: 91, ikanve: 91, banve: 92, banave: 92, tiranve: 93, tiranave: 93,
  chauranve: 94, pichanve: 95, pachanve: 95, chhiyanve: 96,
  santanve: 97, satanve: 97, atthanve: 98, athanve: 98, ninyanve: 99, ninanve: 99,

  // devanagari
  '०': 0, '१': 1, '२': 2, '३': 3, '४': 4, '५': 5, '६': 6, '७': 7, '८': 8, '९': 9,
  'शून्य': 0, 'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पांच': 5, 'पाँच': 5,
  'छह': 6, 'छः': 6, 'छे': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'ग्यारह': 11, 'बारह': 12, 'तेरह': 13, 'चौदह': 14, 'पंद्रह': 15, 'सोलह': 16,
  'सत्रह': 17, 'अठारह': 18, 'उन्नीस': 19, 'बीस': 20, 'इक्कीस': 21, 'बाईस': 22,
  'तेईस': 23, 'चौबीस': 24, 'पच्चीस': 25, 'छब्बीस': 26, 'सत्ताईस': 27,
  'अट्ठाईस': 28, 'उनतीस': 29, 'तीस': 30, 'चालीस': 40, 'पचास': 50, 'पचपन': 55,
  'साठ': 60, 'सत्तर': 70, 'अस्सी': 80, 'असी': 80, 'नब्बे': 90, 'पचासी': 85, 'पच्चासी': 85,
  'दोस्तों': 200, 'दोसौ': 200, 'तीनसौ': 300, 'चारसौ': 400, 'पांचसौ': 500,
};

const MULTS: Record<string, number> = {
  so: 100, sau: 100, saw: 100, hundred: 100, 'सौ': 100,
  hazar: 1000, hajar: 1000, hazaar: 1000, hajaar: 1000, hazzar: 1000,
  haraj: 1000, thousand: 1000, 'हज़ार': 1000, 'हजार': 1000,
  lakh: 100000, lac: 100000, 'लाख': 100000,
};

type Tok = { t: 'n' | 'm'; v: number };

/** Split compound tokens like "baraso", "doharaj", "tinso" into parts. */
function expandToken(raw: string): Tok[] {
  const w = raw.trim();
  if (!w) return [];
  if (/^\d+$/.test(w)) return [{ t: 'n', v: Number(w) }];
  if (w in UNITS) return [{ t: 'n', v: UNITS[w] }];
  if (w in MULTS) return [{ t: 'm', v: MULTS[w] }];

  // try splitting a known multiplier suffix off the end (baraso, doharaj, teenso)
  for (const m of Object.keys(MULTS)) {
    if (w.length > m.length && w.endsWith(m)) {
      const head = w.slice(0, w.length - m.length);
      const headToks = expandToken(head);
      if (headToks.length) return [...headToks, { t: 'm', v: MULTS[m] }];
    }
  }
  // try splitting a known multiplier prefix (sauek)
  for (const m of Object.keys(MULTS)) {
    if (w.length > m.length && w.startsWith(m)) {
      const tail = expandToken(w.slice(m.length));
      if (tail.length) return [{ t: 'm', v: MULTS[m] }, ...tail];
    }
  }
  return [];
}

const FILLER = new Set([
  'ko', 'ka', 'ki', 'ke', 'me', 'mein', 'main', 'se', 'par', 'paid', 'pay',
  'karo', 'kar', 'kro', 'dena', 'de', 'rupaye', 'rupay', 'rupee', 'rupees',
  'rs', 'rupya', 'rupaya', 'ka', 'aur', 'and', 'no', 'number', 'bill', 'inv', 'invoice', 'gst',
  'को', 'का', 'की', 'के', 'में', 'से', 'रुपये', 'रुपए', 'करो', 'नंबर', 'बिल',
]);

/**
 * Parse a spoken phrase into a digit string. Returns '' when no number found.
 * "bara so bis" → "1220" | "28 pachso nabbe" → "28590"
 */
export function parseSpokenNumber(phrase: string): string {
  const words = phrase
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  const toks: Tok[] = [];
  for (const w of words) {
    if (FILLER.has(w) && !(w in UNITS)) continue;
    const ex = expandToken(w);
    if (ex.length) toks.push(...ex);
  }
  if (!toks.length) return '';

  // build chunks
  const chunks: number[] = [];
  let pending: number | null = null;
  for (const t of toks) {
    if (t.t === 'n') {
      if (pending !== null) chunks.push(pending);
      pending = t.v;
    } else {
      pending = (pending ?? 1) * t.v;
      chunks.push(pending);
      pending = null;
    }
  }
  if (pending !== null) chunks.push(pending);
  if (!chunks.length) return '';

  // digit-by-digit dictation → pure concatenation
  if (chunks.length >= 2 && chunks.every(c => c < 10)) return chunks.join('');

  // If first chunk is a non-round bill number (e.g. 12613, not ending in 00/000), return it as first number
  if (chunks.length >= 2 && chunks[0] > 100 && chunks[0] % 100 !== 0) {
    return String(chunks[0]);
  }

  let acc = String(chunks[0]);
  let last = chunks[0];
  for (let i = 1; i < chunks.length; i++) {
    const v = chunks[i];
    if (v < last && last >= 100 && last % 100 === 0) {
      acc = String(Number(acc) + v);
    } else {
      acc = acc + String(v);
    }
    last = v;
  }
  return acc;
}

export type VoiceCommand = {
  billNo: string;
  amount: number | null;
  mode: 'Cash' | 'UPI' | 'Cheque' | null;
  fromMode?: 'Cash' | 'UPI' | 'Cheque' | null;
  toMode?: 'Cash' | 'UPI' | 'Cheque' | null;
  isConvert?: boolean;
  isFullPaid?: boolean;
  raw: string;
};

const MODE_WORDS: Array<{ re: RegExp; mode: 'Cash' | 'UPI' | 'Cheque' }> = [
  { re: /\b(cash|kaish|kash|nakad|नकद|कैश)\b/i, mode: 'Cash' },
  { re: /\b(gpay|g pay|googlepay|google pay|upi|yupi|phonepe|phone pe|online|जीपे|यूपीआई)\b/i, mode: 'UPI' },
  { re: /\b(cheque|check|chq|chek|चेक)\b/i, mode: 'Cheque' },
];

const CASH_PATTERN = '(?:cash|kaish|kash|nakad|नकद|कैश)';
const UPI_PATTERN = '(?:gpay|g\\s*pay|google\\s*pay|upi|yupi|phonepe|phone\\s*pe|online|जीपे|यूपीआई)';
const CHEQUE_PATTERN = '(?:cheque|check|chq|chek|चेक)';

function resolveModeName(s: string): 'Cash' | 'UPI' | 'Cheque' {
  const clean = s.toLowerCase().replace(/\s+/g, '');
  if (new RegExp(`^${CASH_PATTERN}$`, 'i').test(clean)) return 'Cash';
  if (new RegExp(`^${UPI_PATTERN}$`, 'i').test(clean)) return 'UPI';
  return 'Cheque';
}

/** Detect mode conversion: e.g. "cash ko gpay me paid karo", "gpay ko cash karo", "cash to upi" */
export function detectModeConversion(rawText: string): {
  fromMode: 'Cash' | 'UPI' | 'Cheque';
  toMode: 'Cash' | 'UPI' | 'Cheque';
  billNo?: string;
} | null {
  const text = stripWakeWord(rawText).toLowerCase().trim();
  const pattern = new RegExp(
    `(${CASH_PATTERN}|${UPI_PATTERN}|${CHEQUE_PATTERN})\\s*(?:ko|se|to|se\\s*nikal\\s*kar|se\\s*hata\\s*kar|in|into)\\s*(${CASH_PATTERN}|${UPI_PATTERN}|${CHEQUE_PATTERN})`,
    'i'
  );
  const match = pattern.exec(text);
  if (match) {
    const fromMode = resolveModeName(match[1]);
    const toMode = resolveModeName(match[2]);
    if (fromMode !== toMode) {
      const before = text.slice(0, match.index);
      const after = text.slice(match.index + match[0].length);
      const bDigits = parseSpokenNumber(before) || before.match(/\d+/g)?.join('');
      const aDigits = parseSpokenNumber(after) || after.match(/\d+/g)?.join('');
      const billNo = bDigits || aDigits || undefined;
      return { fromMode, toMode, billNo };
    }
  }
  return null;
}

/** Wake word detection: "hey hul" / "he hul" / "hul" / "हे हल" / "हुल" + common phonetic variations */
export function hasWakeWord(text: string): boolean {
  const normalized = text.toLowerCase().trim();
  if (!normalized) return false;

  // Hindi variants of "hul"
  if (/(हल|हुल|हूल|हाल)\b/.test(normalized)) return true;

  // Keep this list TIGHT — loose words like "all"/"full" caused false triggers.
  const targetWords = ['hul', 'hull', 'hool', 'hall', 'hal'];

  const words = normalized.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  return words.some((w, i) => targetWords.includes(w) );
}

export function stripWakeWord(text: string): string {
  return text
    .replace(/\b(hey|hei|he|hay|hi|hello|ok|okay)\s+(hul|hull|hool|hall|hal)\b/gi, ' ')
    .replace(/\b(hul|hull|hool|hall|hal)\b/gi, ' ')
    .replace(/(हे|हाय|ओके)?\s*(हल|हुल|हूल|हाल)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const ACTION_STRIP_RE = /\b(find|search|khojo|dekho|nikalo|dhoondho|dhoondo|open|show|dikhao|batao|karo|paid|pay|se)\b/gi;

/**
 * Parse a full spoken command: bill phrase [+ mode + amount phrase].
 * Examples:
 * - "hey hul 501" -> find bill 501
 * - "find ganesh" -> search party ganesh
 * - "cash ko gpay me paid karo" -> convert cash to gpay
 * - "501 cash 1200" -> set bill 501 cash = 1200
 * - "501 ko cash me poora paid karo" -> set bill 501 cash = full bill amount
 */
export function parseVoiceCommand(rawText: string): VoiceCommand {
  const text = stripWakeWord(rawText).toLowerCase().trim();

  // First check if this is an explicit mode conversion command (e.g. "cash ko gpay me paid karo")
  const conv = detectModeConversion(rawText);
  if (conv) {
    return {
      billNo: conv.billNo || '',
      amount: null,
      mode: conv.toMode,
      fromMode: conv.fromMode,
      toMode: conv.toMode,
      isConvert: true,
      isFullPaid: true,
      raw: rawText,
    };
  }

  let mode: 'Cash' | 'UPI' | 'Cheque' | null = null;
  let splitIdx = -1;
  let splitLen = 0;
  for (const m of MODE_WORDS) {
    const match = m.re.exec(text);
    if (match && (splitIdx === -1 || match.index < splitIdx)) {
      mode = m.mode;
      splitIdx = match.index;
      splitLen = match[0].length;
    }
  }

  const getDigitsFallback = (s: string) => {
    const m = s.match(/\d+/g);
    return m ? m.join('') : '';
  };

  const cleanPartySearchTerm = (s: string) => {
    return s
      .replace(ACTION_STRIP_RE, '')
      .replace(/\b(bill|no|number|inv|invoice|ko|ka|ki|ke|me|mein|par|is|ye)\b/gi, '')
      .trim();
  };

  const isFullPaidText = (s: string) => {
    return /\b(full|poora|pura|sab|sara|complete|पूरा|फुल|paid|pay|पेड़|पेड)\b/i.test(s);
  };

  if (splitIdx === -1) {
    let billNo = parseSpokenNumber(text);
    if (!billNo) billNo = getDigitsFallback(text);
    if (!billNo) billNo = cleanPartySearchTerm(text);

    const isPaid = /\b(paid|pay|पेड़|पेड)\b/i.test(text);
    const isFull = isFullPaidText(text);

    if (isPaid || isFull) {
      return { billNo, amount: null, mode: 'Cash', isFullPaid: true, raw: rawText };
    }

    return { billNo, amount: null, mode: null, raw: rawText };
  }

  const left = text.slice(0, splitIdx);
  const right = text.slice(splitIdx + splitLen);

  let billNo = parseSpokenNumber(left);
  if (!billNo) billNo = getDigitsFallback(left);
  if (!billNo) billNo = cleanPartySearchTerm(left);

  let amount: number | null = null;
  const isFullPaid = isFullPaidText(right) || isFullPaidText(text) || /\b(karo|paid|kar do)\b/i.test(text);
  const amtStr = parseSpokenNumber(right) || getDigitsFallback(right);
  if (amtStr) amount = Number(amtStr);

  return {
    billNo,
    amount,
    mode,
    isFullPaid,
    raw: rawText,
  };
}

