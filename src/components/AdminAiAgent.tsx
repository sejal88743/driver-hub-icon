import React, { useState, useRef } from 'react';
import { Bot, Sparkles, Search, CheckCircle2, AlertTriangle, ArrowRight, RefreshCw, Database, ShieldAlert, Zap, Mic, MicOff, Key, Volume2 } from 'lucide-react';
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
  changes: Record<string, any>;
};

type AgentResponse = {
  ok: boolean;
  explanation?: string;
  matchedCount?: number;
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
    "Ese bills find karo jis me REC me amt add he fir bhi FBR show kar raha he",
    "Jo bill me REC amt he or diff 0 he vah sab me status Paid karo",
    "FBR status vale bills jisme rec amount 0 hai unhe list karo",
    "Salesperson 'RAHUL' ke unpaid bills check karo",
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
      // 1. Explicitly request microphone stream permission to work inside iframe
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
      recognition.lang = 'hi-IN'; // Hindi-India / Hinglish recognition

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

  async function handleAnalyze(customPrompt?: string) {
    const queryText = customPrompt || prompt;
    if (!queryText.trim()) return;

    setLoading(true);
    setResultMessage(null);
    try {
      // Fetch current client-side bills as fallback data
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
        // Update local memory store in browser as well
        const memPatches = response.patches.map(p => ({
          billNo: p.billNo,
          patch: p.changes,
        }));
        patchBillsInMemory(memPatches);

        setResultMessage(`✅ ${data.updatedCount || response.patches.length} bills successfully updated in database & memory!`);
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
      <div className="flex items-center justify-between pb-3 border-b border-border/60">
        <div className="flex items-center gap-2.5">
          <div className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Bot className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-black uppercase text-foreground tracking-wider">
                Admin Database AI Agent
              </h2>
              <span className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white text-[9px] font-black px-2 py-0.5 rounded-full flex items-center gap-1 shadow-xs">
                <Sparkles className="w-2.5 h-2.5" /> GEMINI 3.6
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5">
              Ask AI in Hinglish/English or Voice Command to find, analyze, or bulk edit database records safely.
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
            Optional: If provided, AI Agent will use your personal Gemini API key for analysis.
          </p>
        </div>
      )}

      {/* ── Sample Prompt Chips ── */}
      <div className="space-y-1.5">
        <p className="text-[9px] font-black uppercase text-muted-foreground tracking-wider flex items-center gap-1">
          <Zap className="w-3 h-3 text-amber-500" /> Quick Commands (Click to run):
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
            <span>Listening to voice command... Speak in Hindi or English!</span>
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
            placeholder="Type command or click Mic icon to speak (e.g., 'Ese bills find karo jis me REC me amt add he fir bhi FBR show kar raha he')..."
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
          disabled={loading || !prompt.trim()}
          className="sm:self-stretch px-5 font-black uppercase text-xs gap-2 shrink-0 h-auto py-2.5 sm:py-0 shadow-md"
        >
          {loading ? (
            <>
              <RefreshCw className="w-4 h-4 animate-spin" /> Analyzing DB...
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
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-400 text-emerald-800 dark:text-emerald-200 p-3 rounded-xl text-xs font-bold flex items-center justify-between">
          <span>{resultMessage}</span>
          <button onClick={() => setResultMessage(null)} className="text-xs underline font-black">Dismiss</button>
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
              {/* Explanation Banner */}
              <div className="bg-primary/5 border border-primary/20 rounded-xl p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Database className="w-4 h-4 text-primary" />
                    <span className="text-xs font-black text-primary uppercase">AI Findings & Logic</span>
                  </div>
                  <span className="text-[10px] font-black bg-primary/20 text-primary px-2 py-0.5 rounded-md">
                    Matched: {response.matchedCount || 0} Bills
                  </span>
                </div>
                <p className="text-xs font-medium text-foreground">{response.explanation}</p>
                {response.proposedActionText && (
                  <p className="text-[10px] font-bold text-muted-foreground italic">
                    {response.proposedActionText}
                  </p>
                )}
              </div>

              {/* Matched Bills Preview Table */}
              {response.matchedBills && response.matchedBills.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-[11px] font-black uppercase text-foreground tracking-wide">
                      Matched Database Bills Preview ({response.matchedBills.length})
                    </h3>
                    {response.patches && response.patches.length > 0 && (
                      <Button
                        onClick={() => setShowConfirm(true)}
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-[10px] uppercase gap-1.5 shadow-sm"
                      >
                        <Zap className="w-3.5 h-3.5" /> Apply Write/Edit ({response.patches.length})
                      </Button>
                    )}
                  </div>

                  <div className="border border-border rounded-xl overflow-hidden max-h-64 overflow-y-auto">
                    <table className="w-full text-left border-collapse text-[10px]">
                      <thead className="bg-muted/80 sticky top-0 font-black text-muted-foreground uppercase text-[8px] tracking-wider border-b border-border">
                        <tr>
                          <th className="p-2">Bill No</th>
                          <th className="p-2">Party Name</th>
                          <th className="p-2">Driver</th>
                          <th className="p-2 text-right">Net Amt</th>
                          <th className="p-2 text-right">Rec Amt</th>
                          <th className="p-2 text-right">Line Cut</th>
                          <th className="p-2 text-right">Diff</th>
                          <th className="p-2">Current Status</th>
                          <th className="p-2">Proposed Update</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40 font-medium">
                        {response.matchedBills.map((b) => (
                          <tr key={b.id || b.billNo} className="hover:bg-muted/30">
                            <td className="p-2 font-black text-primary">{b.billNo}</td>
                            <td className="p-2 truncate max-w-[120px]">{b.partyName}</td>
                            <td className="p-2 uppercase">{b.driverName || '-'}</td>
                            <td className="p-2 text-right font-bold">₹{b.billNetAmt}</td>
                            <td className="p-2 text-right font-bold text-emerald-600">₹{b.collectedAmount}</td>
                            <td className="p-2 text-right text-muted-foreground">₹{b.lineCutAmt}</td>
                            <td className="p-2 text-right font-black text-amber-600">₹{b.diff}</td>
                            <td className="p-2">
                              <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase border border-border bg-muted">
                                {b.currentStatus}
                              </span>
                            </td>
                            <td className="p-2">
                              {b.proposedStatus !== b.currentStatus ? (
                                <span className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase bg-emerald-100 dark:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-300 flex items-center gap-1 w-max">
                                  {b.currentStatus} <ArrowRight className="w-2.5 h-2.5" /> {b.proposedStatus}
                                </span>
                              ) : (
                                <span className="text-muted-foreground text-[8px]">No change</span>
                              )}
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
        <div className="fixed inset-0 bg-black/60 z-[500] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-2xl p-5 w-full max-w-md shadow-2xl border-2 border-emerald-500 animate-in zoom-in-95 space-y-3">
            <div className="flex items-center gap-2 pb-2 border-b border-border">
              <ShieldAlert className="w-6 h-6 text-amber-500 shrink-0" />
              <div>
                <h3 className="text-sm font-black uppercase text-foreground">Confirm Database Write</h3>
                <p className="text-[10px] text-muted-foreground font-semibold">
                  You are about to update {response.patches.length} bill records in PostgreSQL.
                </p>
              </div>
            </div>

            <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 text-amber-800 dark:text-amber-200 p-3 rounded-xl text-xs space-y-1">
              <p className="font-bold">Proposed Action:</p>
              <p className="font-medium text-[11px]">{response.proposedActionText}</p>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
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
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase gap-1.5"
              >
                {executing ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Executing Updates...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Confirm & Execute ({response.patches.length})
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
