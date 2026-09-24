import React, { useState, useRef, useMemo } from 'react';
import {
  Bot, Sparkles, Search, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw,
  Database, ShieldAlert, Zap, Mic, MicOff, Key, Volume2, FileSpreadsheet,
  Upload, X, Check, FileCheck, Layers, Calendar, DollarSign, Ban, Clock,
  Brain, Cpu, Users, UserCheck, SlidersHorizontal, ArrowUpDown, ChevronDown, ChevronUp
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { safeReadWorkbook } from '@/lib/xlsxHelper';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { bulkPatchBillsInMemory, patchBillsInMemory, getBills, Bill } from '@/lib/billStore';

export type MatchedBill = {
  id: string;
  billNo: string;
  partyName: string;
  driverName: string;
  salespersonName: string;
  beatName: string;
  billNetAmt: number;
  collectedAmount: number;
  lineCutAmt: number;
  diff: number;
  currentStatus: string;
  proposedStatus: string;
  proposedMethod?: string;
  proposedDate?: string;
  currentSalesperson?: string;
  proposedSalesperson?: string;
  currentDriver?: string;
  proposedDriver?: string;
  currentBeat?: string;
  proposedBeat?: string;
  changes: Record<string, any>;
};

export type QueryStats = {
  totalBills: number;
  totalAmount: number;
  collectedAmount: number;
  outstandingAmount: number;
  paidCount: number;
  fbrCount: number;
  creditCount: number;
  unpaidCount: number;
  breakdown?: Array<{ label: string; count: number; amount: number }>;
};

export type AgentResponse = {
  ok: boolean;
  explanation?: string;
  operationType?: 'BULK_XLS_UPDATE' | 'STATUS_UPDATE' | 'FIELD_UPDATE' | 'READ_QUERY' | 'CONDITIONAL_UPDATE';
  targetField?: string;
  targetValue?: string;
  sourceColumn?: string;
  thinkingSteps?: string[];
  matchedCount?: number;
  unmatchedCount?: number;
  unmatchedBillNos?: string[];
  matchedBills?: MatchedBill[];
  isWriteIntent?: boolean;
  proposedActionText?: string;
  patches?: Array<{ id: string; billNo: string; changes: Record<string, any> }>;
  queryStats?: QueryStats;
  error?: string;
};

export type ColumnMapping = {
  billNo: string;
  salesperson: string;
  driver: string;
  beat: string;
  party: string;
  amount: string;
  status: string;
  date: string;
};

export function AdminAiAgent() {
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{ saved: number; total: number } | null>(null);
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  const [showThinking, setShowThinking] = useState(true);

  // XLS File Upload state
  const [uploadedFileName, setUploadedFileName] = useState<string | null>(null);
  const [extractedBillNos, setExtractedBillNos] = useState<string[]>([]);
  const [detectedHeaders, setDetectedHeaders] = useState<string[]>([]);
  const [columnMapping, setColumnMapping] = useState<ColumnMapping>({
    billNo: '',
    salesperson: '',
    driver: '',
    beat: '',
    party: '',
    amount: '',
    status: '',
    date: '',
  });
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [showAllExtractedBills, setShowAllExtractedBills] = useState(false);
  const [previewFilter, setPreviewFilter] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // In-memory XLS rows map for ultra-fast lookup
  const xlsRowMapRef = useRef<Map<string, any>>(new Map());

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
    "Ye 42000 bills ke xls data se sabhi sales person name ko supabase me update karo",
    "Ye uploaded XLS ke sabhi bills ko Paid karo Cash me aaj ki date me",
    "In sabhi bills ko FBR mark karo reason Damage ke sath",
    "Driver Mukesh ke sabhi bills me driver Ramesh update karo",
    "Sabhi bills me line cut amount 0 karo",
    "Kitne bills unpaid hai aur total kitna outstanding hai batao",
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
    // Sync to server settings so the live WhatsApp bot (background) can use this key
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'gemini_api_key', value: key.trim() }),
    }).catch(() => {});
  }

  // ── Auto-Detect Column Names from XLS Headers ──
  function detectColumns(headers: string[]): ColumnMapping {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

    const mapping: ColumnMapping = {
      billNo: '',
      salesperson: '',
      driver: '',
      beat: '',
      party: '',
      amount: '',
      status: '',
      date: '',
    };

    for (const h of headers) {
      const c = clean(h);
      if (!mapping.billNo && (c.includes('billno') || c.includes('billref') || c.includes('billnum') || c.includes('invoiceno') || c.includes('docno') || c === 'bill' || c.includes('bill'))) {
        mapping.billNo = h;
      }
      if (!mapping.salesperson && (c.includes('salesman') || c.includes('salesperson') || c.includes('salespersonname') || c.includes('salesperson') || c.includes('srname') || c.includes('salesrep') || c.includes('user') || c.includes('empname') || c.includes('employee'))) {
        mapping.salesperson = h;
      }
      if (!mapping.driver && (c.includes('driver') || c.includes('drivername') || c.includes('routedriver'))) {
        mapping.driver = h;
      }
      if (!mapping.beat && (c.includes('beat') || c.includes('beatname') || c.includes('route') || c.includes('market') || c.includes('area'))) {
        mapping.beat = h;
      }
      if (!mapping.party && (c.includes('partyname') || c.includes('party') || c.includes('customer') || c.includes('outlet'))) {
        mapping.party = h;
      }
      if (!mapping.amount && (c.includes('netamt') || c.includes('netamount') || c.includes('billamt') || c.includes('billnetamt') || c.includes('grossamt') || c === 'total' || c.includes('amount'))) {
        mapping.amount = h;
      }
      if (!mapping.status && (c.includes('status') || c.includes('paymentmode') || c.includes('mode') || c.includes('paymentstatus'))) {
        mapping.status = h;
      }
      if (!mapping.date && (c.includes('billdate') || c.includes('date') || c.includes('recdate') || c.includes('paymentdate'))) {
        mapping.date = h;
      }
    }

    if (!mapping.billNo && headers.length > 0) {
      mapping.billNo = headers[0];
    }

    return mapping;
  }

  // ── Handle XLS / XLSX File Upload & High Performance Indexing ──
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setLoading(true);
      const data = await file.arrayBuffer();
      const workbook = safeReadWorkbook(XLSX, data);
      const firstSheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[firstSheetName];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!json || json.length === 0) {
        alert('File is empty or could not be parsed.');
        setLoading(false);
        return;
      }

      const headers = Object.keys(json[0] || {});
      setDetectedHeaders(headers);
      const detected = detectColumns(headers);
      setColumnMapping(detected);

      const billNoKey = detected.billNo;
      const bnsSet = new Set<string>();
      const rowMap = new Map<string, any>();

      const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const stripGst = (s: string) => cleanBn(s).replace(/^GST/i, '').replace(/^MOC/i, '');

      for (let i = 0; i < json.length; i++) {
        const row = json[i];
        let val = '';
        if (billNoKey && row[billNoKey] !== undefined && row[billNoKey] !== '') {
          val = String(row[billNoKey]).trim();
        } else {
          for (const k of headers) {
            const v = String(row[k] || '').trim();
            if (v && (v.toUpperCase().startsWith('GST') || v.toUpperCase().startsWith('MOC') || /^\d{4,}$/.test(v))) {
              val = v;
              break;
            }
          }
        }

        if (val && val !== '0' && val.toLowerCase() !== 'total' && val.toLowerCase() !== 'bill no') {
          bnsSet.add(val);
          const c = cleanBn(val);
          const st = stripGst(val);
          if (c) rowMap.set(c, row);
          if (st) rowMap.set(st, row);
          rowMap.set(val, row);
        }
      }

      xlsRowMapRef.current = rowMap;
      const billList = Array.from(bnsSet);
      if (billList.length === 0) {
        alert('Koi valid Bill No column nahi mila. Kripya XLS file check karein.');
        setLoading(false);
        return;
      }

      setUploadedFileName(file.name);
      setExtractedBillNos(billList);

      const defaultPrompt = detected.salesperson
        ? `Ye ${billList.length} bills ke xls data se sabhi sales person name ko supabase me update karo`
        : `Ye uploaded XLS ke sabhi ${billList.length} bills ko Paid karo Cash me`;
      setPrompt(defaultPrompt);

      // Auto-trigger analysis for the uploaded bills
      setTimeout(() => {
        handleAnalyze(defaultPrompt, billList, headers, detected);
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
    setDetectedHeaders([]);
    xlsRowMapRef.current.clear();
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
      recognition.lang = 'hi-IN';

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

  // ── High Performance Local NLP & Multi-Column Rules Engine ──
  function runComprehensiveLocalAnalysis(
    queryText: string,
    targetBillNos: string[],
    currentHeaders: string[],
    currentMapping: ColumnMapping,
    aiParsed?: any
  ): AgentResponse {
    const allBills: Bill[] = getBills ? getBills() : [];
    const hasXlsBills = targetBillNos.length > 0;
    const now = new Date();
    const todayDMY = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;
    const rawLower = (queryText || '').toLowerCase();

    // 1. Detect Operation Type & Intent
    let operationType: 'BULK_XLS_UPDATE' | 'STATUS_UPDATE' | 'FIELD_UPDATE' | 'READ_QUERY' | 'CONDITIONAL_UPDATE' =
      aiParsed?.operationType || 'STATUS_UPDATE';
    let targetField: string = aiParsed?.targetField || '';
    let targetValue: string = aiParsed?.targetValue || '';
    let sourceColumn: string = aiParsed?.sourceColumnHint || '';
    let isWriteIntent: boolean = aiParsed?.isWriteIntent !== undefined ? Boolean(aiParsed.isWriteIntent) : true;
    let targetPaymentMode = aiParsed?.targetPaymentMode || '';
    let targetPaymentMethod = aiParsed?.targetPaymentMethod || '';
    let targetDate = aiParsed?.targetDate || '';
    let discrepancyReason = aiParsed?.discrepancyReason || '';
    let thinkingSteps: string[] = aiParsed?.thinkingSteps && Array.isArray(aiParsed.thinkingSteps) ? aiParsed.thinkingSteps : [];

    const isSalespersonQuery = rawLower.includes('sales person') || rawLower.includes('salesperson') || rawLower.includes('salesman') || rawLower.includes('sr name');
    const isDriverQuery = rawLower.includes('driver');
    const isBeatQuery = rawLower.includes('beat') || rawLower.includes('route');
    const isLineCutQuery = rawLower.includes('line cut') || rawLower.includes('linecut');
    const isReadIntent = rawLower.includes('kitne') || rawLower.includes('count') || rawLower.includes('summary') || rawLower.includes('batao') || rawLower.includes('dikhao') || rawLower.includes('total') || rawLower.includes('check');

    // Determine operation type heuristic if not provided by AI
    if (!aiParsed?.operationType) {
      if (hasXlsBills && isSalespersonQuery && (rawLower.includes('update') || rawLower.includes('badlo') || rawLower.includes('karo') || rawLower.includes('set') || rawLower.includes('apply'))) {
        operationType = 'BULK_XLS_UPDATE';
        targetField = 'salespersonName';
        sourceColumn = currentMapping.salesperson || currentHeaders.find(h => h.toLowerCase().includes('sales')) || '';
        isWriteIntent = true;
      } else if (hasXlsBills && isDriverQuery && (rawLower.includes('update') || rawLower.includes('badlo') || rawLower.includes('karo') || rawLower.includes('set'))) {
        operationType = 'BULK_XLS_UPDATE';
        targetField = 'driverName';
        sourceColumn = currentMapping.driver || '';
        isWriteIntent = true;
      } else if (hasXlsBills && isBeatQuery && (rawLower.includes('update') || rawLower.includes('badlo') || rawLower.includes('karo') || rawLower.includes('set'))) {
        operationType = 'BULK_XLS_UPDATE';
        targetField = 'beatName';
        sourceColumn = currentMapping.beat || '';
        isWriteIntent = true;
      } else if (isReadIntent && !rawLower.includes('karo') && !rawLower.includes('update') && !rawLower.includes('paid')) {
        operationType = 'READ_QUERY';
        isWriteIntent = false;
      } else if (rawLower.includes('paid') || rawLower.includes('fbr') || rawLower.includes('credit') || rawLower.includes('del pending') || rawLower.includes('unpaid') || rawLower.includes('jama')) {
        operationType = 'STATUS_UPDATE';
        isWriteIntent = true;
      } else if (isSalespersonQuery && (rawLower.includes('ko') || rawLower.includes('karo') || rawLower.includes('update'))) {
        operationType = 'FIELD_UPDATE';
        targetField = 'salespersonName';
        isWriteIntent = true;
      } else if (isDriverQuery && (rawLower.includes('ko') || rawLower.includes('karo') || rawLower.includes('update'))) {
        operationType = 'FIELD_UPDATE';
        targetField = 'driverName';
        isWriteIntent = true;
      } else if (isLineCutQuery) {
        operationType = 'FIELD_UPDATE';
        targetField = 'lineCutAmt';
        targetValue = '0';
        isWriteIntent = true;
      }
    }

    // Heuristic target values and modes
    if (operationType === 'STATUS_UPDATE' || (hasXlsBills && !targetField)) {
      if (!targetPaymentMode) {
        if (rawLower.includes('fbr') || rawLower.includes('cancel') || rawLower.includes('return') || rawLower.includes('damage')) {
          targetPaymentMode = 'FBR';
          if (!discrepancyReason) discrepancyReason = 'Goods Return / Damage';
        } else if (rawLower.includes('credit') || rawLower.includes('del pending') || rawLower.includes('pending')) {
          targetPaymentMode = 'Del Pending';
        } else if (rawLower.includes('unpaid') || rawLower.includes('reset')) {
          targetPaymentMode = 'Unpaid';
        } else {
          targetPaymentMode = 'Paid';
        }
      }

      if (!targetPaymentMethod && targetPaymentMode === 'Paid') {
        if (rawLower.includes('upi') || rawLower.includes('online') || rawLower.includes('gpay') || rawLower.includes('phonepe') || rawLower.includes('scanner') || rawLower.includes('qr')) {
          targetPaymentMethod = 'UPI';
        } else if (rawLower.includes('cheque') || rawLower.includes('check') || rawLower.includes('bank') || rawLower.includes('rtgs')) {
          targetPaymentMethod = 'Cheque';
        } else {
          targetPaymentMethod = 'Cash';
        }
      }
    }

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

    // ── Build Bill Number Lookup Index for ultra fast O(1) matching ──
    const cleanBn = (s: string) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const stripGst = (s: string) => cleanBn(s).replace(/^GST/i, '').replace(/^MOC/i, '');

    const billMapByClean = new Map<string, Bill>();
    const billMapByStripped = new Map<string, Bill>();
    for (let i = 0; i < allBills.length; i++) {
      const b = allBills[i];
      const c = cleanBn(b.billNo);
      if (c && !billMapByClean.has(c)) billMapByClean.set(c, b);
      const st = stripGst(b.billNo);
      if (st && !billMapByStripped.has(st)) billMapByStripped.set(st, b);
    }

    const matchedBills: MatchedBill[] = [];
    const patches: Array<{ id: string; billNo: string; changes: Record<string, any> }> = [];
    const matchedBillIds = new Set<string>();
    const unmatchedBillNos: string[] = [];

    // ── CASE 1: BULK XLS UPDATE (e.g. Salesperson Name, Driver, Beat) ──
    if (operationType === 'BULK_XLS_UPDATE' && hasXlsBills) {
      const fieldKey = targetField || 'salespersonName';
      const xlsColHeader = sourceColumn || (fieldKey === 'salespersonName' ? currentMapping.salesperson : fieldKey === 'driverName' ? currentMapping.driver : currentMapping.beat);

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

        const xlsRow = xlsRowMapRef.current.get(c) || xlsRowMapRef.current.get(st) || xlsRowMapRef.current.get(rawBn);
        let newValue = '';
        if (xlsRow && xlsColHeader && xlsRow[xlsColHeader] !== undefined) {
          newValue = String(xlsRow[xlsColHeader]).trim();
        } else if (xlsRow) {
          for (const k of Object.keys(xlsRow)) {
            const kl = k.toLowerCase();
            if (fieldKey === 'salespersonName' && (kl.includes('sales') || kl.includes('salesman') || kl.includes('sr'))) {
              newValue = String(xlsRow[k]).trim();
              break;
            } else if (fieldKey === 'driverName' && kl.includes('driver')) {
              newValue = String(xlsRow[k]).trim();
              break;
            } else if (fieldKey === 'beatName' && (kl.includes('beat') || kl.includes('route'))) {
              newValue = String(xlsRow[k]).trim();
              break;
            }
          }
        }

        const currentValue = (bill as any)[fieldKey] || '';
        const hasChange = newValue && newValue.toLowerCase() !== String(currentValue).toLowerCase();

        const patchChanges: Record<string, any> = {};
        if (hasChange) {
          patchChanges[fieldKey] = newValue;
        }

        matchedBills.push({
          id: bill.id,
          billNo: bill.billNo,
          partyName: bill.partyName || '',
          driverName: bill.driverName || '',
          salespersonName: bill.salespersonName || '',
          beatName: bill.beatName || '',
          billNetAmt: Number(bill.billNetAmt) || 0,
          collectedAmount: Number(bill.collectedAmount) || 0,
          lineCutAmt: Number(bill.lineCutAmt) || 0,
          diff: Number(bill.outstandingAmount) || 0,
          currentStatus: bill.paymentMode || 'Unpaid',
          proposedStatus: bill.paymentMode || 'Unpaid',
          currentSalesperson: bill.salespersonName,
          proposedSalesperson: fieldKey === 'salespersonName' ? (newValue || bill.salespersonName) : bill.salespersonName,
          currentDriver: bill.driverName,
          proposedDriver: fieldKey === 'driverName' ? (newValue || bill.driverName) : bill.driverName,
          currentBeat: bill.beatName,
          proposedBeat: fieldKey === 'beatName' ? (newValue || bill.beatName) : bill.beatName,
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

      if (thinkingSteps.length === 0) {
        thinkingSteps = [
          `1. Command Analyzed: User ne XLS data se sabhi bills ke '${fieldKey}' ko Supabase database me update karne ka nirdesh diya hai.`,
          `2. Column Mapping: Bill No Column ('${currentMapping.billNo || 'Auto'}') aur Value Column ('${xlsColHeader || 'Detected'}') successfully match hue.`,
          `3. Database Verification: Total ${targetBillNos.length} me se ${matchedBills.length} bills database me verify hue. ${patches.length} bills me naya value update hone ke liye ready hai.`,
          `4. Safe Execution Plan: Chunked batch upsert (800 records per batch) Supabase ke locked instance ('zybrzzouzleacqjvfiiu') par execute hoga bina browser freeze hue.`,
        ];
      }
    }
    // ── CASE 2: READ QUERY (Statistics, Counts, Summaries) ──
    else if (operationType === 'READ_QUERY') {
      isWriteIntent = false;
      let totalAmt = 0;
      let recAmt = 0;
      let outAmt = 0;
      let paid = 0;
      let fbr = 0;
      let credit = 0;
      let unpaid = 0;

      const driverCounts: Record<string, { count: number; amount: number }> = {};
      const spCounts: Record<string, { count: number; amount: number }> = {};

      for (let i = 0; i < allBills.length; i++) {
        const b = allBills[i];
        const net = Number(b.billNetAmt) || 0;
        const col = Number(b.collectedAmount) || 0;
        const out = Number(b.outstandingAmount) || 0;
        const mode = (b.paymentMode || 'Unpaid').toUpperCase();

        totalAmt += net;
        recAmt += col;
        outAmt += out;

        if (mode === 'PAID') paid++;
        else if (mode === 'FBR') fbr++;
        else if (mode === 'CREDIT' || mode === 'DEL PENDING') credit++;
        else unpaid++;

        const dName = b.driverName || 'Unassigned';
        if (!driverCounts[dName]) driverCounts[dName] = { count: 0, amount: 0 };
        driverCounts[dName].count++;
        driverCounts[dName].amount += net;

        const sName = b.salespersonName || 'Unassigned';
        if (!spCounts[sName]) spCounts[sName] = { count: 0, amount: 0 };
        spCounts[sName].count++;
        spCounts[sName].amount += net;
      }

      const breakdown = Object.entries(driverCounts).slice(0, 10).map(([label, val]) => ({
        label,
        count: val.count,
        amount: Math.round(val.amount),
      }));

      thinkingSteps = [
        `1. Query Recognition: Database analysis & read query command detect hua.`,
        `2. In-Memory Calculation: Database ke sabhi ${allBills.length} bills ka status, outstanding, aur totals calculate kiye gaye.`,
        `3. Summary Compiled: Total bills: ${allBills.length}, Unpaid bills: ${unpaid}, Outstanding: ₹${outAmt.toLocaleString('en-IN')}.`,
        `4. Reporting: Screen par instant interactive summary cards render kiye gaye.`,
      ];

      return {
        ok: true,
        operationType: 'READ_QUERY',
        isWriteIntent: false,
        explanation: `Database me kul ${allBills.length} bills hain. Unpaid bills: ${unpaid}, Paid bills: ${paid}, FBR bills: ${fbr}, Credit/Pending: ${credit}. Total Outstanding: ₹${outAmt.toLocaleString('en-IN')}.`,
        queryStats: {
          totalBills: allBills.length,
          totalAmount: Math.round(totalAmt),
          collectedAmount: Math.round(recAmt),
          outstandingAmount: Math.round(outAmt),
          paidCount: paid,
          fbrCount: fbr,
          creditCount: credit,
          unpaidCount: unpaid,
          breakdown,
        },
        thinkingSteps,
      };
    }
    // ── CASE 3: STATUS UPDATE / PAYMENT MODES (From XLS or Query) ──
    else if (operationType === 'STATUS_UPDATE') {
      const sourceBills = hasXlsBills ? targetBillNos : allBills.map(b => b.billNo);

      for (const rawBn of sourceBills) {
        const c = cleanBn(rawBn);
        const st = stripGst(rawBn);
        const bill = billMapByClean.get(c) || billMapByStripped.get(st) || billMapByStripped.get(c);

        if (!bill) {
          if (hasXlsBills) unmatchedBillNos.push(String(rawBn));
          continue;
        }

        if (matchedBillIds.has(bill.id)) continue;

        const netAmt = Number(bill.billNetAmt) || 0;
        const lc = Number(bill.lineCutAmt) || 0;
        const effectiveNet = Math.max(0, netAmt - lc);
        const curMode = String(bill.paymentMode || 'Unpaid').trim();

        let isMatch = hasXlsBills;
        let patchChanges: Record<string, any> = {};

        if (!hasXlsBills) {
          // Conditional NLP filters
          const recAmt = Number(bill.collectedAmount) || 0;
          if (rawLower.includes('rec') && (curMode.toUpperCase() === 'FBR' || curMode.toUpperCase() === 'UNPAID') && recAmt > 0) {
            isMatch = true;
          } else if ((rawLower.includes('diff') || rawLower.includes('zero')) && (recAmt + lc >= netAmt - 1) && curMode !== 'Paid') {
            isMatch = true;
          } else if (rawLower.includes('fbr') && curMode.toUpperCase() === 'FBR') {
            isMatch = true;
          } else if (rawLower.includes('unpaid') && curMode.toUpperCase() === 'UNPAID') {
            isMatch = true;
          }
        }

        if (isMatch) {
          matchedBillIds.add(bill.id);

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
            salespersonName: bill.salespersonName || '',
            beatName: bill.beatName || '',
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
      }

      if (thinkingSteps.length === 0) {
        thinkingSteps = [
          `1. Intent: Status Update command detect hua -> Target Status: '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}).`,
          `2. Date & Amount: Payment Date '${targetDate || todayDMY}' aur Net Collection Calculation set kiya gaya.`,
          `3. Database Match: ${matchedBills.length} bills match hue jinme patch apply hoga.`,
          `4. Safe Execution: Supabase and App state bulk sync tayar hai.`,
        ];
      }
    }
    // ── CASE 4: SINGLE FIELD / CONDITIONAL UPDATE ──
    else {
      const fieldKey = targetField || (isDriverQuery ? 'driverName' : isSalespersonQuery ? 'salespersonName' : 'lineCutAmt');
      let valToSet = targetValue;
      if (!valToSet && fieldKey === 'lineCutAmt') valToSet = '0';

      for (let i = 0; i < allBills.length; i++) {
        const bill = allBills[i];
        let isMatch = false;

        if (fieldKey === 'lineCutAmt') {
          if (Number(bill.lineCutAmt) > 0) isMatch = true;
        } else if (rawLower.includes('ke sabhi bills')) {
          isMatch = true;
        } else {
          isMatch = true;
        }

        if (isMatch) {
          const patchChanges: Record<string, any> = {};
          if (fieldKey === 'lineCutAmt') {
            patchChanges.lineCutAmt = 0;
          } else if (valToSet) {
            patchChanges[fieldKey] = valToSet;
          }

          matchedBills.push({
            id: bill.id,
            billNo: bill.billNo,
            partyName: bill.partyName || '',
            driverName: bill.driverName || '',
            salespersonName: bill.salespersonName || '',
            beatName: bill.beatName || '',
            billNetAmt: Number(bill.billNetAmt) || 0,
            collectedAmount: Number(bill.collectedAmount) || 0,
            lineCutAmt: Number(bill.lineCutAmt) || 0,
            diff: Number(bill.outstandingAmount) || 0,
            currentStatus: bill.paymentMode || 'Unpaid',
            proposedStatus: bill.paymentMode || 'Unpaid',
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
      }

      if (thinkingSteps.length === 0) {
        thinkingSteps = [
          `1. Command: Field update '${fieldKey}' across matching bills.`,
          `2. Target Value: '${valToSet || 'Cleared'}'.`,
          `3. Database Match: ${matchedBills.length} bills target hue.`,
          `4. Execution: Ready to apply in Supabase & memory.`,
        ];
      }
    }

    let explanation = aiParsed?.explanation || '';
    if (!explanation) {
      if (operationType === 'BULK_XLS_UPDATE') {
        explanation = `Uploaded XLS file me se ${targetBillNos.length} Bill Numbers mile, jisme se ${matchedBills.length} bills database me match hue. Salesperson/Field update ke liye ${patches.length} updates ready hain.`;
      } else if (operationType === 'STATUS_UPDATE') {
        explanation = `Matching ${matchedBills.length} bills ka status '${targetPaymentMode || 'Paid'}' (${targetPaymentMethod || 'Cash'}), Date: ${targetDate || todayDMY} update karne ke liye tayar hai.`;
      } else {
        explanation = `${matchedBills.length} bills analyze hue. ${patches.length} updates ready hain.`;
      }
    }

    const proposedActionText = isWriteIntent && patches.length > 0
      ? `${patches.length} bills me changes apply karne ke liye proposal tayar hai.`
      : `Result: ${matchedBills.length} bills found.`;

    return {
      ok: true,
      explanation,
      operationType,
      targetField,
      sourceColumn,
      thinkingSteps,
      matchedCount: matchedBills.length,
      unmatchedCount: unmatchedBillNos.length,
      unmatchedBillNos,
      matchedBills,
      isWriteIntent,
      proposedActionText,
      patches,
    };
  }

  async function handleAnalyze(
    customPrompt?: string,
    customBillNos?: string[],
    customHeaders?: string[],
    customMapping?: ColumnMapping
  ) {
    const queryText = customPrompt !== undefined ? customPrompt : prompt;
    const targetBillNos = customBillNos || extractedBillNos;
    const currentHeaders = customHeaders || detectedHeaders;
    const currentMapping = customMapping || columnMapping;

    if (!queryText.trim() && targetBillNos.length === 0) return;

    setLoading(true);
    setResultMessage(null);

    try {
      let aiParsed: any = null;

      // 1. Try lightweight Gemini Intent parsing via backend (sends ONLY the prompt string + detected headers)
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
            detectedHeaders: currentHeaders,
            apiKey: geminiApiKey.trim() || undefined,
          }),
        });

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
      const result = runComprehensiveLocalAnalysis(queryText, targetBillNos, currentHeaders, currentMapping, aiParsed);
      setResponse(result);
    } catch (err: any) {
      console.error('[AdminAiAgent handleAnalyze Error]', err);
      try {
        const fallbackResult = runComprehensiveLocalAnalysis(queryText, targetBillNos, currentHeaders, currentMapping);
        setResponse(fallbackResult);
      } catch (fbErr: any) {
        setResponse({ ok: false, error: fbErr.message || 'Failed to process command' });
      }
    } finally {
      setLoading(false);
    }
  }

  // ── High Performance Bulk Execute to Supabase & Memory ──
  async function handleExecutePatches() {
    if (!response || !response.patches || response.patches.length === 0) return;

    setExecuting(true);
    setExecutionProgress({ saved: 0, total: response.patches.length });

    try {
      // 1. Apply ultra-fast bulk patch in memory + Supabase chunked upsert (CHUNK = 800)
      const res = await bulkPatchBillsInMemory(response.patches, (saved, total) => {
        setExecutionProgress({ saved, total });
      });

      // 2. Asynchronously notify backend server for PostgreSQL sync if available
      try {
        const samplePatches = response.patches.slice(0, 500);
        fetch('/api/admin/ai-agent', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(geminiApiKey.trim() ? { 'x-gemini-api-key': geminiApiKey.trim() } : {}),
          },
          body: JSON.stringify({
            action: 'execute',
            patches: samplePatches,
            apiKey: geminiApiKey.trim() || undefined,
          }),
        }).catch(() => {});
      } catch {}

      setResultMessage(
        `✅ ${res.updatedCount} bills successfully updated in Supabase ('zybrzzouzleacqjvfiiu') & App Memory!`
      );
      setShowConfirm(false);

      // Re-run analysis to show fresh state
      setTimeout(() => {
        handleAnalyze();
      }, 300);
    } catch (err: any) {
      alert(`Execution error: ${err.message || String(err)}`);
    } finally {
      setExecuting(false);
      setExecutionProgress(null);
    }
  }

  // Filter matched bills in preview
  const filteredMatchedBills = useMemo(() => {
    if (!response?.matchedBills) return [];
    if (!previewFilter.trim()) return response.matchedBills.slice(0, 100);
    const q = previewFilter.toLowerCase();
    return response.matchedBills.filter(
      b => b.billNo.toLowerCase().includes(q) ||
           b.partyName.toLowerCase().includes(q) ||
           b.driverName.toLowerCase().includes(q) ||
           (b.proposedSalesperson || '').toLowerCase().includes(q)
    ).slice(0, 100);
  }, [response?.matchedBills, previewFilter]);

  return (
    <div className="bg-card border-2 border-primary/25 rounded-2xl p-4 sm:p-6 shadow-xl space-y-5 my-4">
      {/* ── Header ── */}
      <div className="flex items-center justify-between pb-4 border-b border-border/70 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-gradient-to-tr from-primary/20 to-indigo-500/20 text-primary border border-primary/30 shadow-sm">
            <Cpu className="w-6 h-6 animate-pulse text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-black uppercase text-foreground tracking-wider">
                Admin AI Database Agent & Bulk Engine
              </h2>
              <span className="bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 text-white text-[9.5px] font-black px-2.5 py-0.5 rounded-full flex items-center gap-1 shadow-xs tracking-wide">
                <Brain className="w-3 h-3" /> GEMINI 3.8 FLASH THINKING
              </span>
            </div>
            <p className="text-xs text-muted-foreground font-semibold mt-0.5">
              42,000+ bills ke XLS se Salesperson, Driver, Beat, Payment Mode, FBR ya Credit ko Supabase me bulk update karo. Full Read/Write Access!
            </p>
          </div>
        </div>

        {/* Gemini API Key Toggle Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowKeyInput(!showKeyInput)}
            className={cn(
              "text-[10px] font-extrabold px-3 py-1.5 rounded-xl border transition-all flex items-center gap-1.5 shadow-2xs",
              geminiApiKey.trim()
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-400 dark:border-emerald-800"
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
        <div className="bg-muted/50 border border-primary/20 rounded-xl p-3.5 space-y-2 animate-in fade-in duration-200">
          <div className="flex items-center justify-between">
            <label className="text-[10.5px] font-black uppercase tracking-wider text-foreground flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-amber-500" /> Enter Gemini API Key:
            </label>
            {geminiApiKey && (
              <span className="text-[9.5px] text-emerald-600 dark:text-emerald-400 font-bold">
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
              className="flex-1 text-xs px-3.5 py-2 rounded-xl border border-input bg-background font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
            {geminiApiKey && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => saveApiKey('')}
                className="text-xs font-bold text-destructive hover:bg-destructive/10 rounded-xl"
              >
                Clear
              </Button>
            )}
          </div>
          <p className="text-[9.5px] text-muted-foreground font-medium">
            Optional: Gemini API key for advanced reasoning & natural language parsing. Backend default will be used if left blank.
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
            className="flex flex-col sm:flex-row items-center justify-between gap-3 cursor-pointer group p-1"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-3.5 bg-emerald-500/10 text-emerald-600 rounded-2xl group-hover:scale-105 transition-all border border-emerald-500/20 shadow-xs">
                <FileSpreadsheet className="w-7 h-7" />
              </div>
              <div>
                <p className="text-xs sm:text-sm font-black text-foreground uppercase tracking-wider flex items-center gap-2">
                  <Upload className="w-4 h-4 text-emerald-600" /> Upload Excel File (Up to 50,000+ Bills)
                </p>
                <p className="text-[10.5px] text-muted-foreground font-medium mt-0.5">
                  Excel file upload karein jisme Bill No, Salesperson Name, Driver ya Collection data ho. AI unhe auto-detect karega!
                </p>
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[11px] uppercase tracking-wider px-5 py-2.5 rounded-xl shadow-md shrink-0 gap-2"
            >
              <Upload className="w-4 h-4" /> Select XLS File
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2.5">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-emerald-600 text-white rounded-xl shadow-sm">
                  <FileCheck className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs sm:text-sm font-black text-foreground">{uploadedFileName}</span>
                    <span className="bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-emerald-500/30">
                      {extractedBillNos.length.toLocaleString('en-IN')} Records Extracted
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground font-semibold mt-0.5">
                    Excel loaded. Auto-detected columns: Bill No ({columnMapping.billNo || 'None'}) | Salesperson ({columnMapping.salesperson || 'None'}) | Driver ({columnMapping.driver || 'None'})
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowColumnConfig(!showColumnConfig)}
                  className="text-[10px] font-black uppercase h-8 px-3 rounded-xl border-border"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5 mr-1.5 text-primary" />
                  {showColumnConfig ? 'Hide Mapping' : 'Column Mapping'}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setShowAllExtractedBills(!showAllExtractedBills)}
                  className="text-[10px] font-black uppercase h-8 px-3 rounded-xl border-border"
                >
                  <Layers className="w-3.5 h-3.5 mr-1.5 text-indigo-500" />
                  {showAllExtractedBills ? 'Hide List' : `View Bills (${extractedBillNos.length})`}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={handleClearFile}
                  className="text-[10px] font-bold text-destructive hover:bg-destructive/10 h-8 px-2.5 rounded-xl"
                >
                  <X className="w-4 h-4 mr-1" /> Clear File
                </Button>
              </div>
            </div>

            {/* Column Mapping Selector (if user wants to customize) */}
            {showColumnConfig && (
              <div className="p-3 bg-card border border-border/80 rounded-xl space-y-2 animate-in fade-in">
                <p className="text-[10px] font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <SlidersHorizontal className="w-3 h-3 text-primary" /> Excel Column to Database Field Mapping:
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 text-[10px]">
                  <div>
                    <label className="font-bold text-muted-foreground block mb-1">Bill No Column:</label>
                    <select
                      value={columnMapping.billNo}
                      onChange={(e) => setColumnMapping({ ...columnMapping, billNo: e.target.value })}
                      className="w-full bg-background border border-input rounded-lg p-1.5 font-medium text-xs"
                    >
                      <option value="">-- None --</option>
                      {detectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-muted-foreground block mb-1">Salesperson Column:</label>
                    <select
                      value={columnMapping.salesperson}
                      onChange={(e) => setColumnMapping({ ...columnMapping, salesperson: e.target.value })}
                      className="w-full bg-background border border-input rounded-lg p-1.5 font-medium text-xs"
                    >
                      <option value="">-- None --</option>
                      {detectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-muted-foreground block mb-1">Driver Column:</label>
                    <select
                      value={columnMapping.driver}
                      onChange={(e) => setColumnMapping({ ...columnMapping, driver: e.target.value })}
                      className="w-full bg-background border border-input rounded-lg p-1.5 font-medium text-xs"
                    >
                      <option value="">-- None --</option>
                      {detectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="font-bold text-muted-foreground block mb-1">Beat / Route Column:</label>
                    <select
                      value={columnMapping.beat}
                      onChange={(e) => setColumnMapping({ ...columnMapping, beat: e.target.value })}
                      className="w-full bg-background border border-input rounded-lg p-1.5 font-medium text-xs"
                    >
                      <option value="">-- None --</option>
                      {detectedHeaders.map(h => <option key={h} value={h}>{h}</option>)}
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Extracted Bill Numbers Chips list */}
            {showAllExtractedBills && (
              <div className="p-2.5 bg-background/90 border border-border rounded-xl max-h-36 overflow-y-auto space-y-1 animate-in fade-in">
                <div className="flex flex-wrap gap-1">
                  {extractedBillNos.slice(0, 200).map((bn, i) => (
                    <span key={i} className="text-[9px] font-mono font-bold bg-muted px-1.5 py-0.5 rounded border border-border text-foreground">
                      {bn}
                    </span>
                  ))}
                  {extractedBillNos.length > 200 && (
                    <span className="text-[9px] font-bold text-muted-foreground px-2 py-0.5">
                      ...and {(extractedBillNos.length - 200).toLocaleString('en-IN')} more
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Preset 1-Click Action Buttons for Fast Operations ── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1.5">
          <Zap className="w-3.5 h-3.5 text-amber-500" /> One-Click Quick Action Commands:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          {/* 1. Update Salesperson from XLS */}
          <button
            type="button"
            onClick={() => {
              const cmd = uploadedFileName
                ? `Ye ${extractedBillNos.length} bills ke xls data se sabhi sales person name ko supabase me update karo`
                : `Salesperson name ko XLS data se update karo`;
              setPrompt(cmd);
              handleAnalyze(cmd);
            }}
            className="p-2.5 rounded-xl border border-blue-300 dark:border-blue-800 bg-blue-500/10 hover:bg-blue-500/20 text-blue-800 dark:text-blue-200 text-left transition-all group col-span-2 sm:col-span-1"
          >
            <div className="flex items-center gap-1.5 mb-1">
              <UserCheck className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[10px] font-black uppercase tracking-wider text-blue-700 dark:text-blue-300">Salesperson Update</span>
            </div>
            <p className="text-[8.5px] text-muted-foreground font-semibold leading-tight">
              XLS column se sabhi Salesperson Names Supabase me sync karo
            </p>
          </button>

          {/* 2. Paid in Cash */}
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
              Rec Date + Mode Paid + Cash Amt = Net Amt
            </p>
          </button>

          {/* 3. Paid in UPI */}
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
              Rec Date + Mode Paid + UPI Amt = Net Amt
            </p>
          </button>

          {/* 4. Mark FBR */}
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
              Mode FBR + Goods Return + Rec Amt 0
            </p>
          </button>

          {/* 5. Mark Credit / Del Pending */}
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
              Mode Del Pending + Outstanding = Net Amt
            </p>
          </button>
        </div>
      </div>

      {/* ── Sample Prompt Chips ── */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
          <Zap className="w-3.5 h-3.5 text-amber-500" /> AI Command Suggestions (Click to fill):
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
              className="text-[10px] font-bold bg-muted/60 hover:bg-primary/15 hover:text-primary text-foreground border border-border px-2.5 py-1 rounded-lg transition-all text-left"
            >
              💡 {sp}
            </button>
          ))}
        </div>
      </div>

      {/* ── Voice Listening Indicator Banner ── */}
      {isListening && (
        <div className="bg-red-500/10 border border-red-500/40 text-red-600 dark:text-red-400 px-3.5 py-2.5 rounded-xl text-xs font-bold flex items-center justify-between animate-pulse">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-4 h-4 animate-ping text-red-500" />
            <span>Listening to voice command... Speak in Hindi, Hinglish, English, or Gujarati!</span>
          </div>
          <button
            onClick={toggleVoiceCommand}
            className="text-[10px] uppercase font-black bg-red-600 text-white px-2.5 py-1 rounded-md"
          >
            Stop Mic
          </button>
        </div>
      )}

      {/* ── Input Box & Voice Command Mic Button ── */}
      <div className="flex flex-col sm:flex-row gap-2.5">
        <div className="relative flex-1">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Type command or click Mic icon to speak (e.g. 'Ye 42000 bills ke xls data se sabhi sales person name ko supabase me update karo')..."
            rows={2}
            className="w-full text-xs p-3.5 pr-12 rounded-xl border border-input bg-background focus:outline-none focus:ring-2 focus:ring-primary/40 font-medium placeholder:text-muted-foreground resize-none"
          />
          <button
            type="button"
            onClick={toggleVoiceCommand}
            title={isListening ? "Stop Voice Command" : "Start Voice Command (Awaaz se bolo)"}
            className={cn(
              "absolute right-2.5 top-2.5 p-2.5 rounded-xl transition-all flex items-center justify-center",
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
          className="sm:self-stretch px-6 font-black uppercase text-xs gap-2 shrink-0 h-auto py-3 sm:py-0 shadow-md bg-primary hover:bg-primary/90 rounded-xl"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Thinking & Analyzing...
            </>
          ) : (
            <>
              <Search className="w-4 h-4" /> Execute AI Command
            </>
          )}
        </Button>
      </div>

      {/* ── Success Toast Message ── */}
      {resultMessage && (
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-400 text-emerald-800 dark:text-emerald-200 p-4 rounded-xl text-xs font-bold flex items-center justify-between shadow-sm animate-in fade-in">
          <span>{resultMessage}</span>
          <button onClick={() => setResultMessage(null)} className="text-xs underline font-black ml-3 shrink-0">Dismiss</button>
        </div>
      )}

      {/* ── Live Batch Execution Progress Bar ── */}
      {executing && executionProgress && (
        <div className="bg-primary/10 border-2 border-primary/40 rounded-2xl p-4 space-y-2 animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-black uppercase">
            <span className="flex items-center gap-2 text-primary">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Batch Updating Supabase ('zybrzzouzleacqjvfiiu') & App Memory...
            </span>
            <span className="font-mono text-foreground">
              {executionProgress.saved.toLocaleString('en-IN')} / {executionProgress.total.toLocaleString('en-IN')} (
              {Math.round((executionProgress.saved / Math.max(1, executionProgress.total)) * 100)}%)
            </span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 overflow-hidden border border-border">
            <div
              className="bg-gradient-to-r from-primary to-emerald-500 h-full transition-all duration-200"
              style={{ width: `${Math.round((executionProgress.saved / Math.max(1, executionProgress.total)) * 100)}%` }}
            />
          </div>
          <p className="text-[10px] text-muted-foreground font-semibold text-right">
            Chunk size: 800 bills per batch. No browser freeze, safe upsert on conflict 'id'.
          </p>
        </div>
      )}

      {/* ── Response Output ── */}
      {response && (
        <div className="space-y-4 pt-2 border-t border-border/60 animate-in fade-in-50">
          {response.error ? (
            <div className="bg-red-50 border border-red-300 text-red-700 p-3.5 rounded-xl text-xs font-medium flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{response.error}</span>
            </div>
          ) : (
            <>
              {/* ── AI Thinking & Reasoning Block ── */}
              {response.thinkingSteps && response.thinkingSteps.length > 0 && (
                <div className="bg-slate-900/90 text-slate-100 dark:bg-slate-950 dark:border-slate-800 border rounded-2xl p-4 space-y-2.5 shadow-md">
                  <div
                    className="flex items-center justify-between cursor-pointer"
                    onClick={() => setShowThinking(!showThinking)}
                  >
                    <div className="flex items-center gap-2">
                      <Brain className="w-4 h-4 text-purple-400 animate-pulse" />
                      <span className="text-xs font-black uppercase tracking-wider text-purple-300">
                        AI Reasoning & Thinking Process ({response.operationType || 'ANALYSIS'})
                      </span>
                    </div>
                    <button className="text-[10px] font-bold text-slate-400 hover:text-white flex items-center gap-1">
                      {showThinking ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {showThinking ? 'Collapse' : 'Expand Thoughts'}
                    </button>
                  </div>

                  {showThinking && (
                    <div className="space-y-1.5 pt-1 border-t border-slate-800 font-mono text-[10.5px]">
                      {response.thinkingSteps.map((step, idx) => (
                        <div key={idx} className="flex items-start gap-2 text-slate-300">
                          <span className="text-purple-400 font-bold shrink-0">▸</span>
                          <span>{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Explanation & Strategy Summary Banner ── */}
              <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-xs font-black text-primary uppercase">
                      Action Summary & Database Impact
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {response.matchedCount !== undefined && (
                      <span className="text-[10.5px] font-black bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 px-2.5 py-0.5 rounded-md border border-emerald-500/30">
                        Matched: {response.matchedCount.toLocaleString('en-IN')} Bills
                      </span>
                    )}
                    {response.patches && response.patches.length > 0 && (
                      <span className="text-[10.5px] font-black bg-blue-500/20 text-blue-700 dark:text-blue-300 px-2.5 py-0.5 rounded-md border border-blue-500/30">
                        To Update: {response.patches.length.toLocaleString('en-IN')}
                      </span>
                    )}
                    {(response.unmatchedCount || 0) > 0 && (
                      <span className="text-[10.5px] font-black bg-amber-500/20 text-amber-700 dark:text-amber-300 px-2.5 py-0.5 rounded-md border border-amber-500/30">
                        Not in DB: {response.unmatchedCount}
                      </span>
                    )}
                  </div>
                </div>

                <p className="text-xs font-medium text-foreground">{response.explanation}</p>
                {response.proposedActionText && (
                  <p className="text-[10.5px] font-bold text-muted-foreground italic">
                    ⚡ {response.proposedActionText}
                  </p>
                )}
              </div>

              {/* ── READ QUERY RESULTS (If user asked a question or summary) ── */}
              {response.queryStats && (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="p-3 bg-muted/50 border border-border rounded-xl">
                      <p className="text-[10px] font-bold text-muted-foreground uppercase">Total Bills</p>
                      <p className="text-base font-black text-foreground">{response.queryStats.totalBills.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                      <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 uppercase">Paid Bills</p>
                      <p className="text-base font-black text-emerald-600">{response.queryStats.paidCount.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                      <p className="text-[10px] font-bold text-amber-700 dark:text-amber-300 uppercase">FBR (Returns)</p>
                      <p className="text-base font-black text-amber-600">{response.queryStats.fbrCount.toLocaleString('en-IN')}</p>
                    </div>
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                      <p className="text-[10px] font-bold text-red-700 dark:text-red-300 uppercase">Total Outstanding</p>
                      <p className="text-base font-black text-red-600">₹{response.queryStats.outstandingAmount.toLocaleString('en-IN')}</p>
                    </div>
                  </div>

                  {response.queryStats.breakdown && response.queryStats.breakdown.length > 0 && (
                    <div className="border border-border rounded-xl overflow-hidden bg-card">
                      <div className="bg-muted/70 px-3 py-2 text-[10px] font-black uppercase text-foreground">
                        Top Breakdown Summary
                      </div>
                      <div className="divide-y divide-border text-[10px]">
                        {response.queryStats.breakdown.map((item, idx) => (
                          <div key={idx} className="flex items-center justify-between px-3 py-2">
                            <span className="font-bold text-foreground">{item.label}</span>
                            <div className="flex items-center gap-3">
                              <span className="text-muted-foreground">{item.count} bills</span>
                              <span className="font-mono font-bold text-primary">₹{item.amount.toLocaleString('en-IN')}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Unmatched Bills Warning (if any) ── */}
              {(response.unmatchedCount || 0) > 0 && response.unmatchedBillNos && (
                <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-800 dark:text-amber-200 p-3 rounded-xl text-[10.5px] space-y-1">
                  <div className="flex items-center gap-1.5 font-bold">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                    <span>{response.unmatchedCount} bills uploaded file me the par Database me nahi mile:</span>
                  </div>
                  <p className="font-mono text-[9.5px] text-muted-foreground break-all">
                    {response.unmatchedBillNos.slice(0, 20).join(', ')} {response.unmatchedBillNos.length > 20 ? `...and ${response.unmatchedBillNos.length - 20} more` : ''}
                  </p>
                </div>
              )}

              {/* ── Matched Bills Preview Table with Action Button ── */}
              {response.matchedBills && response.matchedBills.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2.5">
                    <div className="flex items-center gap-2">
                      <h3 className="text-xs font-black uppercase text-foreground tracking-wide flex items-center gap-1.5">
                        <FileCheck className="w-4 h-4 text-emerald-600" />
                        Live Database Bills Update Preview ({response.matchedBills.length.toLocaleString('en-IN')})
                      </h3>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={previewFilter}
                        onChange={(e) => setPreviewFilter(e.target.value)}
                        placeholder="Filter preview bills..."
                        className="text-xs px-2.5 py-1.5 rounded-lg border border-input bg-background w-36 sm:w-48 font-medium"
                      />

                      {response.patches && response.patches.length > 0 && (
                        <Button
                          onClick={() => setShowConfirm(true)}
                          size="sm"
                          className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-2 shadow-md px-5 py-2.5 rounded-xl"
                        >
                          <Zap className="w-4 h-4" /> Apply to Supabase & App ({response.patches.length.toLocaleString('en-IN')})
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden max-h-80 overflow-y-auto shadow-inner bg-card">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="bg-muted/90 sticky top-0 font-black text-muted-foreground uppercase text-[8.5px] tracking-wider border-b border-border z-10 backdrop-blur-xs">
                        <tr>
                          <th className="p-2.5">Bill No</th>
                          <th className="p-2.5">Party Name</th>
                          <th className="p-2.5">Current Salesperson</th>
                          <th className="p-2.5">New Proposed Salesperson</th>
                          <th className="p-2.5">Driver</th>
                          <th className="p-2.5 text-right">Net Amt</th>
                          <th className="p-2.5">Current Mode</th>
                          <th className="p-2.5">Proposed Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 font-medium">
                        {filteredMatchedBills.map((b) => (
                          <tr key={b.id || b.billNo} className="hover:bg-muted/40 transition-colors">
                            <td className="p-2.5 font-black text-primary font-mono">{b.billNo}</td>
                            <td className="p-2.5 truncate max-w-[140px]" title={b.partyName}>{b.partyName}</td>
                            <td className="p-2.5 text-muted-foreground">
                              {b.currentSalesperson || b.salespersonName || '-'}
                            </td>
                            <td className="p-2.5 font-bold">
                              {b.changes.salespersonName ? (
                                <span className="bg-blue-500/15 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded border border-blue-500/30">
                                  {b.changes.salespersonName}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-[9px]">Unchanged</span>
                              )}
                            </td>
                            <td className="p-2.5 uppercase text-muted-foreground">{b.driverName || '-'}</td>
                            <td className="p-2.5 text-right font-bold">₹{b.billNetAmt.toLocaleString('en-IN')}</td>
                            <td className="p-2.5">
                              <span className="px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase border border-border bg-muted">
                                {b.currentStatus}
                              </span>
                            </td>
                            <td className="p-2.5">
                              {b.proposedStatus !== b.currentStatus || b.proposedMethod ? (
                                <span className="px-2 py-0.5 rounded-md text-[8.5px] font-black uppercase bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1 w-max">
                                  <span>{b.proposedStatus}</span>
                                  {b.proposedMethod && b.proposedMethod !== '-' && (
                                    <span className="text-[7.5px] font-bold text-emerald-900 dark:text-emerald-100 bg-emerald-500/20 px-1 py-0.2 rounded">
                                      {b.proposedMethod}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-[8.5px]">No change</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {response.matchedBills.length > 100 && (
                    <p className="text-[10px] text-muted-foreground text-center font-medium">
                      Showing first 100 of {response.matchedBills.length.toLocaleString('en-IN')} bills in preview. All {response.patches?.length || 0} patches will be executed.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Confirmation Dialog for Bulk Write Operation ── */}
      {showConfirm && response && response.patches && (
        <div className="fixed inset-0 bg-black/75 z-[500] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-2xl p-6 w-full max-w-lg shadow-2xl border-2 border-emerald-500 animate-in zoom-in-95 space-y-4">
            <div className="flex items-center gap-3 pb-3 border-b border-border">
              <div className="p-3 bg-amber-500/10 text-amber-600 rounded-2xl border border-amber-500/20">
                <ShieldAlert className="w-6 h-6 shrink-0" />
              </div>
              <div>
                <h3 className="text-base font-black uppercase text-foreground">Confirm Database Write Execution</h3>
                <p className="text-xs text-muted-foreground font-semibold">
                  Aap {response.patches.length.toLocaleString('en-IN')} bill records ko Supabase ('zybrzzouzleacqjvfiiu') & App Memory me update karne ja rahe hain.
                </p>
              </div>
            </div>

            <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-950 dark:text-emerald-100 p-4 rounded-xl text-xs space-y-2">
              <p className="font-black uppercase tracking-wider text-[10.5px] text-emerald-700 dark:text-emerald-300">
                Execution Plan:
              </p>
              <p className="font-semibold text-xs leading-relaxed">{response.proposedActionText}</p>
              <div className="pt-2 text-[10px] font-bold text-muted-foreground grid grid-cols-2 gap-1.5">
                <span>✓ Chunked batches (800 rows)</span>
                <span>✓ No Browser Freeze</span>
                <span>✓ Supabase Locked Instance</span>
                <span>✓ Instant Memory Sync</span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConfirm(false)}
                disabled={executing}
                className="text-xs font-bold uppercase rounded-xl"
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleExecutePatches}
                disabled={executing}
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-2 px-5 py-2.5 shadow-md rounded-xl"
              >
                {executing ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" /> Executing Updates...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" /> Apply & Save ({response.patches.length.toLocaleString('en-IN')} Bills)
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
