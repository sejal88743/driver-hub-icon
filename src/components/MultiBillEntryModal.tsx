import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { X, Plus, Trash2, Check, Loader2, Landmark, Wallet, Smartphone, Hash, CalendarDays, Mic, MicOff, Volume2 } from 'lucide-react';
import { displayToIso, isoToDisplay, getTodayISO } from '@/lib/dateUtils';

function stripGST(bn: string) {
  return (bn || '').replace(/^GST[-_]/i, '').trim();
}

function parseAmountExpression(value: string | number | undefined | null): number {
  if (value === undefined || value === null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const rawStr = String(value || '').trim();
  if (!rawStr) return 0;

  const cleaned = rawStr.replace(/,/g, '');

  if (cleaned.includes('+')) {
    const parts = cleaned.split('+');
    let sum = 0;
    let hasValid = false;
    for (const part of parts) {
      const numStr = part.replace(/[^\d.-]/g, '').trim();
      if (numStr && numStr !== '-' && numStr !== '.') {
        const n = parseFloat(numStr);
        if (!isNaN(n) && Number.isFinite(n)) {
          sum += n;
          hasValid = true;
        }
      }
    }
    if (hasValid) return Math.round(sum * 100) / 100;
  }

  const sanitized = cleaned.replace(/[^\d.-]/g, '').trim();
  if (sanitized && sanitized !== '-' && sanitized !== '.') {
    const n = parseFloat(sanitized);
    if (!isNaN(n) && Number.isFinite(n)) return Math.round(n * 100) / 100;
  }

  return 0;
}
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Bill, Bank } from '@/lib/billStore';
import { savePayment, getUserPerm } from '@/lib/billStore';
import { getRole, getLoggedInName } from '@/lib/auth';
import BankCombobox from '@/components/BankCombobox';
import { parseSpokenNumber } from '@/lib/voiceNumber';

type PaymentMode = 'Cash' | 'UPI' | 'Cheque';

type BillRow = {
  id: string;
  billNo: string;
  recAmt: string;
  lineCutAmt: string;
  showDropdown: boolean;
  dropdownIdx: number;
};

function makeRow(): BillRow {
  return { id: Math.random().toString(36).slice(2), billNo: '', recAmt: '', lineCutAmt: '', showDropdown: false, dropdownIdx: 0 };
}

type Props = {
  bills: Bill[];
  banks: Bank[];
  selectedDriver: string;
  displayDate: string;
  dashDate: string;
  onClose: () => void;
  onSaved: () => void;
};

export default function MultiBillEntryModal({ bills, banks, selectedDriver, displayDate, dashDate, onClose, onSaved }: Props) {
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('Cash');
  const [chequeNo, setChequeNo] = useState('');
  const [bankName, setBankName] = useState('');
  const [chequeDate, setChequeDate] = useState(() => {
    // Default to today in DD/MM/YYYY
    const n = new Date();
    return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
  });
  const isUserRole = getRole() === 'user';
  const [recDate, setRecDate] = useState(() => isUserRole ? getTodayISO() : (displayToIso(dashDate) || getTodayISO())); // ISO yyyy-mm-dd
  const [rows, setRows] = useState<BillRow[]>([makeRow(), makeRow(), makeRow()]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [done, setDone] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // ── Voice mic & feedback state ──────────────────────────────────────────────
  const [isVoiceActive, setIsVoiceActive] = useState(false);
  const isVoiceActiveRef = useRef(false);
  const [voiceFeedback, setVoiceFeedback] = useState<string | null>(null);
  const [disambigModal, setDisambigModal] = useState<{ target: string; matches: Bill[] } | null>(null);
  const disambigModalRef = useRef(disambigModal);
  useEffect(() => { disambigModalRef.current = disambigModal; }, [disambigModal]);
  const recognitionRef = useRef<any>(null);

  const chequeNoRef   = useRef<HTMLInputElement>(null);
  const bankSelectRef = useRef<HTMLInputElement>(null);
  const billInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const recAmtRefs    = useRef<Record<string, HTMLInputElement | null>>({});
  const lcRefs        = useRef<Record<string, HTMLInputElement | null>>({});

  const bankDropdownOpenRef = useRef(false);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (disambigModal) {
          setDisambigModal(null);
          return;
        }
        const anyBillDropdown = rows.some(r => r.showDropdown);
        if (!anyBillDropdown && !bankDropdownOpenRef.current) onClose();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [rows, onClose, disambigModal]);

  const billMap = useMemo(() => {
    const m = new Map<string, Bill>();
    for (const b of bills) m.set(b.billNo, b);
    return m;
  }, [bills]);

  // Driver bills for selectedDriver and active delivery date
  const driverBills = useMemo(() => {
    return bills.filter(b => {
      if (selectedDriver && selectedDriver !== 'OWNER') {
        if (b.driverName !== selectedDriver) return false;
      }
      if (displayDate || dashDate) {
        const bd = b.deliveryDate || '';
        const match = bd === displayDate || bd === dashDate || isoToDisplay(bd) === displayDate;
        if (!match) return false;
      }
      return true;
    });
  }, [bills, selectedDriver, displayDate, dashDate]);

  // Fast TTS speech feedback helper
  const speakFeedback = useCallback((text: string) => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'hi-IN';
      u.rate = 1.35; // fast rate for quick feedback
      u.pitch = 1.0;
      window.speechSynthesis.speak(u);
    } catch {}
  }, []);

  const getFilteredBillNos = useCallback((query: string, excludeNos: string[]) => {
    if (!query.trim()) return [];
    const q = query.toLowerCase().trim();
    const excludeSet = new Set(excludeNos);
    const results: string[] = [];
    const seen = new Set<string>();
    for (const b of bills) {
      if (selectedDriver && selectedDriver !== 'OWNER') {
        if (b.driverName !== selectedDriver) continue;
      }
      if (displayDate || dashDate) {
        const bd = b.deliveryDate || '';
        const match = bd === displayDate || bd === dashDate || isoToDisplay(bd) === displayDate;
        if (!match) continue;
      }
      if (excludeSet.has(b.billNo)) continue;
      if (seen.has(b.billNo)) continue;
      const bl = b.billNo.toLowerCase();
      const pl = (b.partyName || '').toLowerCase();
      if (bl.startsWith(q) || bl.includes(q) || pl.startsWith(q) || pl.includes(q)) {
        results.push(b.billNo);
        seen.add(b.billNo);
        if (results.length >= 8) break;
      }
    }
    return results;
  }, [bills, selectedDriver, displayDate]);

  function updateRow(id: string, patch: Partial<BillRow>) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...patch } : r));
  }

  function addRow() {
    const newRow = makeRow();
    setRows(prev => [...prev, newRow]);
    setTimeout(() => billInputRefs.current[newRow.id]?.focus(), 40);
    return newRow.id;
  }

  function removeRow(id: string) { setRows(prev => prev.filter(r => r.id !== id)); }

  // rowsRef lets setTimeout callbacks read the latest rows without stale closure
  const rowsRef = useRef(rows);
  useEffect(() => { rowsRef.current = rows; }, [rows]);

  // Add a specific bill to the rows list
  const addBillToRows = useCallback((bill: Bill) => {
    const cleanNo = bill.billNo;
    // Check if already in rows
    const isAlreadyAdded = rowsRef.current.some(r => r.billNo === cleanNo);
    if (isAlreadyAdded) {
      speakFeedback("Already added");
      setVoiceFeedback(`Pehle se add hai: ${cleanNo}`);
      return;
    }

    const fullAmt = bill.billNetAmt || 0;

    // Find first empty row
    const emptyRowIdx = rowsRef.current.findIndex(r => !r.billNo.trim());
    if (emptyRowIdx !== -1) {
      const rowId = rowsRef.current[emptyRowIdx].id;
      setRows(prev => prev.map(r => r.id === rowId ? {
        ...r,
        billNo: cleanNo,
        lineCutAmt: '',
        recAmt: fullAmt > 0 ? String(fullAmt) : '',
        showDropdown: false,
      } : r));
      setErrors(p => { const n = { ...p }; delete n[rowId]; return n; });
    } else {
      // Append new row
      const newRow = makeRow();
      newRow.billNo = cleanNo;
      newRow.lineCutAmt = '';
      newRow.recAmt = fullAmt > 0 ? String(fullAmt) : '';
      setRows(prev => [...prev, newRow]);
    }

    speakFeedback("Added");
    setVoiceFeedback(`Added ${stripGST(cleanNo)} (${bill.partyName || ''})`);
  }, [speakFeedback]);

  // Voice command handler
  const handleVoiceInput = useCallback((rawPhrase: string) => {
    if (!rawPhrase || !rawPhrase.trim()) return;

    const phrase = rawPhrase.trim();
    const parsedDigits = parseSpokenNumber(phrase);
    const regexDigits = phrase.replace(/\D/g, '');
    const target = parsedDigits || regexDigits;

    if (!target) return;

    // 1. If disambigModal is open, check if spoken text matches one of the choices
    if (disambigModalRef.current) {
      const currentMatches = disambigModalRef.current.matches;
      const matchedOption = currentMatches.find(b =>
        stripGST(b.billNo) === target || b.billNo === target || stripGST(b.billNo).endsWith(target)
      );
      if (matchedOption) {
        addBillToRows(matchedOption);
        setDisambigModal(null);
        return;
      }
    }

    // 2. Search ONLY within driver's assigned bills for the selected date
    const pool = driverBills;

    const exact = pool.filter(b => stripGST(b.billNo) === target || b.billNo === target);
    const suffix = pool.filter(b => stripGST(b.billNo).endsWith(target));
    const includes = pool.filter(b => stripGST(b.billNo).includes(target));

    const matches = exact.length > 0 ? exact : (suffix.length > 0 ? suffix : includes);

    if (matches.length === 0) {
      speakFeedback("Not found");
      setVoiceFeedback(`Not found for ${target}`);
    } else if (matches.length === 1) {
      addBillToRows(matches[0]);
    } else {
      // Multiple matches found! Prompt user for confirmation.
      setDisambigModal({ target, matches });
      const choiceText = matches.map(m => stripGST(m.billNo)).join(" ya ");
      speakFeedback(`Kon sa add karna hai? ${choiceText}`);
      setVoiceFeedback(`Select bill for ${target}`);
    }
  }, [driverBills, addBillToRows, speakFeedback]);

  const handleVoiceInputRef = useRef(handleVoiceInput);
  useEffect(() => { handleVoiceInputRef.current = handleVoiceInput; }, [handleVoiceInput]);

  const toggleVoice = useCallback(() => {
    setIsVoiceActive(prev => {
      const next = !prev;
      isVoiceActiveRef.current = next;
      if (next) {
        speakFeedback("Mic on");
        setVoiceFeedback("Listening...");
        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
          navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
        }
      } else {
        speakFeedback("Mic off");
        setVoiceFeedback(null);
        if (recognitionRef.current) {
          try { recognitionRef.current.stop(); } catch {}
        }
      }
      return next;
    });
  }, [speakFeedback]);

  // Continuous speech recognition loop
  useEffect(() => {
    if (!isVoiceActive) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Aapke browser me speech recognition support nahi hai. Chrome ya Edge browser use karein.");
      setIsVoiceActive(false);
      isVoiceActiveRef.current = false;
      return;
    }

    let isStopped = false;
    let rec: any = null;

    const startRecInstance = () => {
      if (isStopped || !isVoiceActiveRef.current) return;

      rec = new SpeechRecognition();
      recognitionRef.current = rec;
      rec.continuous = true;
      rec.interimResults = true;
      rec.lang = 'hi-IN';

      let lastProcessedTarget = '';
      let speechDebounceTimer: any = null;

      rec.onstart = () => {
        setVoiceFeedback("Listening...");
      };

      rec.onresult = (event: any) => {
        let interim = '';
        let final = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) final += text + ' ';
          else interim += text + ' ';
        }
        const finalCandidate = final.trim();
        const interimCandidate = interim.trim();

        if (finalCandidate || interimCandidate) {
          setVoiceFeedback(`Suno: "${finalCandidate || interimCandidate}"`);
        }

        if (finalCandidate) {
          if (speechDebounceTimer) clearTimeout(speechDebounceTimer);
          const target = parseSpokenNumber(finalCandidate) || finalCandidate.replace(/\D/g, '');
          if (target && target !== lastProcessedTarget) {
            lastProcessedTarget = target;
            handleVoiceInputRef.current(finalCandidate);
          }
        } else if (interimCandidate) {
          // Wait 1.6s of silence before processing interim candidate as fallback to prevent cutting off numbers like 20509
          if (speechDebounceTimer) clearTimeout(speechDebounceTimer);
          speechDebounceTimer = setTimeout(() => {
            const target = parseSpokenNumber(interimCandidate) || interimCandidate.replace(/\D/g, '');
            if (target && target !== lastProcessedTarget) {
              lastProcessedTarget = target;
              handleVoiceInputRef.current(interimCandidate);
            }
          }, 1600);
        }
      };

      rec.onerror = (e: any) => {
        const err = e?.error;
        if (err === 'no-speech' || err === 'aborted') {
          // Silent non-breaking handling of normal speech pauses and browser aborts
          return;
        }
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          isStopped = true;
          setIsVoiceActive(false);
          isVoiceActiveRef.current = false;
          setVoiceFeedback("Mic permission denied!");
          speakFeedback("Mic permission denied! Browser me mic allow karein.");
          return;
        }
      };

      rec.onend = () => {
        if (recognitionRef.current === rec) {
          recognitionRef.current = null;
        }
        if (!isStopped && isVoiceActiveRef.current) {
          setTimeout(() => {
            if (!isStopped && isVoiceActiveRef.current) {
              startRecInstance();
            }
          }, 300);
        }
      };

      try {
        rec.start();
      } catch {}
    };

    startRecInstance();

    return () => {
      isStopped = true;
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
        recognitionRef.current = null;
      }
    };
  }, [isVoiceActive, speakFeedback]);

  function selectBillNo(rowId: string, bn: string) {
    const bill = billMap.get(bn);
    const fullAmt = bill ? bill.billNetAmt : 0;
    setRows(prev => prev.map(r => r.id === rowId ? {
      ...r, billNo: bn,
      lineCutAmt: '',
      recAmt: fullAmt > 0 ? String(fullAmt) : '',
      showDropdown: false,
    } : r));
    setErrors(prev => { const n = { ...prev }; delete n[rowId]; return n; });
    // After state settles, find next empty row or add a new one and focus its bill input
    setTimeout(() => {
      const currentRows = rowsRef.current;
      const currentIdx = currentRows.findIndex(r => r.id === rowId);
      if (currentIdx === -1) return;
      
      const nextEmptyRow = currentRows.slice(currentIdx + 1).find(r => !r.billNo.trim());
      if (nextEmptyRow) {
        billInputRefs.current[nextEmptyRow.id]?.focus();
      } else {
        const newRow = makeRow();
        setRows(prev => [...prev, newRow]);
        setTimeout(() => billInputRefs.current[newRow.id]?.focus(), 40);
      }
    }, 40);
  }

  function handleRecChange(rowId: string, newRec: string) {
    const billForRow = billMap.get(rows.find(r => r.id === rowId)?.billNo || '');
    if (billForRow) {
      const recVal = parseAmountExpression(newRec);
      const newLc = Math.max(0, billForRow.billNetAmt - recVal);
      updateRow(rowId, {
        recAmt: newRec,
        lineCutAmt: newLc > 0 ? String(newLc) : ''
      });
    } else {
      updateRow(rowId, { recAmt: newRec });
    }
    setErrors(p => { const n = { ...p }; delete n[rowId]; return n; });
  }

  function handleLcChange(rowId: string, newLc: string) {
    const billForRow = billMap.get(rows.find(r => r.id === rowId)?.billNo || '');
    if (billForRow) {
      const lcVal = parseAmountExpression(newLc);
      const fullAmt = Math.max(0, billForRow.billNetAmt - lcVal);
      updateRow(rowId, {
        lineCutAmt: newLc,
        recAmt: fullAmt > 0 ? String(fullAmt) : (lcVal >= billForRow.billNetAmt ? '0' : '')
      });
    } else {
      updateRow(rowId, { lineCutAmt: newLc });
    }
  }

  function handleLcEnter(rowId: string) {
    const currentRows = rowsRef.current;
    const currentIdx = currentRows.findIndex(r => r.id === rowId);
    if (currentIdx === -1) return;
    const nextEmpty = currentRows.slice(currentIdx + 1).find(r => !r.billNo.trim());
    if (nextEmpty) {
      setTimeout(() => billInputRefs.current[nextEmpty.id]?.focus(), 20);
    } else {
      addRow();
    }
  }

  const existingBillNos = useMemo(() => rows.map(r => r.billNo).filter(Boolean), [rows]);

  // A row is valid if it has a billNo AND either recAmt > 0 (payment) OR lineCutAmt covers the full bill (FBR)
  const validRows = useMemo(() => rows.filter(r => {
    if (!r.billNo.trim()) return false;
    const rec = parseAmountExpression(r.recAmt);
    const lc  = parseAmountExpression(r.lineCutAmt);
    const bill = billMap.get(r.billNo);
    const isFbr = lc > 0 && rec === 0 && bill && lc >= bill.billNetAmt - 1;
    return rec > 0 || isFbr;
  }), [rows, billMap]);
  const canSave = validRows.length > 0;

  const totalRec = useMemo(() => validRows.reduce((s, r) => s + parseAmountExpression(r.recAmt), 0), [validRows]);

  // Global Escape & '+' listener to close modal or disambiguation dialog
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (disambigModal) {
          setDisambigModal(null);
        } else {
          onClose();
        }
        return;
      }
      if (e.key === '+' || e.code === 'NumpadAdd') {
        const target = e.target as HTMLElement | null;
        const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
        if (!isInput) {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [disambigModal, onClose]);

  async function handleSaveAll() {
    const role = getRole();
    if (role === 'user') {
      const perms = getUserPerm(getLoggedInName());
      if (!perms.canAdd) {
        setErrors({ _global: 'Aapko multi bill entries add karne ka right nahi hai!' });
        return;
      }
    }

    const newErrors: Record<string, string> = {};

    const toSave = rows.filter(r => r.billNo.trim());
    if (toSave.length === 0) { setErrors({ _global: 'Ek bhi bill add nahi kiya' }); return; }

    for (const r of toSave) {
      if (!billMap.has(r.billNo)) {
        newErrors[r.id] = 'Bill not found';
      } else {
        const rec = parseAmountExpression(r.recAmt);
        const lc  = parseAmountExpression(r.lineCutAmt);
        const bill = billMap.get(r.billNo)!;
        const isFbr = lc > 0 && rec === 0 && lc >= bill.billNetAmt - 1;
        if (!isFbr && rec <= 0) { newErrors[r.id] = 'Amount required'; }
      }
    }

    if (paymentMode === 'Cheque') {
      if (chequeNo.trim().length !== 6)  { newErrors['_cheque'] = 'Cheque no 6 digit compulsory'; }
      if (!bankName.trim() && getRole() !== 'driver')  { newErrors['_bank']   = 'Bank name required'; }
      if (!chequeDate.trim()){ newErrors['_chqdate'] = 'Cheque date required'; }
    }
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setSaving(true);
    setSaveError(null);
    let count = 0;
    let failed = 0;

    for (const r of toSave) {
      if (newErrors[r.id]) continue;
      const recAmt = parseAmountExpression(r.recAmt);
      const lc = parseAmountExpression(r.lineCutAmt);
      const bill = billMap.get(r.billNo);
      const isFbr = lc > 0 && recAmt === 0 && !!bill && lc >= bill.billNetAmt - 1;

      let ok = false;
      const forceRecDate = isoToDisplay(recDate) || null;

      if (isFbr) {
        // Line-cut-only (FBR) path — no cash collected, full line cut
        ok = await savePayment(
          r.billNo, 'FBR', null, 0,
          null,
          selectedDriver, dashDate,
          null, null, null,
          { cash: 0, upi: 0, cheque: 0 },
          lc,
          forceRecDate,
          getLoggedInName(),
        );
      } else {
        const splitDetails =
          paymentMode === 'Cash'   ? { cash: recAmt, upi: 0, cheque: 0 } :
          paymentMode === 'UPI'    ? { cash: 0, upi: recAmt, cheque: 0 } :
                                     { cash: 0, upi: 0, cheque: recAmt };

        ok = await savePayment(
          r.billNo, paymentMode, null, recAmt,
          null,
          selectedDriver, dashDate,
          chequeNo.trim() || null,
          bankName.trim() || null,
          null, splitDetails,
          lc > 0 ? lc : null,
          forceRecDate,
          getLoggedInName(),
          paymentMode === 'Cheque' ? (chequeDate.trim() || null) : null,
        );
      }
      if (ok) count++; else failed++;
    }

    setSavedCount(count);
    setSaving(false);

    if (failed > 0) {
      setSaveError(`${failed} bill(s) save nahi hue. Internet check karein aur dobara try karein.`);
      return;
    }

    setDone(true);
    onSaved();
    setTimeout(() => onClose(), 1800);
  }

  // ── Error screen ──────────────────────────────────────────────
  if (saveError) {
    return (
      <div className="fixed inset-0 bg-black/60 z-[300] flex items-start justify-center pt-4 p-4 backdrop-blur-sm">
        <div className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl border-2 border-red-500 text-center">
          <div className="w-14 h-14 bg-red-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <X className="w-7 h-7 text-white stroke-[3]" />
          </div>
          <p className="text-[11px] font-black text-red-600 uppercase tracking-widest">Save Failed</p>
          <p className="text-sm text-foreground mt-2">{saveError}</p>
          <button onClick={() => setSaveError(null)} className="mt-4 w-full bg-primary text-primary-foreground rounded-xl py-2 text-xs font-black uppercase tracking-widest">OK</button>
        </div>
      </div>
    );
  }

  // ── Success screen ────────────────────────────────────────────
  if (done) {
    return (
      <div className="fixed inset-0 bg-black/60 z-[300] flex items-start justify-center pt-4 p-4 backdrop-blur-sm">
        <div className="bg-card rounded-3xl p-8 w-full max-w-xs shadow-2xl border-2 border-emerald-500 text-center animate-in zoom-in-95">
          <div className="w-14 h-14 bg-emerald-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check className="w-7 h-7 text-white stroke-[3]" />
          </div>
          <p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest">Successfully Saved</p>
          <p className="text-2xl font-black text-foreground mt-1">{savedCount} Bills Paid</p>
          <p className="text-xs text-muted-foreground mt-1">
            ₹{totalRec.toLocaleString('en-IN')} · {paymentMode}
          </p>
        </div>
      </div>
    );
  }

  // ── Main modal ────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 bg-black/60 z-[300] flex flex-col justify-start backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-card w-full rounded-b-3xl shadow-2xl border-b border-border flex flex-col max-h-[96vh]">

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border shrink-0">
          <div>
            <h2 className="text-[11px] font-black uppercase text-foreground tracking-wider">Multi Bill Entry</h2>
            {selectedDriver && (
              <p className="text-[9px] font-bold text-primary uppercase mt-0.5">Driver: {selectedDriver}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={toggleVoice}
              title={isVoiceActive ? "Turn Mic Off" : "Turn Mic On"}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase transition-all border shadow-sm",
                isVoiceActive
                  ? "bg-red-600 text-white border-red-500 animate-pulse ring-2 ring-red-400"
                  : "bg-muted text-muted-foreground hover:bg-primary/10 hover:text-primary border-border"
              )}
            >
              {isVoiceActive ? <Mic className="w-3.5 h-3.5 animate-bounce text-white" /> : <MicOff className="w-3.5 h-3.5" />}
              <span>{isVoiceActive ? "MIC ON" : "MIC"}</span>
            </button>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-muted text-muted-foreground">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Voice Active Banner ── */}
        {isVoiceActive && (
          <div className="bg-red-50 border-b border-red-200 px-3 py-1.5 flex items-center justify-between text-[9px] font-black text-red-700 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="w-2 h-2 rounded-full bg-red-600 animate-ping shrink-0" />
              <span className="truncate">
                Mic Active — Searching {selectedDriver || 'Driver'} Bills (Speak last 3 digits)...
              </span>
            </div>
            {voiceFeedback && (
              <span className="bg-white border border-red-300 px-2 py-0.5 rounded-md text-[9px] font-bold text-red-800 shrink-0 ml-2 shadow-xs">
                {voiceFeedback}
              </span>
            )}
          </div>
        )}

        {/* ── Disambiguation Confirmation Modal for Multiple Matches ── */}
        {disambigModal && (
          <div className="fixed inset-0 bg-black/60 z-[400] flex items-start justify-center pt-4 sm:pt-6 p-4 backdrop-blur-xs overflow-y-auto">
            <div className="bg-card rounded-2xl p-4 w-full max-w-xs shadow-2xl border-2 border-primary animate-in zoom-in-95">
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-border">
                <div>
                  <p className="text-[11px] font-black uppercase text-primary">Confirm Bill Selection</p>
                  <p className="text-[9px] font-bold text-muted-foreground">Multiple bills match "{disambigModal.target}"</p>
                </div>
                <button onClick={() => setDisambigModal(null)} className="p-1 rounded-full text-muted-foreground hover:bg-muted">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <p className="text-[9px] font-bold text-foreground mb-2">
                Driver <span className="text-primary font-black">{selectedDriver || 'Selected'}</span> has {disambigModal.matches.length} bills matching "{disambigModal.target}". Which one to add?
              </p>

              <div className="space-y-1.5 max-h-52 overflow-y-auto">
                {disambigModal.matches.map(bill => (
                  <button
                    key={bill.billNo}
                    type="button"
                    onClick={() => {
                      addBillToRows(bill);
                      setDisambigModal(null);
                    }}
                    className="w-full text-left p-2.5 rounded-xl bg-primary/5 hover:bg-primary/20 border border-primary/20 transition-all flex items-center justify-between group"
                  >
                    <div className="min-w-0 pr-2">
                      <p className="text-[11px] font-black text-primary uppercase group-hover:scale-105 transition-transform">{bill.billNo}</p>
                      <p className="text-[8px] font-bold text-muted-foreground truncate">{bill.partyName || 'Party Name'}</p>
                    </div>
                    <p className="text-[10px] font-black text-emerald-600 shrink-0">₹{bill.billNetAmt.toLocaleString('en-IN')}</p>
                  </button>
                ))}
              </div>

              <div className="mt-3 text-center">
                <button
                  type="button"
                  onClick={() => setDisambigModal(null)}
                  className="text-[9px] font-bold text-muted-foreground hover:underline uppercase"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Payment Mode Row ── */}
        <div className="px-3 pt-2 pb-2 border-b border-border/50 bg-muted/20 shrink-0 space-y-1.5">
          {/* Rec Date picker — hidden for user role (always uses today) */}
          <div className="flex items-center gap-2">
            <CalendarDays className="w-3 h-3 text-muted-foreground shrink-0" />
            <span className="text-[9px] font-black text-muted-foreground uppercase">Rec Date:</span>
            {isUserRole ? (
              <span className="text-[9px] font-black text-primary bg-primary/10 px-2 py-1 rounded-lg">{isoToDisplay(recDate)} (TODAY)</span>
            ) : (
              <>
                <input
                  type="date"
                  value={recDate}
                  onChange={e => setRecDate(e.target.value)}
                  className="h-7 px-2 rounded-lg bg-card border border-border/60 text-[10px] font-black text-foreground outline-none focus:border-primary/60"
                />
                <span className="text-[9px] font-bold text-primary">{isoToDisplay(recDate)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[9px] font-black text-muted-foreground uppercase mr-1">Mode:</span>
            {(['Cash', 'UPI', 'Cheque'] as PaymentMode[]).map(m => (
              <button
                key={m}
                onClick={() => setPaymentMode(m)}
                className={cn(
                  "h-8 px-3 rounded-xl text-[10px] font-black uppercase transition-all border flex items-center gap-1.5",
                  paymentMode === m
                    ? m === 'Cash'   ? 'bg-emerald-600 text-white border-transparent shadow-md'
                      : m === 'UPI'  ? 'bg-blue-600 text-white border-transparent shadow-md'
                                     : 'bg-violet-600 text-white border-transparent shadow-md'
                    : "bg-card text-muted-foreground border-border hover:border-primary/40"
                )}
              >
                {m === 'Cash'   && <Wallet className="w-3 h-3" />}
                {m === 'UPI'    && <Smartphone className="w-3 h-3" />}
                {m === 'Cheque' && <Landmark className="w-3 h-3" />}
                {m === 'UPI' ? 'GPay / UPI' : m}
              </button>
            ))}

            {/* Summary chip */}
            {validRows.length > 0 && (
              <div className="ml-auto flex items-center gap-1.5 bg-emerald-50 border border-emerald-200 rounded-xl px-2.5 py-1">
                <span className="text-[9px] font-black text-emerald-700 uppercase">{validRows.length} bills</span>
                <span className="text-[10px] font-black text-emerald-700">₹{totalRec.toLocaleString('en-IN')}</span>
              </div>
            )}
          </div>

          {/* Cheque fields */}
          {paymentMode === 'Cheque' && (
            <div className="flex gap-1.5">
              <div className="relative flex-1">
                <Hash className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground pointer-events-none" />
                <input
                  ref={chequeNoRef}
                  type="text" inputMode="numeric" placeholder="CHQ NO *"
                  value={chequeNo}
                  onChange={e => { setChequeNo(e.target.value); setErrors(p => { const n = {...p}; delete n['_cheque']; return n; }); }}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); bankSelectRef.current?.focus(); } }}
                  className={cn("w-full h-8 pl-6 pr-2 bg-card rounded-lg text-[10px] font-black uppercase outline-none border", errors['_cheque'] ? 'border-destructive' : 'border-border/50')}
                />
              </div>
              <BankCombobox
                banks={banks}
                value={bankName}
                onChange={setBankName}
                inputRef={bankSelectRef}
                placeholder="BANK"
                onOpenChange={open => { bankDropdownOpenRef.current = open; }}
                onEnterKey={() => { const firstId = rows[0]?.id; if (firstId) billInputRefs.current[firstId]?.focus(); }}
                className="flex-1 h-8 px-2 bg-card rounded-lg text-[10px] font-black uppercase outline-none border border-border/50 text-foreground"
              />
              {(errors['_cheque'] || errors['_bank'] || errors['_chqdate']) && (
                <p className="text-[8px] font-black text-destructive uppercase self-center">
                  {errors['_cheque'] || errors['_bank'] || errors['_chqdate']}
                </p>
              )}
            </div>
          )}

          {errors['_global'] && (
            <p className="text-[9px] font-black text-destructive uppercase">{errors['_global']}</p>
          )}
        </div>

        {/* ── Table Header ── */}
        <div className="shrink-0 px-3 pt-2 pb-1">
          <div className="grid gap-1 items-center" style={{ gridTemplateColumns: '16px 1fr 1fr 72px 64px 24px' }}>
            <span className="text-[7px] font-black text-muted-foreground uppercase">#</span>
            <span className="text-[7px] font-black text-muted-foreground uppercase">Bill No</span>
            <span className="text-[7px] font-black text-muted-foreground uppercase">Party Name</span>
            <span className="text-[7px] font-black text-muted-foreground uppercase text-right">Rec Amt</span>
            <span className="text-[7px] font-black text-muted-foreground uppercase text-right">Line Cut</span>
            <span />
          </div>
          <div className="border-t border-border/30 mt-1" />
        </div>

        {/* ── Bill Rows — scrollable ── */}
        <div className="overflow-y-auto flex-1 px-3 pb-2 space-y-1">
          {rows.map((row, idx) => {
            const bill = billMap.get(row.billNo);
            const filteredNos = getFilteredBillNos(row.billNo, existingBillNos.filter(bn => bn !== row.billNo));
            const hasError = !!errors[row.id];
            const billAmt = bill ? bill.billNetAmt : 0;
            const lcNum = Number(row.lineCutAmt) || 0;
            const recNum = Number(row.recAmt) || 0;
            const isFullPay = bill && recNum > 0 && Math.abs((billAmt - lcNum) - recNum) <= 1;

            return (
              <div key={row.id} className={cn(
                "grid gap-1 items-center py-1.5 px-1 rounded-xl border transition-all",
                hasError ? 'border-destructive/50 bg-red-50/30' : bill ? 'border-primary/20 bg-primary/3' : 'border-border/30 bg-card',
              )} style={{ gridTemplateColumns: '16px 1fr 1fr 72px 64px 24px' }}>

                {/* # */}
                <span className="text-[8px] font-black text-muted-foreground text-center">{idx + 1}</span>

                {/* Bill No search */}
                <div className="relative">
                  <input
                    ref={el => { billInputRefs.current[row.id] = el; }}
                    type="text" inputMode="numeric" placeholder="BILL NO"
                    value={row.billNo}
                    onChange={e => {
                      updateRow(row.id, { billNo: e.target.value, showDropdown: true, dropdownIdx: 0 });
                      setErrors(p => { const n = {...p}; delete n[row.id]; return n; });
                    }}
                    onFocus={() => updateRow(row.id, { showDropdown: !!row.billNo })}
                    onBlur={() => setTimeout(() => updateRow(row.id, { showDropdown: false }), 150)}
                    onKeyDown={e => {
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        updateRow(row.id, { dropdownIdx: Math.min(row.dropdownIdx + 1, filteredNos.length - 1), showDropdown: true });
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        updateRow(row.id, { dropdownIdx: Math.max(row.dropdownIdx - 1, 0), showDropdown: true });
                      } else if (e.key === 'Enter') {
                        e.preventDefault();
                        const typed = row.billNo.trim();
                        if (!typed) {
                          const currentRows = rowsRef.current;
                          const currentIdx = currentRows.findIndex(r => r.id === row.id);
                          const nextEmpty = currentRows.slice(currentIdx + 1).find(r => !r.billNo.trim());
                          if (nextEmpty) {
                            billInputRefs.current[nextEmpty.id]?.focus();
                          } else {
                            addRow();
                          }
                          return;
                        }

                        // 1. Exact match in billMap
                        if (billMap.has(typed)) {
                          selectBillNo(row.id, typed);
                          return;
                        }

                        // 2. Dropdown open with highlighted item
                        if (filteredNos.length > 0 && row.showDropdown && filteredNos[row.dropdownIdx]) {
                          selectBillNo(row.id, filteredNos[row.dropdownIdx]);
                          return;
                        }

                        // 3. First suggestion
                        if (filteredNos.length > 0) {
                          selectBillNo(row.id, filteredNos[0]);
                          return;
                        }

                        // 4. Case-insensitive / prefix / suffix match
                        const cleanT = typed.toUpperCase().replace(/[^A-Z0-9]/g, '');
                        const stripT = cleanT.replace(/^GST/i, '').replace(/^MOC/i, '');
                        const pool = driverBills.length > 0 ? driverBills : bills;

                        const matchedBill = pool.find(b => {
                          const cb = b.billNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
                          const sb = cb.replace(/^GST/i, '').replace(/^MOC/i, '');
                          return cb === cleanT || sb === stripT || sb.endsWith(stripT) || cb.endsWith(cleanT);
                        }) || bills.find(b => {
                          const cb = b.billNo.toUpperCase().replace(/[^A-Z0-9]/g, '');
                          const sb = cb.replace(/^GST/i, '').replace(/^MOC/i, '');
                          return cb === cleanT || sb === stripT || sb.endsWith(stripT) || cb.endsWith(cleanT);
                        });

                        if (matchedBill) {
                          selectBillNo(row.id, matchedBill.billNo);
                        } else if (billMap.has(row.billNo)) {
                          selectBillNo(row.id, row.billNo);
                        } else {
                          setErrors(p => ({ ...p, [row.id]: 'Bill nahi mila' }));
                        }
                      } else if (e.key === 'Escape') {
                        updateRow(row.id, { showDropdown: false });
                      }
                    }}
                    className={cn(
                      "w-full h-8 px-2 rounded-lg text-[10px] font-black uppercase outline-none border",
                      hasError ? 'bg-red-50 border-destructive' : bill ? 'bg-primary/5 border-primary/30 text-primary' : 'bg-muted/50 border-border/30'
                    )}
                  />
                  {/* Dropdown */}
                  {row.showDropdown && filteredNos.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-0.5 bg-card border border-border rounded-xl shadow-2xl max-h-48 overflow-auto z-50">
                      {filteredNos.map((bn, di) => {
                        const b = billMap.get(bn);
                        const isPaid = (b?.collectedAmount || 0) > 0 || !!b?.paymentDate || b?.paymentMode === 'FBR';
                        return (
                          <button
                            key={bn}
                            onMouseDown={() => selectBillNo(row.id, bn)}
                            className={cn("w-full text-left px-2 py-1.5 border-b border-border/20 last:border-0", row.dropdownIdx === di ? 'bg-primary text-primary-foreground' : 'hover:bg-primary/5')}
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className={cn("text-[10px] font-black uppercase", row.dropdownIdx === di ? 'text-primary-foreground' : '')}>{bn}</span>
                              <div className="flex items-center gap-1 shrink-0">
                                {isPaid && <span className="text-[7px] font-black bg-emerald-100 text-emerald-700 px-1 rounded-full">PAID</span>}
                                <span className={cn("text-[9px] font-black", row.dropdownIdx === di ? 'text-primary-foreground/80' : 'text-primary')}>₹{(b?.billNetAmt || 0).toLocaleString('en-IN')}</span>
                              </div>
                            </div>
                            {b?.partyName && <p className={cn("text-[8px] truncate", row.dropdownIdx === di ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{b.partyName}</p>}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {hasError && <p className="text-[7px] font-black text-destructive mt-0.5 uppercase">{errors[row.id]}</p>}
                </div>

                {/* Party Name (read-only, auto-filled) */}
                <div className="px-1 min-w-0">
                  {bill ? (
                    <p className="text-[9px] font-bold text-foreground truncate leading-tight">{bill.partyName}</p>
                  ) : (
                    <p className="text-[9px] text-muted-foreground/40">—</p>
                  )}
                  {bill && (
                    <p className="text-[7px] font-black text-muted-foreground">
                      Amt: ₹{bill.billNetAmt.toLocaleString('en-IN')}
                      {isFullPay && <span className="ml-1 text-emerald-600">✓Full</span>}
                    </p>
                  )}
                </div>

                {/* Rec Amt */}
                <input
                  ref={el => { recAmtRefs.current[row.id] = el; }}
                  type="text" inputMode="decimal" placeholder="0"
                  value={row.recAmt}
                  onChange={e => handleRecChange(row.id, e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); lcRefs.current[row.id]?.focus(); }
                  }}
                  className={cn(
                    "h-8 px-2 rounded-lg text-[10px] font-black outline-none border text-right w-full",
                    recNum > 0 && isFullPay ? 'bg-emerald-50 border-emerald-300 text-emerald-700' : 'bg-muted/50 border-border/30'
                  )}
                />

                {/* Line Cut */}
                <input
                  ref={el => { lcRefs.current[row.id] = el; }}
                  type="text" inputMode="decimal" placeholder="0"
                  value={row.lineCutAmt}
                  onChange={e => handleLcChange(row.id, e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleLcEnter(row.id); } }}
                  className="h-8 px-2 bg-amber-50 rounded-lg text-[10px] font-black outline-none border border-amber-200 text-right w-full"
                />

                {/* Delete */}
                <button onClick={() => removeRow(row.id)} className="flex items-center justify-center p-1 rounded text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            );
          })}

          {/* Add row */}
          <button
            onClick={addRow}
            className="w-full h-8 border border-dashed border-border rounded-xl flex items-center justify-center gap-1.5 text-[9px] font-black uppercase text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors mt-1"
          >
            <Plus className="w-3 h-3" /> Bill Add Karo
          </button>
        </div>

        {/* ── Footer ── */}
        <div className="px-3 pb-5 pt-2 border-t border-border bg-card shrink-0">
          {/* Summary bar */}
          {validRows.length > 0 && (
            <div className={cn(
              "flex items-center justify-between rounded-xl px-3 py-2 mb-2",
              paymentMode === 'Cash' ? 'bg-emerald-50 border border-emerald-200'
              : paymentMode === 'UPI' ? 'bg-blue-50 border border-blue-200'
              : 'bg-violet-50 border border-violet-200'
            )}>
              <div>
                <p className="text-[8px] font-black text-muted-foreground uppercase">Total Collection</p>
                <p className={cn("text-base font-black",
                  paymentMode === 'Cash' ? 'text-emerald-700'
                  : paymentMode === 'UPI' ? 'text-blue-700'
                  : 'text-violet-700'
                )}>₹{totalRec.toLocaleString('en-IN')}</p>
              </div>
              <div className="text-right">
                <p className="text-[8px] font-black text-muted-foreground uppercase">Bills</p>
                <p className="text-base font-black text-foreground">{validRows.length}</p>
              </div>
              <div className={cn(
                "text-[10px] font-black uppercase px-3 py-1 rounded-full",
                paymentMode === 'Cash' ? 'bg-emerald-100 text-emerald-700'
                : paymentMode === 'UPI' ? 'bg-blue-100 text-blue-700'
                : 'bg-violet-100 text-violet-700'
              )}>
                {paymentMode === 'UPI' ? 'GPay/UPI' : paymentMode}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} className="h-10 px-4 rounded-xl font-black uppercase text-[10px]">
              Cancel
            </Button>
            <Button
              onClick={handleSaveAll}
              disabled={saving || !canSave}
              className={cn(
                "flex-1 h-10 rounded-xl font-black uppercase text-[10px] transition-all",
                canSave
                  ? paymentMode === 'Cash'   ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-md'
                    : paymentMode === 'UPI'  ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-md'
                                             : 'bg-violet-600 hover:bg-violet-700 text-white shadow-md'
                  : 'opacity-40 cursor-not-allowed'
              )}
            >
              {saving
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />Saving...</>
                : <><Check className="w-3.5 h-3.5 mr-1.5" />Save {validRows.length} Bills — {paymentMode === 'UPI' ? 'GPay/UPI' : paymentMode}</>
              }
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
