/**
 * Master Salesperson Directory with Permanent Mobile Numbers (Backend)
 * Provided by Admin. These numbers must stay permanently saved in the app,
 * and when names are merged, the number must automatically update to the new name.
 */

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

export function cleanSpNameSimple(name: string): string {
  if (!name) return '';
  return name
    .trim()
    .replace(/^[A-Z0-9_-]{2,15}\s*[-:_]\s*/i, '')
    .replace(/[\(\[\{]\s*(?:ME|M\.E\.?|TL|FL|SR|JR|SO)\s*[\)\]\}]/gi, ' ')
    .replace(/\s+(?:ME|TL|FL)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function findServerMasterSalesperson(name: string): MasterSalespersonContact | undefined {
  if (!name) return undefined;
  const raw = String(name).trim();
  if (!raw) return undefined;

  const key = raw.toUpperCase();
  const clean = cleanSpNameSimple(raw).toUpperCase();

  for (const m of MASTER_SALESPERSON_DIRECTORY) {
    if (m.name.toUpperCase() === key || m.name.toUpperCase() === clean) return m;
    if (m.aliases) {
      for (const a of m.aliases) {
        if (a.toUpperCase() === key || cleanSpNameSimple(a).toUpperCase() === clean) return m;
      }
    }
  }

  // Check token containment
  const tokens = clean.split(/[^A-Z0-9]+/).filter(w => w.length > 2);
  if (tokens.length >= 2) {
    for (const m of MASTER_SALESPERSON_DIRECTORY) {
      const mTokens = new Set(m.name.toUpperCase().split(/[^A-Z0-9]+/).filter(w => w.length > 2));
      const matchCount = tokens.filter(t => mTokens.has(t)).length;
      if (matchCount >= 2 && matchCount / tokens.length >= 0.6) {
        return m;
      }
    }
  }

  return undefined;
}
