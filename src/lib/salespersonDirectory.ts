/**
 * Master Salesperson Directory with Permanent Mobile Numbers
 * Provided by Admin. These numbers must stay permanently saved in the app,
 * and when names are merged, the number must automatically update to the new name.
 */

import { cleanSalespersonName, areSalespersonNamesEquivalent, calculateSimilarity } from './nameStandardizer';

export interface MasterSalespersonContact {
  name: string;
  mobile: string;
  aliases?: string[];
}

export const MASTER_SALESPERSON_DIRECTORY: MasterSalespersonContact[] = [
  {
    name: 'SHINDE MIHIR MANGESHBHAI',
    mobile: '9773444052',
    aliases: ['SHINDE MIHIR', 'MIHIR SHINDE', 'SHINDE MIHIR MANGESHBHAI'],
  },
  {
    name: 'AFROZKHAN FARUKKHAN PATHAN',
    mobile: '8401437795',
    aliases: ['AFROZKHAN PATHAN', 'PATHAN AFROZKHAN', 'AFROZ PATHAN', 'AFROZKHAN FARUKKHAN'],
  },
  {
    name: 'BHAGAT ANILKUMAR AMRUTLAL',
    mobile: '7575032276',
    aliases: ['ANILKUMAR BHAGAT', 'BHAGAT ANILKUMAR', 'ANILKUMAR BHAGAT BHAGAT', 'ANIL BHAGAT'],
  },
  {
    name: 'MANISH MEENA',
    mobile: '9773049624',
    aliases: ['MANISH MEENA', 'MEENA MANISH'],
  },
  {
    name: 'ANITA JIGNESH MANANI',
    mobile: '8866376639',
    aliases: ['ANITA MANANI', 'ANITA JIGNESH', 'MANANI ANITA'],
  },
  {
    name: 'VIVEK BHASKAR PATIL',
    mobile: '9687390853',
    aliases: ['VIVEK PATIL', 'PATIL VIVEK', 'VIVEK BHASKAR'],
  },
  {
    name: 'MOHAMMED UVAISH ABDUL GANI PANWALA',
    mobile: '9313984872',
    aliases: ['MOHAMMED UVAISH PANWALA', 'UVAISH PANWALA', 'MOHAMMED UVAISH ABDUL GANI', 'UVAISH ABDUL GANI PANWALA'],
  },
  {
    name: 'PARMAR FENISH KISHORBHAI',
    mobile: '8511919051',
    aliases: ['PARMAR FENISH', 'FENISH PARMAR', 'PARMAR FENISH KISHORBHAI PARMAR'],
  },
  {
    name: 'PRAKASHKUMAR GOPALBHAI AHIR',
    mobile: '9687470896',
    aliases: ['PRAKASHKUMAR AHIR', 'PRAKASH AHIR', 'AHIR PRAKASHKUMAR'],
  },
  {
    name: 'SILEN NISHANT CHARANIYA',
    mobile: '7202910157',
    aliases: ['SILEN CHARANIYA', 'CHARANIYA SILEN', 'SILEN NISHANT'],
  },
  {
    name: 'VAGHELA DHRUVANG ASHOKKUMAR',
    mobile: '9913909537',
    aliases: ['VAGHELA DHRUVANG', 'DHRUVANG VAGHELA', 'RAWAL DHRUV ATULKUMAR'],
  },
  {
    name: 'PARMAR HARSH MADANLAL',
    mobile: '8780953312',
    aliases: ['PARMAR HARSH', 'HARSH PARMAR', 'HARSH MADANLAL', 'HARSH MADANLAL PARMAR'],
  },
  {
    name: 'MIHIR PRADIPBHAI MALI',
    mobile: '8511007622',
    aliases: ['MIHIR MALI', 'MALI MIHIR', 'MIHIR PRADIPBHAI'],
  },
  {
    name: 'SHAIKH MOHAMMED ASHIF MOHAMMED ZUBER',
    mobile: '9725860578',
    aliases: ['SHAIKH MOHAMMED ASHIF', 'MOHAMMED ASHIF SHAIKH', 'SHAIKH MOHAMMED ADIL MOHAMMED ILYAS'],
  },
  {
    name: 'SHAILESHKUMAR CHHOTABHAI PATEL',
    mobile: '9106930980',
    aliases: ['SHAILESHKUMAR PATEL', 'SHAILESH PATEL', 'SHAILASH PATEL', 'PATEL SHAILESHKUMAR'],
  },
  {
    name: 'FAIZ AHMED MUHAMMED IQBAL SINGAPURI',
    mobile: '8401437806',
    aliases: ['FAIZ AHMED SINGAPURI', 'FAIZ SINGAPURI', 'SINGAPURI FAIZ AHMED'],
  },
  {
    name: 'CHINTAN RAJUBHAI MARU',
    mobile: '9033116966',
    aliases: ['CHINTAN MARU', 'MARU CHINTAN', 'MARU CHINTAN MARU'],
  },
  {
    name: 'RATHOD RAHUL KISHORBHAI',
    mobile: '8511800843',
    aliases: ['RATHOD RAHUL', 'RAHUL RATHOD', 'RATHOD RAHUL KISHORBHAI'],
  },
  {
    name: 'SUNIL VASANTBHAI VALA',
    mobile: '9974144166',
    aliases: ['SUNIL VALA', 'VALA SUNIL', 'SUNIL VASANTBHAI'],
  },
  {
    name: 'SAIYED MANSUR ALI AHMAD ALI',
    mobile: '9979454931',
    aliases: ['SAIYED MANSUR ALI', 'MANSURALI SAIYED', 'MANSUR ALI SAIYED', 'SAIYED MANSUR ALI AHMAD ALI'],
  },
  {
    name: 'RATHOD BHARAT KUMAR',
    mobile: '9173725191',
    aliases: ['RATHOD BHARAT', 'BHARAT RATHOD', 'BHARATKUMAR RATHOD'],
  },
  {
    name: 'SHAIKH JAVED SHAIKH NISAR',
    mobile: '9724291266',
    aliases: ['JAVED SHAIKH', 'SHAIKH JAVED', 'JAVED NISAR SHAIKH'],
  },
  {
    name: 'MEMON IMRAN MOHAMADRAFIK',
    mobile: '8980440687',
    aliases: ['MEMON IMRAN', 'IMRAN MEMON', 'IMRAN MOHAMADRAFIK MEMON'],
  },
  {
    name: 'RATHOD SIDDHARTH LALJIBHAI',
    mobile: '9033485080',
    aliases: ['RATHOD SIDDHARTH', 'SIDDHARTH RATHOD', 'SIDDHARTH LALJIBHAI RATHOD'],
  },
  {
    name: 'MANISHA CHIRAGBHAI CHOTALIYA',
    mobile: '7211191676',
    aliases: ['MANISHA CHOTALIYA', 'CHOTALIYA MANISHA', 'MANISHA CHIRAGBHAI'],
  },
  {
    name: 'MAYANK BHARAT REVDIWALA',
    mobile: '9638046563',
    aliases: ['MAYANK REVDIWALA', 'REVDIWALA MAYANK', 'MAYANK BHARAT'],
  },
  {
    name: 'PATIL PANDURANGBHAI BHAGVANBHAI',
    mobile: '9773186744',
    aliases: ['PATIL PANDURANGBHAI', 'PANDURANGBHAI PATIL', 'PANDURANG PATIL'],
  },
  {
    name: 'HOZEFA MOIZBHAI VOHRA',
    mobile: '7069585272',
    aliases: ['HOZEFA VOHRA', 'HOJEFA VOHRA', 'HOJEFA MOIZBHAI VOHRA', 'VOHRA HOZEFA', 'VOHRA HOJEFA'],
  },
  {
    name: 'DINESHKUMAR CHAMPALAL PADIHAR',
    mobile: '9825983003',
    aliases: ['DINESHKUMAR PADIHAR', 'DINESH PADIHAR', 'PADIHAR DINESHKUMAR'],
  },
  {
    name: 'MANSUR TARIKHUSEN MOHAMEDALTAF',
    mobile: '9638819123',
    aliases: ['TARIKHHUSEN MANSUR', 'TARIKHUSEN MANSUR', 'MANSUR TARIKHUSEN', 'MANSUR TARIKH'],
  },
  {
    name: 'MANOJKUMAR ARVINDLAL JISHAHEB',
    mobile: '8401437804',
    aliases: ['MANOJKUMAR JISHAHEB', 'MANOJ JISHAHEB', 'JISHAHEB MANOJKUMAR', 'MANOJKUMAR ARVINDLAL'],
  },
];

// Fast lookup cache
const matchCache = new Map<string, MasterSalespersonContact | null>();

/**
 * Robustly find a master salesperson contact by name, alias, tokens, or equivalence.
 */
export function findMasterSalesperson(name: string): MasterSalespersonContact | undefined {
  if (!name) return undefined;
  const raw = String(name).trim();
  if (!raw) return undefined;

  const key = raw.toUpperCase();
  if (matchCache.has(key)) {
    const res = matchCache.get(key);
    return res || undefined;
  }

  const clean = cleanSalespersonName(raw).trim().toUpperCase();

  // 1. Exact match on full official name
  for (const m of MASTER_SALESPERSON_DIRECTORY) {
    if (m.name.toUpperCase() === key || m.name.toUpperCase() === clean) {
      matchCache.set(key, m);
      return m;
    }
  }

  // 2. Exact match on configured aliases
  for (const m of MASTER_SALESPERSON_DIRECTORY) {
    if (m.aliases) {
      for (const alias of m.aliases) {
        const aliasClean = cleanSalespersonName(alias).trim().toUpperCase();
        if (alias.toUpperCase() === key || aliasClean === clean) {
          matchCache.set(key, m);
          return m;
        }
      }
    }
  }

  // 3. Name equivalence via areSalespersonNamesEquivalent
  for (const m of MASTER_SALESPERSON_DIRECTORY) {
    if (areSalespersonNamesEquivalent(m.name, raw) || areSalespersonNamesEquivalent(m.name, clean)) {
      matchCache.set(key, m);
      return m;
    }
    if (m.aliases) {
      for (const alias of m.aliases) {
        if (areSalespersonNamesEquivalent(alias, raw) || areSalespersonNamesEquivalent(alias, clean)) {
          matchCache.set(key, m);
          return m;
        }
      }
    }
  }

  // 4. Token containment / word overlap (e.g. "AFROZKHAN PATHAN" in "AFROZKHAN FARUKKHAN PATHAN")
  const cleanTokens = clean.split(/[^A-Z0-9]+/).filter(w => w.length > 1);
  if (cleanTokens.length >= 2) {
    for (const m of MASTER_SALESPERSON_DIRECTORY) {
      const mTokens = m.name.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 1);
      const mSet = new Set(mTokens);
      const matchCount = cleanTokens.filter(t => mSet.has(t)).length;
      if (matchCount >= 2 && matchCount / cleanTokens.length >= 0.6) {
        matchCache.set(key, m);
        return m;
      }
    }
  }

  // 5. High similarity match (>= 0.70)
  for (const m of MASTER_SALESPERSON_DIRECTORY) {
    if (calculateSimilarity(clean, m.name) >= 0.70) {
      matchCache.set(key, m);
      return m;
    }
  }

  matchCache.set(key, null);
  return undefined;
}

/**
 * Get verified mobile number for a salesperson name if present in directory.
 */
export function getMasterSalespersonMobile(name: string): string | undefined {
  const match = findMasterSalesperson(name);
  return match?.mobile;
}
