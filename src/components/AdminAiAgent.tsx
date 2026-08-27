import React, { useState, useRef } from 'react';
import {
  Bot, Sparkles, Search, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw,
  Database, ShieldAlert, Zap, Mic, MicOff, Key, Volume2, FileSpreadsheet,
  Upload, X, Check, FileCheck, Layers, Calendar, DollarSign, Ban, Clock
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { patchBillsInMemory, getBills } from '@/lib/billStore';

type MatchedBill = {
  id: string;
  billNo: string;
  partyName: string;
  driverName: string;
  billNetAmt: number;
  collectedAmount: number;
  lineCutAmt: number;
  diff: number;
  currentStatus: string;
  proposedStatus: string;
  proposedMethod?: string;
  proposedDate?: string;
  changes: Record<string, any>;
};

type AgentResponse = {
  ok: boolean;
  explanation?: string;
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedBillNos?: string[];
  matchedBills?: MatchedBill[];
  isWriteIntent?: boolean;
  proposedActionText?: string;
  patches?: Array<{ id: string; billNo: string; changes: Record<string, any> }>;
  error?: string;
};

export function AdminAiAgent() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  // XLS File Upload state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractedBillNos, setExtractedBillNos] = useState<string[]>([]);
  const [extractedRows, setExtractedRows] = useState<any[]>([]);
  const [showAllExtractedBills, setShowAllExtractedBills] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Gemini API Key state
  const [geminiApiKey, setGeminiApiKey] = useState(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('gemini_api_key') || '';
    }
    return '';
  });
  const [showKeyInput, setShowKeyInput] = useState(false);

  // Voice Command / Speech Recognition state
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const samplePrompts = [
    "Ye sabhi bills no ko paid karo cash me aaj ki date me",
    "In sabhi bills ko FBR mark karo reason Damage ke sath",
    "Sabhi bills ko Credit / Del pending mark karo",
    "Ese bills find karo jis me REC me amt add he fir bhi FBR show kar raha he",
    "Jo bill me REC amt he or diff 0 he vah sab me status Paid karo",
  ];

  function saveApiKey(key: string) {
    setGeminiApiKey(key);
    if (typeof window !== 'undefined') {
      if (key.trim()) {
        localStorage.setItem('gemini_api_key', key.trim());
      } else {
        localStorage.removeItem('gemini_api_key');
      }
    }
  }

  // ── Handle XLS / XLSX File Upload & Parsing ──
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const data = await file.arrayBuffer();
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!json || json.length === 0) {
        alert('File is empty or could not be parsed.');
        setLoading(false);
        return;
      }

      // Auto-detect Bill No column
      const firstRow = json[0];
      const keys = Object.keys(firstRow);
      
      let billNoKey = keys.find(k => {
        const clean = k.toLowerCase().replace(/[^a-z0-9]/g, '');
        return clean.includes('billno') || clean.includes('billrefno') || clean.includes('billnum') || 
               clean.includes('invoiceno') || clean.includes('docno') || clean.includes('bill');
      });

      // If no explicit header matches, check column 0 or 1
      if (!billNoKey && keys.length > 0) {
        billNoKey = keys[0];
      }

      const bnsSet = new Set<string>();
      const rowsData: any[] = [];

      for (const row of json) {
        let val = '';
        if (billNoKey && row[billNoKey] !== undefined && row[billNoKey] !== '') {
          val = String(row[billNoKey]).trim();
        } else {
          // Fallback search across all row values for a bill-like value
          for (const k of keys) {
            const v = String(row[k] || '').trim();
            if (v && (v.toUpperCase().startsWith('GST') || v.toUpperCase().startsWith('MOC') || /^\d{4,}$/.test(v))) {
              val = v;
              break;
            }
          }
        }

        if (val && val !== '0' && val.toLowerCase() !== 'total' && val.toLowerCase() !== 'bill no') {
          bnsSet.add(val);
          rowsData.push(row);
        }
      }

      const billList = Array.from(bnsSet);
      if (billList.length === 0) {
        alert('Koi valid Bill No column nahi mila. Kripya XLS file check karein.');
        setLoading(false);
        return;
      }

      setUploadedFileName(file.name);
      setExtractedBillNos(billList);
      setExtractedRows(rowsData);
      setPrompt(prev => prev || `Ye XLS ke sabhi ${billList.length} bills ko Paid karo Cash me (Full collection amount ke sath)`);
      
      // Auto-trigger analysis for the uploaded bills
      setTimeout(() => {
        handleAnalyze(`Ye uploaded XLS ke sabhi bills ko Paid karo Cash me full amount ke sath`, billList, rowsData);
      }, 100);

    } catch (err: any) {
      console.error('Error reading XLS file:', err);
      alert('Error reading XLS file: ' + (err.message || String(err)));
      setLoading(false);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleClearFile() {
    setUploadedFileName(null);
    setExtractedBillNos([]);
    setExtractedRows([]);
    setResponse(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function toggleVoiceCommand() {
    if (isListening) {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      setIsListening(false);
      return;
    }

    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Voice command is not supported in this browser. Please try Google Chrome, Edge, or Brave.');
      return;
    }

    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          stream.getTracks().forEach(track => track.stop());
        } catch (mErr: any) {
          alert('Microphone permission denied or unavailable: ' + (mErr.message || 'Access blocked'));
          return;
        }
      }

      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = true;
      recognition.lang = 'hi-IN'; // Hindi / Hinglish

      recognition.onstart = () => {
        setIsListening(true);
      };

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result: any) => result.transcript)
          .join('');
        setPrompt(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
        if (event.error === 'not-allowed') {
          alert('Microphone permission is blocked in browser settings. Please allow mic permission for this site.');
        }
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to start voice recognition:', err);
      setIsListening(false);
      alert('Could not start microphone: ' + (err.message || String(err)));
    }
  }

  // ── Helper NLP & Local Rules Engine for Instant Analysis without Large Body Bottlenecks ──
  function runLocalAnalysis(queryText: string, targetBillNos: string[], aiParsed?: any): AgentResponse {
    const allBills = getBills ? getBills() : [];
    const hasXlsBills = targetBillNos.length > 0;
    const now = new Date();
    const todayDMY = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

    const rawLower = (queryText || '').toLowerCase();
    const writeVerbs = ['karo', 'set', 'update', 'badlo', 'change', 'maro', 'kijiye', 'mark', 'kar do', 'bharo', 'paid', 'fbr', 'credit', 'jama', 'unpaid'];
    const hasWriteVerb = writeVerbs.some(w => rawLower.includes(w)) || hasXlsBills;

    let isWriteIntent = aiParsed?.isWriteIntent !== undefined ? Boolean(aiParsed.isWriteIntent) : hasWriteVerb;
    let targetPaymentMode = aiParsed?.targetPaymentMode || '';
    let targetPaymentMethod = aiParsed?.targetPaymentMethod || '';
    let targetDate = aiParsed?.targetDate || '';
    let discrepancyReason = aiParsed?.discrepancyReason || '';
    let searchKeyword = aiParsed?.searchKeyword || '';
    let filterRule = hasXlsBills ? 'XLS_BILLS' : 'CUSTOM';

    // Heuristic mode detection
    if (!targetPaymentMode) {
      if (rawLower.includes('fbr') || rawLower.includes('cancel') || rawLower.includes('return') || rawLower.includes('damage')) {
        targetPaymentMode = 'FBR';
        if (!discrepancyReason) discrepancyReason = 'Goods Return / Damage';
      } else if (rawLower.includes('credit') || rawLower.includes('del pending') || rawLower.includes('pending')) {
        targetPaymentMode = 'Del Pending';
      } else if (rawLower.includes('unpaid') || rawLower.includes('reset')) {
        targetPaymentMode = 'Unpaid';
      } else if (rawLower.includes('paid') || rawLower.includes('jama') || rawLower.includes('cash') || rawLower.includes('upi') || rawLower.includes('cheque') || hasXlsBills) {
        targetPaymentMode = 'Paid';
      }
    }

    // Heuristic method detection
    if (!targetPaymentMethod && targetPaymentMode === 'Paid') {
      if (rawLower.includes('upi') || rawLower.includes('online') || rawLower.includes('gpay') || rawLower.includes('phonepe') || rawLower.includes('scanner') || rawLower.includes('qr')) {
        targetPaymentMethod = 'UPI';
      } else if (rawLower.includes('cheque') || rawLower.includes('check') || rawLower.includes('bank') || rawLower.includes('rtgs')) {
        targetPaymentMethod = 'Cheque';
      } else {
        targetPaymentMethod = 'Cash';
      }
    }

    // Heuristic date detection (e.g. 25/08/2026 or 25-08-2026)
    if (!targetDate) {
      const dateMatch = queryText.match(/\b(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})\b/);
      if (dateMatch) {
        const parts = dateMatch[1].replace(/[-.]/g, '/').split('/');
        if (parts.length === 3) {
          targetDate = `${parts[0].padStart(2, '0')}/${parts[1].padStart(2, '0')}/${parts[2].length === 2 ? '20' + parts[2] : parts[2]}`;
        }
      }
    }
    if (!targetDate) targetDate = todayDMY;

    if (!hasXlsBills) {
      if (rawLower.includes('fbr') && (rawLower.includes('rec') || rawLower.includes('collected') || rawLower.includes('amt') || rawLower.includes('amount') || rawLower.includes('jama'))) {
        filterRule = 'REC_AMT_WITH_FBR';
        if (hasWriteVerb || rawLower.includes('paid')) isWriteIntent = true;
        if (!targetPaymentMode) targetPaymentMode = 'Paid';
        if (!targetPaymentMethod) targetPaymentMethod = 'Cash';
      } else if ((rawLower.includes('diff') || rawLower.includes('difference')) && (rawLower.includes('0') || rawLower.includes('zero') || rawLower.includes('nil'))) {
        filterRule = 'DIFF_ZERO_UNPAID';
        isWriteIntent = true;
        targetPaymentMode = 'Paid';
        targetPaymentMethod = 'Cash';
      }
    }

    // Build Bill Number Lookup Index for ultra fast and fuzzy matching
    const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stripGst = (s: string) => cleanBn(s).replace(/^GST/i, '').replace(/^MOC/i, '');

    const billMapByClean = new Map<string, any>();
    const billMapByStripped = new Map<string, any>();
    for (const b of allBills) {
      const c = cleanBn(b.billNo);
      if (c) billMapByClean.set(c, b);
      const st = stripGst(b.billNo);
      if (st) billMapByStripped.set(st, b);
    }

    const matchedBills: MatchedBill[] = [];
    const patches: Array<{ id: string; billNo: string; changes: Record<string, any> }> = [];
    const matchedBillIds = new Set<string>();
    const unmatchedBillNos: string[] = [];

    if (hasXlsBills) {
      // ── Process Uploaded XLS Bill Numbers ──
      for (const rawBn of targetBillNos) {
        const c = cleanBn(rawBn);
        const st = stripGst(rawBn);
        const bill = billMapByClean.get(c) || billMapByStripped.get(st) || billMapByStripped.get(c);

        if (!bill) {
          unmatchedBillNos.push(String(rawBn));
          continue;
        }

        if (matchedBillIds.has(bill.id)) continue;
        matchedBillIds.add(bill.id);

        const netAmt = Number(bill.billNetAmt) || 0;
        const lc = Number(bill.lineCutAmt) || 0;
        const effectiveNet = Math.max(0, netAmt - lc);
        const curMode = String(bill.paymentMode || 'Unpaid').trim();

        let patchChanges: Record<string, any> = {};

        if (isWriteIntent && targetPaymentMode) {
          if (targetPaymentMode === 'Paid') {
            const method = targetPaymentMethod || 'Cash';
            patchChanges = {
              paymentMode: 'Paid',
              paymentMethod: method,
              paymentDate: targetDate || todayDMY,
              collectedAmount: effectiveNet,
              outstandingAmount: 0,
              cashAmount: method === 'Cash' ? effectiveNet : 0,
              upiAmount: method === 'UPI' ? effectiveNet : 0,
              chequeAmount: method === 'Cheque' ? effectiveNet : 0,
            };
          } else if (targetPaymentMode === 'FBR') {
            patchChanges = {
              paymentMode: 'FBR',
              paymentMethod: 'FBR',
              paymentDate: targetDate || todayDMY,
              discrepancyReason: discrepancyReason || 'Goods Return / Damage',
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: 0,
            };
          } else if (targetPaymentMode === 'Del Pending' || targetPaymentMode === 'Credit') {
            patchChanges = {
              paymentMode: targetPaymentMode === 'Del Pending' ? 'Del Pending' : 'Credit',
              deliveryDate: targetDate || bill.deliveryDate || todayDMY,
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: effectiveNet,
            };
          } else if (targetPaymentMode === 'Unpaid') {
            patchChanges = {
              paymentMode: 'Unpaid',
              collectedAmount: 0,
              cashAmount: 0,
              upiAmount: 0,
              chequeAmount: 0,
              outstandingAmount: effectiveNet,
            };
          }
        }

        matchedBills.push({
          id: bill.id,
          billNo: bill.billNo,
          partyName: bill.partyName || '',
          driverName: bill.driverName || '',
          billNetAmt: netAmt,
          collectedAmount: patchChanges.collectedAmount !== undefined ? patchChanges.collectedAmount : (Number(bill.collectedAmount) || 0),
          lineCutAmt: lc,
          diff: patchChanges.outstandingAmount !== undefined ? patchChanges.outstandingAmount : Math.max(0, netAmt - lc - (Number(bill.collectedAmount) || 0)),
          currentStatus: curMode,
          proposedStatus: patchChanges.paymentMode || curMode,
          proposedMethod: patchChanges.paymentMethod || bill.paymentMethod || '-',
          proposedDate: patchChanges.paymentDate || patchChanges.deliveryDate || bill.paymentDate || bill.deliveryDate || '-',
          changes: patchChanges,
        });

        if (Object.keys(patchChanges).length > 0) {
          patches.push({
            id: bill.id,
            billNo: bill.billNo,
            changes: patchChanges,
          });
        }
      }
    } else {
      // ── Process Natural Language DB Query / Filter ──
      for (const b of allBills) {
        const netAmt = Number(b.billNetAmt) || 0;
        const recAmt = Number(b.collectedAmount) || 0;
        const lc = Number(b.lineCutAmt) || 0;
        const diff = Math.max(0, netAmt - lc - recAmt);
        const curMode = String(b.paymentMode || 'Unpaid').trim();

        let isMatch = false;
        let patchChanges: Record<string, any> = {};

        if (filterRule === 'REC_AMT_WITH_FBR') {
          if (recAmt > 0 && (curMode.toUpperCase() === 'FBR' || curMode.toUpperCase() === 'CANCEL' || curMode.toUpperCase() === 'UNPAID')) {
            isMatch = true;
            if (isWriteIntent) {
              patchChanges = {
                paymentMode: 'Paid',
                paymentMethod: targetPaymentMethod || 'Cash',
                paymentDate: targetDate || todayDMY,
                cashAmount: (targetPaymentMethod === 'Cash' || !targetPaymentMethod) ? recAmt : 0,
                upiAmount: targetPaymentMethod === 'UPI' ? recAmt : 0,
                chequeAmount: targetPaymentMethod === 'Cheque' ? recAmt : 0,
                outstandingAmount: Math.max(0, netAmt - lc - recAmt),
              };
            }
          }
        } else if (filterRule === 'DIFF_ZERO_UNPAID') {
          if ((recAmt + lc >= netAmt - 1) && curMode !== 'Paid') {
            isMatch = true;
            if (isWriteIntent) {
              patchChanges = {
                paymentMode: 'Paid',
                paymentMethod: targetPaymentMethod || 'Cash',
                paymentDate: targetDate || todayDMY,
                collectedAmount: Math.max(recAmt, netAmt - lc),
                cashAmount: (targetPaymentMethod === 'Cash' || !targetPaymentMethod) ? Math.max(recAmt, netAmt - lc) : 0,
                outstandingAmount: 0,
              };
            }
          }
        } else {
          // Custom search by keywords
          const searchStr = `${b.billNo} ${b.partyName} ${b.driverName} ${b.salespersonName} ${curMode}`.toLowerCase();
          const keywords = queryText.toLowerCase()
            .replace(/karo|set|update|badlo|dikhao|batao|sab|sabhi|me|status|bill|bills|aaj|date|ko/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 2);

          let keywordMatch = false;
          if (searchKeyword && searchStr.includes(searchKeyword.toLowerCase())) {
            keywordMatch = true;
          } else if (keywords.length > 0 && keywords.some(k => searchStr.includes(k))) {
            keywordMatch = true;
          } else if (isWriteIntent && keywords.length === 0) {
            if (curMode !== 'Paid') keywordMatch = true;
          }

          if (keywordMatch) {
            isMatch = true;
            if (isWriteIntent && targetPaymentMode) {
              const effectiveNet = Math.max(0, netAmt - lc);
              if (targetPaymentMode === 'Paid') {
                const method = targetPaymentMethod || 'Cash';
                patchChanges = {
                  paymentMode: 'Paid',
                  paymentMethod: method,
                  paymentDate: targetDate || todayDMY,
                  collectedAmount: effectiveNet,
                  outstandingAmount: 0,
                  cashAmount: method === 'Cash' ? effectiveNet : 0,
                  upiAmount: method === 'UPI' ? effectiveNet : 0,
                  chequeAmount: method === 'Cheque' ? effectiveNet : 0,
                };
              } else if (targetPaymentMode === 'FBR') {
                patchChanges = {
                  paymentMode: 'FBR',
                  paymentMethod: 'FBR',
                  paymentDate: targetDate || todayDMY,
                  discrepancyReason: discrepancyReason || 'Goods Return / Damage',
                  collectedAmount: 0,
                  cashAmount: 0,
                  upiAmount: 0,
                  chequeAmount: 0,
                  outstandingAmount: 0,
                };
              } else if (targetPaymentMode === 'Del Pending' || targetPaymentMode === 'Credit') {
                patchChanges = {
                  paymentMode: targetPaymentMode === 'Del Pending' ? 'Del Pending' : 'Credit',
                  deliveryDate: targetDate || todayDMY,
                  collectedAmount: 0,
                  outstandingAmount: effectiveNet,
                };
              }
            }
          }
        }

        if (isMatch) {
          matchedBills.push({
            id: b.id,
            billNo: b.billNo,
            partyName: b.partyName || '',
            driverName: b.driverName || '',
            billNetAmt: netAmt,
            collectedAmount: patchChanges.collectedAmount !== undefined ? patchChanges.collectedAmount : recAmt,
            lineCutAmt: lc,
            diff,
            currentStatus: curMode,
            proposedStatus: patchChanges.paymentMode || curMode,
            proposedMethod: patchChanges.paymentMethod || b.paymentMethod || '-',
            proposedDate: patchChanges.paymentDate || patchChanges.deliveryDate || b.paymentDate || b.deliveryDate || '-',
            changes: patchChanges,
          });

          if (Object.keys(patchChanges).length > 0) {
            patches.push({
              id: b.id,
              billNo: b.billNo,
              changes: patchChanges,
            });
          }
        }
      }
    }

    let explanation = aiParsed?.explanation || '';
    if (!explanation) {
      if (hasXlsBills) {
        explanation = `Uploaded XLS file me se ${targetBillNos.length} Bill Numbers mile, jisme se ${matchedBills.length} bills database me match hue. Target: '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}), Date: ${targetDate || todayDMY}.`;
      } else if (filterRule === 'REC_AMT_WITH_FBR') {
        explanation = `Ese ${matchedBills.length} bills mile jisme Collected Amount (> 0) hai par status FBR/Cancel show ho raha hai.`;
      } else if (filterRule === 'DIFF_ZERO_UNPAID') {
        explanation = `Ese ${matchedBills.length} bills mile jinka Collected Amount + Line Cut total Net Amount ke barabar hai (Diff = 0), par status Paid nahi hai.`;
      } else {
        explanation = `Aapke command ke mutabiq ${matchedBills.length} matching bills analyze hue.`;
      }
    }

    const proposedActionText = isWriteIntent && patches.length > 0
      ? `${patches.length} bills ka status '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}), Rec Date: '${targetDate || todayDMY}', Cash/Collection Amount = Net Amount update karne ka proposal tayar hai.`
      : `Filter result (${matchedBills.length} bills found).`;

    return {
      ok: true,
      explanation,
      matchedCount: matchedBills.length,
      unmatchedCount: unmatchedBillNos.length,
      unmatchedBillNos,
      matchedBills,
      isWriteIntent,
      proposedActionText,
      patches,
    };
  }

  async function handleAnalyze(customPrompt?: string, customBillNos?: string[], customRows?: any[]) {
    const queryText = customPrompt !== undefined ? customPrompt : prompt;
    const targetBillNos = customBillNos || extractedBillNos;

    if (!queryText.trim() && targetBillNos.length === 0) return;

    setLoading(true);
    setResultMessage(null);

    try {
      let aiParsed: any = null;

      // 1. Try lightweight Gemini Intent parsing via backend (sends ONLY the prompt string, NO 40MB body)
      try {
        const res = await fetch('/api/admin/ai-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(geminiApiKey.trim() ? { 'x-gemini-api-key': geminiApiKey.trim() } : {}),
          },
          body: JSON.stringify({
            action: 'parse-intent',
            prompt: queryText,
            apiKey: geminiApiKey.trim() || undefined,
          }),
        });

        // Safe text reading to prevent "<!doctype" JSON syntax errors
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          const json = JSON.parse(text);
          if (json?.ok && json?.parsed) {
            aiParsed = json.parsed;
          }
        }
      } catch (networkOrParseErr) {
        console.warn('[AdminAiAgent] Server intent parse fallback to local rules:', networkOrParseErr);
      }

      // 2. Execute instant local matching against bills in memory
      const result = runLocalAnalysis(queryText, targetBillNos, aiParsed);
      setResponse(result);
    } catch (err: any) {
      console.error('[AdminAiAgent handleAnalyze Error]', err);
      // Fallback to local rule engine so user never gets stuck
      try {
        const fallbackResult = runLocalAnalysis(queryText, targetBillNos);
        setResponse(fallbackResult);
      } catch (fbErr: any) {
        setResponse({ ok: false, error: fbErr.message || 'Failed to process command' });
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleExecutePatches() {
    if (!response || !response.patches || response.patches.length === 0) return;

    setExecuting(true);
    try {
      // 1. Update in-memory bills + IndexedDB + LocalStorage + Supabase instantly
      const memPatches = response.patches.map(p => ({
        billNo: p.billNo,
        patch: p.changes,
      }));
      await patchBillsInMemory(memPatches);

      // 2. Asynchronously notify backend server for PostgreSQL sync (safely handled)
      try {
        const res = await fetch('/api/admin/ai-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(geminiApiKey.trim() ? { 'x-gemini-api-key': geminiApiKey.trim() } : {}),
          },
          body: JSON.stringify({
            action: 'execute',
            patches: response.patches,
            apiKey: geminiApiKey.trim() || undefined,
          }),
        });
        const text = await res.text();
        if (text && text.trim().startsWith('{')) {
          JSON.parse(text);
        }
      } catch (serverDbErr) {
        console.warn('[AdminAiAgent] Backend DB notification note:', serverDbErr);
      }

      setResultMessage(`✅ ${response.patches.length} bills successfully updated! (Payment Mode, Rec Date, Cash & Collection Amounts Saved across App Memory & Database)`);
      setShowConfirm(false);
      
      // Refresh analysis to reflect updated states
      handleAnalyze();
    } catch (err: any) {
      alert(`Execution error: ${err.message || String(err)}`);
    } finally {
      setExecuting(false);
    }
  }

  return (
    <div className="bg-card border-2 border-primary/20 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4 my-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-3 border-b border-border/60 flex-wrap gap-2">
        <div className="flex items-center gap-2.5">
          <div className="p-2.5 rounded-xl bg-primary/10 text-primary border border-primary/20 shadow-xs">
            <Bot className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase text-foreground tracking-wider">
                Admin Database AI Agent & XLS Engine
              </h2>
              <span className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                <Sparkles className="w-2.5 h-2.5" /> GEMINI 2.5 FLASH
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">
              XLS Upload karke ya Voice/Text Command dekar bills ko Paid (Cash/UPI/Cheque), FBR, ya Credit me update karo. Full Database Access!
            </p>
          </div>
        </div>

        {/* Gemini API Key Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowKeyInput(!showKeyInput)}
            className={cn(
              "text-[10px] font-extrabold px-2.5 py-1 rounded-lg border transition-all flex items-center gap-1.5",
              geminiApiKey.trim()
                ? "bg-emerald-500/10 text-emerald-600 border-emerald-300 dark:border-emerald-800"
                : "bg-muted text-muted-foreground border-border hover:bg-accent"
            )}
            title="Configure Custom Gemini API Key"
          >
            <Key className="w-3.5 h-3.5 text-amber-500" />
            {geminiApiKey.trim() ? "Custom API Key Active" : "Set Gemini API Key"}
          </button>
        </div>
      </div>

      {/* ── Gemini API Key Input Panel ── */}
      {showKeyInput && (
        <div className="bg-muted/50 border border-primary/20 rounded-xl p-3 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-500" /> Enter Gemini API Key:
            </label>
            {geminiApiKey && (
              <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold">
                ✓ Saved in Local Storage
              </span>
            )}
          </div>
          <div className="flex gap-2">
            <input
              type="password"
              value={geminiApiKey}
              onChange={(e) => saveApiKey(e.target.value)}
              placeholder="AIzaSy..."
              className="flex-1 text-xs px-3 py-1.5 rounded-lg border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {geminiApiKey && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => saveApiKey('')}
                className="text-[10px] font-bold text-destructive hover:bg-destructive/10"
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-[9px] text-muted-foreground">
            Optional: AI Agent will use your personal Gemini API key for deep reasoning & analysis.
          </p>
        </div>
      )}

      {/* ── XLS File Upload Dropzone / Bar ── */}
      <div className="bg-gradient-to-r from-emerald-500/5 via-primary/5 to-indigo-500/5 border-2 border-dashed border-emerald-500/30 rounded-2xl p-4 transition-all">
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={handleFileUpload}
          className="hidden"
        />

        {!uploadedFileName ? (
          <div
            onClick={() => fileInputRef.current?.click()}
            className="flex flex-col sm:flex-row items-center justify-between gap-3 cursor-pointer group"
          >
            <div className="flex items-center gap-3">
              <div className="p-3 bg-emerald-500/10 text-emerald-600 rounded-xl group-hover:scale-105 transition-all border border-emerald-500/20">
                <FileSpreadsheet className="w-6 h-6" />
              </div>
              <div>
                <p className="text-xs font-black text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Upload className="w-3.5 h-3.5 text-emerald-600" /> Upload Bill Numbers XLS / Excel File
                </p>
                <p className="text-[10px] text-muted-foreground font-medium">
                  Excel file upload karein jisme Bill Numbers ho (e.g. Sales Register, Collection list). AI unhe auto-detect karega!
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase tracking-wider px-4 py-2 rounded-xl shadow-sm shrink-0 gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> Choose XLS File
            </Button>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-xs">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-black text-foreground">{uploadedFileName}</span>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[9px] font-black px-2 py-0.5 rounded-full border border-emerald-500/30">
                      {extractedBillNos.length} Bill Numbers Extracted
                    </span>
                  </div>
                  <p className="text-[9px] text-muted-foreground font-semibold">
                    Excel data loaded. Niche diye gaye Action Buttons me se select karein ya apna command likhein:
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAllExtractedBills(!showAllExtractedBills)}
                  className="text-[9px] font-black uppercase h-7 px-2.5"
                >
                  <Layers className="w-3 h-3 mr-1" />
                  {showAllExtractedBills ? 'Hide Bills' : `View All (${extractedBillNos.length})`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearFile}
                  className="text-[9px] font-bold text-destructive hover:bg-destructive/10 h-7 px-2"
                >
                  <X className="w-3.5 h-3.5 mr-1" /> Clear File
                </Button>
              </div>
            </div>

            {/* Extracted Bill Numbers Chips list */}
            {showAllExtractedBills && (
              <div className="p-2.5 bg-background/80 border border-border rounded-xl max-h-32 overflow-y-auto space-y-1 animate-in fade-in">
                <div className="flex flex-wrap gap-1">
                  {extractedBillNos.map((bn, i) => (
                    <span key={i} className="text-[9px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded border border-border text-foreground">
                      {bn}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Preset 1-Click Action Buttons for Fast Operations ── */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-500" /> One-Click Action Commands:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {/* 1. Paid in Cash */}
          <button
            type="button"
            onClick={() => {
              const cmd = uploadedFileName
                ? `Ye uploaded XLS ke sabhi ${extractedBillNos.length} bills ko PAID karo CASH me. Rec date, payment mode Paid, cash amount = net amount, collection amount = net amount set karo.`
                : `Sabhi matching bills ko Paid karo Cash me full amount ke sath aaj ki date me.`;
              setPrompt(cmd);
              handleAnalyze(cmd);
            }}
            className="p-2.5 rounded-xl border border-emerald-300 dark:border-emerald-800 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-200 text-left transition-all group"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <DollarSign className="w-3.5 h-3.5 text-emerald-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Paid in Cash</span>
            </div>
            <p className="text-[8.5px] text-muted-foreground font-semibold leading-tight">
              Rec Date + Mode Paid + Cash & Rec Amt = Net Amt
            </p>
          </button>

          {/* 2. Paid in UPI */}
          <button
            type="button"
            onClick={() => {
              const cmd = uploadedFileName
                ? `Ye uploaded XLS ke sabhi ${extractedBillNos.length} bills ko PAID karo UPI / Online me. Rec date, payment mode Paid, upi amount = net amount, collection amount = net amount set karo.`
                : `Sabhi matching bills ko Paid karo UPI me full amount ke sath.`;
              setPrompt(cmd);
              handleAnalyze(cmd);
            }}
            className="p-2.5 rounded-xl border border-indigo-300 dark:border-indigo-800 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-800 dark:text-indigo-200 text-left transition-all group"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Sparkles className="w-3.5 h-3.5 text-indigo-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-indigo-700 dark:text-indigo-300">Paid in UPI</span>
            </div>
            <p className="text-[8.5px] text-muted-foreground font-semibold leading-tight">
              Rec Date + Mode Paid + UPI & Rec Amt = Net Amt
            </p>
          </button>

          {/* 3. Mark FBR */}
          <button
            type="button"
            onClick={() => {
              const cmd = uploadedFileName
                ? `Ye uploaded XLS ke sabhi ${extractedBillNos.length} bills ko FBR (Full Return) mark karo reason 'Goods Return / Damage' ke sath. Rec amount 0 karo.`
                : `In sabhi bills ko FBR mark karo reason Damage ke sath.`;
              setPrompt(cmd);
              handleAnalyze(cmd);
            }}
            className="p-2.5 rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-200 text-left transition-all group"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Ban className="w-3.5 h-3.5 text-amber-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-amber-700 dark:text-amber-300">Mark FBR (Return)</span>
            </div>
            <p className="text-[8.5px] text-muted-foreground font-semibold leading-tight">
              Mode FBR + Reason Goods Return + Rec Amt 0
            </p>
          </button>

          {/* 4. Mark Credit / Del Pending */}
          <button
            type="button"
            onClick={() => {
              const cmd = uploadedFileName
                ? `Ye uploaded XLS ke sabhi ${extractedBillNos.length} bills ko Credit / Del Pending mark karo. Payment mode Unpaid, Rec amount 0 set karo.`
                : `In sabhi bills ko Credit / Del Pending mark karo.`;
              setPrompt(cmd);
              handleAnalyze(cmd);
            }}
            className="p-2.5 rounded-xl border border-purple-300 dark:border-purple-800 bg-purple-500/10 hover:bg-purple-500/20 text-purple-800 dark:text-purple-200 text-left transition-all group"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Clock className="w-3.5 h-3.5 text-purple-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-purple-700 dark:text-purple-300">Credit / Del Pending</span>
            </div>
            <p className="text-[8.5px] text-muted-foreground font-semibold leading-tight">
              Mode Del Pending / Unpaid + Rec Amt 0
            </p>
          </button>
        </div>
      </div>

      {/* ── Sample Prompt Chips ── */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-500" /> Natural Language AI Suggestions:
        </p>
        <div className="flex flex-wrap gap-1.5">
          {samplePrompts.map((sp, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setPrompt(sp);
                handleAnalyze(sp);
              }}
              className="text-[9.5px] font-bold bg-muted/60 hover:bg-primary/15 hover:text-primary text-foreground border border-border px-2.5 py-1 rounded-lg transition-all text-left"
            >
              💡 {sp}
            </button>
          ))}
        </div>
      </div>

      {/* ── Voice Listening Indicator Banner ── */}
      {isListening && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 px-3 py-2 rounded-xl text-xs font-bold flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 animate-ping text-red-500" />
            <span>Listening to voice command... Speak in Hindi, English, or Gujarati!</span>
          </div>
          <button
            onClick={toggleVoiceCommand}
            className="text-[10px] uppercase font-black bg-red-600 text-white px-2 py-0.5 rounded-md"
          >
            Stop Mic
          </button>
        </div>
      )}

      {/* ── Input Box & Voice Command Mic Button ── */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type command or click Mic icon to speak (e.g. 'Ye sabhi bills no ko paid karo cash me' ya 'In bills ko FBR mark karo reason damage ke sath')..."
            rows={2}
            className="w-full text-xs p-3 pr-10 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium placeholder:text-muted-foreground resize-none"
          />
          {/* Voice Command Button inside textarea */}
          <button
            type="button"
            onClick={toggleVoiceCommand}
            title={isListening ? "Stop Voice Command" : "Start Voice Command (Awaaz se bolo)"}
            className={cn(
              "absolute right-2.5 top-2.5 p-2 rounded-lg transition-all flex items-center justify-center",
              isListening
                ? "bg-red-500 text-white shadow-lg animate-bounce"
                : "bg-primary/10 text-primary hover:bg-primary/20 border border-primary/20"
            )}
          >
            {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
          </button>
        </div>
        <Button
          onClick={() => handleAnalyze()}
          disabled={loading || (!prompt.trim() && extractedBillNos.length === 0)}
          className="sm:self-stretch px-5 font-black uppercase text-xs gap-2 shrink-0 h-auto py-2.5 sm:py-0 shadow-md bg-primary hover:bg-primary/90"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Processing AI...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" /> Run AI Agent
            </>
          )}
        </Button>
      </div>

      {/* ── Success Toast Message ── */}
      {resultMessage && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-400 text-emerald-800 dark:text-emerald-200 p-3.5 rounded-xl text-xs font-bold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{resultMessage}</span>
          <button onClick={() => setResultMessage(null)} className="text-xs underline font-black ml-2 shrink-0">Dismiss</button>
        </div>
      )}

      {/* ── Response Output ── */}
      {response && (
        <div className="space-y-3 pt-2 border-t border-border/50 animate-in fade-in-50">
          {response.error ? (
            <div className="bg-red-50 border border-red-300 text-red-700 p-3 rounded-xl text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{response.error}</span>
            </div>
          ) : (
            <>
              {/* Explanation & Strategy Banner */}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1.5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-xs font-black text-primary uppercase">Gemini AI Plan & Database Analysis</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-md border border-emerald-500/30">
                      Matched: {response.matchedCount || 0} Bills
                    </span>
                    {(response.unmatchedCount || 0) > 0 && (
                      <span className="text-[10px] font-black bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-md border border-amber-500/30">
                        Not in DB: {response.unmatchedCount}
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-xs font-medium text-foreground">{response.explanation}</p>
                {response.proposedActionText && (
                  <p className="text-[10px] font-bold text-muted-foreground italic">
                    ⚡ {response.proposedActionText}
                  </p>
                )}
              </div>

              {/* Unmatched Bills Warning (if any) */}
              {(response.unmatchedCount || 0) > 0 && response.unmatchedBillNos && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-800 dark:text-amber-200 p-2.5 rounded-xl text-[10px] space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>{response.unmatchedCount} bills uploaded file me the par Database me nahi mile:</span>
                  </div>
                  <p className="font-mono text-[9px] text-muted-foreground break-all">
                    {response.unmatchedBillNos.slice(0, 15).join(', ')} {response.unmatchedBillNos.length > 15 ? `...and ${response.unmatchedBillNos.length - 15} more` : ''}
                  </p>
                </div>
              )}

              {/* Matched Bills Preview Table */}
              {response.matchedBills && response.matchedBills.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <h3 className="text-[11px] font-black uppercase text-foreground tracking-wide flex items-center gap-1.5">
                      <FileCheck className="w-3.5 h-3.5 text-emerald-600" />
                      Live Database Bills Update Preview ({response.matchedBills.length})
                    </h3>
                    {response.patches && response.patches.length > 0 && (
                      <Button
                        onClick={() => setShowConfirm(true)}
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-1.5 shadow-md px-4 py-2"
                      >
                        <Zap className="w-4 h-4" /> Confirm & Apply DB Updates ({response.patches.length})
                      </Button>
                    )}
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden max-h-72 overflow-y-auto shadow-inner bg-card">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="bg-muted/90 sticky top-0 font-black text-muted-foreground uppercase text-[8px] tracking-wider border-b border-border z-10 backdrop-blur-xs">
                        <tr>
                          <th className="p-2">Bill No</th>
                          <th className="p-2">Party Name</th>
                          <th className="p-2">Driver</th>
                          <th className="p-2 text-right">Net Amt</th>
                          <th className="p-2 text-right">Line Cut</th>
                          <th className="p-2 text-center">Rec Date</th>
                          <th className="p-2">Current Mode</th>
                          <th className="p-2">Proposed Update</th>
                          <th className="p-2 text-right">Collection Amt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 font-medium">
                        {response.matchedBills.map((b) => (
                          <tr key={b.id || b.billNo} className="hover:bg-muted/40 transition-colors">
                            <td className="p-2 font-black text-primary font-mono">{b.billNo}</td>
                            <td className="p-2 truncate max-w-[130px]" title={b.partyName}>{b.partyName}</td>
                            <td className="p-2 uppercase text-muted-foreground">{b.driverName || '-'}</td>
                            <td className="p-2 text-right font-bold">₹{b.billNetAmt}</td>
                            <td className="p-2 text-right text-muted-foreground">₹{b.lineCutAmt || 0}</td>
                            <td className="p-2 text-center font-mono font-bold text-indigo-600 dark:text-indigo-400">
                              {b.proposedDate || '-'}
                            </td>
                            <td className="p-2">
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase border border-border bg-muted">
                                {b.currentStatus}
                              </span>
                            </td>
                            <td className="p-2">
                              {b.proposedStatus !== b.currentStatus || b.proposedMethod ? (
                                <span className="px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1 w-max shadow-2xs">
                                  <span>{b.proposedStatus}</span>
                                  {b.proposedMethod && b.proposedMethod !== '-' && (
                                    <span className="text-[7.5px] font-bold text-emerald-900 dark:text-emerald-100 bg-emerald-500/20 px-1 py-0.2 rounded">
                                      {b.proposedMethod}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-[8px]">No change</span>
                              )}
                            </td>
                            <td className="p-2 text-right font-black text-emerald-600 dark:text-emerald-400">
                              ₹{b.collectedAmount || 0}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Confirmation Dialog for Bulk Write Operation ── */}
      {showConfirm && response && response.patches && (
        <div className="fixed inset-0 bg-black/70 z-[500] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-2xl p-5 w-full max-w-lg shadow-2xl border-2 border-emerald-500 animate-in zoom-in-95 space-y-4">
            <div className="flex items-center gap-3 pb-2.5 border-b border-border">
              <div className="p-2.5 bg-amber-500/10 text-amber-600 rounded-xl border border-amber-500/20">
                <ShieldAlert className="w-6 h-6 shrink-0" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase text-foreground">Confirm Database Write Execution</h3>
                <p className="text-[10px] text-muted-foreground font-semibold">
                  Aap {response.patches.length} bill records ko PostgreSQL database me update karne ja rahe hain.
                </p>
              </div>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-950 dark:text-emerald-100 p-3.5 rounded-xl text-xs space-y-1.5">
              <p className="font-black uppercase tracking-wider text-[10px] text-emerald-700 dark:text-emerald-300">
                Update Summary:
              </p>
              <p className="font-semibold text-[11px] leading-relaxed">{response.proposedActionText}</p>
              <div className="pt-1 text-[10px] font-bold text-muted-foreground flex items-center gap-2">
                <span>✓ Status & Payment Mode</span>
                <span>✓ Rec / Payment Date</span>
                <span>✓ Cash / UPI Amount</span>
                <span>✓ Collection Amount</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(false)}
                disabled={executing}
                className="text-xs font-bold uppercase"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecutePatches}
                disabled={executing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-1.5 px-4 shadow-md"
              >
                {executing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Writing to Database...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Execute & Save ({response.patches.length} Bills)
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

