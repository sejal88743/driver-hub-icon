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

  async function handleAnalyze(customPrompt?: string, customBillNos?: string[], customRows?: any[]) {
    const queryText = customPrompt !== undefined ? customPrompt : prompt;
    const targetBillNos = customBillNos || extractedBillNos;
    const targetRows = customRows || extractedRows;

    if (!queryText.trim() && targetBillNos.length === 0) return;

    setLoading(true);
    setResultMessage(null);
    try {
      const currentBills = getBills ? getBills() : [];

      const res = await fetch('/api/admin/ai-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(geminiApiKey.trim() ? { 'x-gemini-api-key': geminiApiKey.trim() } : {}),
        },
        body: JSON.stringify({
          action: 'analyze',
          prompt: queryText,
          billNos: targetBillNos.length > 0 ? targetBillNos : undefined,
          fileRows: targetRows.length > 0 ? targetRows : undefined,
          apiKey: geminiApiKey.trim() || undefined,
          bills: currentBills,
        }),
      });
      const data: AgentResponse = await res.json();
      if (!res.ok) {
        setResponse({ ok: false, error: data.error || `Server error (${res.status})` });
      } else {
        setResponse(data);
      }
    } catch (err: any) {
      setResponse({ ok: false, error: err.message || 'Failed to communicate with AI Agent' });
    } finally {
      setLoading(false);
    }
  }

  async function handleExecutePatches() {
    if (!response || !response.patches || response.patches.length === 0) return;

    setExecuting(true);
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
      const data = await res.json();

      if (data.ok) {
        // Update client-side local memory store in browser
        const memPatches = response.patches.map(p => ({
          billNo: p.billNo,
          patch: p.changes,
        }));
        await patchBillsInMemory(memPatches);

        setResultMessage(`✅ ${data.updatedCount || response.patches.length} bills successfully updated in PostgreSQL Database & App Memory! (Payment Mode, Rec Date, Cash & Collection Amounts Updated)`);
        setShowConfirm(false);
        
        // Refresh analysis
        handleAnalyze();
      } else {
        alert(`Error executing DB update: ${data.error}`);
      }
    } catch (err: any) {
      alert(`Execution error: ${err.message}`);
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

