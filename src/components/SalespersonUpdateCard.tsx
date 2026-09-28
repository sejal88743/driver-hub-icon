import React, { useState, useRef, useMemo } from 'react';
import { 
  Users, 
  FileSpreadsheet, 
  Upload, 
  CheckCircle2, 
  AlertCircle, 
  Loader2, 
  ArrowRight, 
  RefreshCw, 
  Clipboard, 
  Check, 
  ChevronDown, 
  ChevronUp,
  Search,
  Filter
} from 'lucide-react';
import { 
  parseSalespersonRegister, 
  syncSalespersonUpdatesToSupabase, 
  type SalespersonSyncRow, 
  type ParseSalespersonResult 
} from '@/lib/salespersonSync';
import { useBillStore } from '@/hooks/use-bill-store';

export default function SalespersonUpdateCard() {
  const { syncFromApi } = useBillStore();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);

  const [parseResult, setParseResult] = useState<ParseSalespersonResult | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [preferMaster, setPreferMaster] = useState(true);

  const [showPasteText, setShowPasteText] = useState(false);
  const [pastedText, setPastedText] = useState('');

  const [filterTab, setFilterTab] = useState<'all' | 'will_update' | 'already_matches' | 'not_found'>('will_update');
  const [searchQuery, setSearchQuery] = useState('');

  const [successResult, setSuccessResult] = useState<{
    updated: number;
    skipped: number;
    notFound: number;
  } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Handle File Input
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    setFileName(file.name);
    setSuccessResult(null);
    setErrorMessage(null);
    setLoading(true);
    setProgressMsg('Reading and parsing file...');

    try {
      const buffer = await file.arrayBuffer();
      const res = await parseSalespersonRegister(buffer, { preferMasterNames: preferMaster });
      setParseResult(res);
      // If there are bills to update, default to 'will_update' filter tab
      const toUpdate = res.rows.filter(r => r.status === 'will_update');
      if (toUpdate.length > 0) {
        setFilterTab('will_update');
      } else {
        setFilterTab('all');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'File parse karne me error aaya.');
      setParseResult(null);
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  // Handle Pasted Text Parse
  const handleParsePastedText = async () => {
    if (!pastedText.trim()) return;
    setFileName('Pasted CSV Text');
    setSuccessResult(null);
    setErrorMessage(null);
    setLoading(true);
    setProgressMsg('Parsing CSV text...');

    try {
      const res = await parseSalespersonRegister(pastedText, { preferMasterNames: preferMaster });
      setParseResult(res);
      const toUpdate = res.rows.filter(r => r.status === 'will_update');
      if (toUpdate.length > 0) {
        setFilterTab('will_update');
      } else {
        setFilterTab('all');
      }
      setShowPasteText(false);
    } catch (err: any) {
      setErrorMessage(err.message || 'CSV text parse karne me error aaya.');
      setParseResult(null);
    } finally {
      setLoading(false);
      setProgressMsg('');
    }
  };

  // Apply Changes to Supabase
  const handleApplyUpdates = async () => {
    if (!parseResult || parseResult.rows.length === 0) return;

    setSyncing(true);
    setErrorMessage(null);
    setProgressPercent(0);

    try {
      const res = await syncSalespersonUpdatesToSupabase(parseResult.rows, (done, total, msg) => {
        setProgressMsg(msg);
        setProgressPercent(total > 0 ? Math.round((done / total) * 100) : 0);
      });

      setSuccessResult({
        updated: res.updatedCount,
        skipped: res.skippedCount,
        notFound: res.notFoundCount,
      });

      // Update statuses in the preview rows
      setParseResult(prev => {
        if (!prev) return null;
        return {
          ...prev,
          rows: prev.rows.map(r => {
            if (r.status === 'will_update') {
              return {
                ...r,
                currentDbSalesperson: r.finalSalesperson,
                status: 'already_matches',
              };
            }
            return r;
          }),
        };
      });

      // Trigger background sync to refresh bill store
      void syncFromApi(true);
    } catch (err: any) {
      setErrorMessage(err.message || 'Database update karte waqt error aaya.');
    } finally {
      setSyncing(false);
      setProgressMsg('');
    }
  };

  // Filtered rows for preview table
  const filteredRows = useMemo(() => {
    if (!parseResult) return [];
    return parseResult.rows.filter(r => {
      // Tab filter
      if (filterTab === 'will_update' && r.status !== 'will_update') return false;
      if (filterTab === 'already_matches' && r.status !== 'already_matches') return false;
      if (filterTab === 'not_found' && r.status !== 'not_found_in_db') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const b = (r.billNo || '').toLowerCase();
        const p = (r.partyName || '').toLowerCase();
        const sp = (r.finalSalesperson || '').toLowerCase();
        const cur = (r.currentDbSalesperson || '').toLowerCase();
        return b.includes(q) || p.includes(q) || sp.includes(q) || cur.includes(q);
      }
      return true;
    });
  }, [parseResult, filterTab, searchQuery]);

  const stats = useMemo(() => {
    if (!parseResult) return { willUpdate: 0, alreadyMatches: 0, notFound: 0, total: 0 };
    let willUpdate = 0;
    let alreadyMatches = 0;
    let notFound = 0;
    for (const r of parseResult.rows) {
      if (r.status === 'will_update') willUpdate++;
      else if (r.status === 'already_matches') alreadyMatches++;
      else if (r.status === 'not_found_in_db') notFound++;
    }
    return { willUpdate, alreadyMatches, notFound, total: parseResult.rows.length };
  }, [parseResult]);

  return (
    <div id="salesperson-sync-card" className="bg-card rounded-xl p-3 border-2 border-emerald-300 shadow-md">
      {/* Header */}
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[12px] font-black uppercase flex items-center gap-2 text-emerald-700">
          <Users className="w-4 h-4 text-emerald-600" /> Salesperson Name Update (Bill No Wise)
        </h2>
        <span className="text-[8px] font-black bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full uppercase tracking-wider">
          XLS / CSV / LeverEDGE
        </span>
      </div>

      <p className="text-[9px] font-bold text-muted-foreground uppercase mb-2 leading-tight">
        Sales Register file (CSV / XLS / XLSX) upload ya paste karo. Har <span className="text-emerald-700 font-black">Bill No</span> ke mutabiq sahi <span className="text-emerald-700 font-black">Salesperson (Salesman) Name</span> database me update ho jayega.
      </p>

      {/* Upload & Action Buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-2">
        {/* Upload File Box */}
        <div
          onClick={() => fileInputRef.current?.click()}
          className="border-2 border-dashed rounded-xl p-2.5 flex items-center gap-2.5 cursor-pointer hover:bg-emerald-50/50 transition-all border-emerald-300 bg-emerald-50/20"
        >
          {loading ? (
            <Loader2 className="w-5 h-5 animate-spin text-emerald-600 shrink-0" />
          ) : (
            <FileSpreadsheet className="w-5 h-5 text-emerald-600 shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-wider text-emerald-800 truncate">
              {fileName || 'Upload Sales Register (CSV / XLS)'}
            </p>
            <p className="text-[8px] font-bold text-emerald-600/80">
              Click to select LeverEDGE .csv or .xlsx
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        {/* Paste CSV Text Button */}
        <div
          onClick={() => setShowPasteText(!showPasteText)}
          className="border-2 border-dashed rounded-xl p-2.5 flex items-center justify-between gap-2 cursor-pointer hover:bg-slate-50 transition-all border-slate-300 bg-slate-50/30"
        >
          <div className="flex items-center gap-2">
            <Clipboard className="w-4 h-4 text-slate-600 shrink-0" />
            <span className="text-[10px] font-black uppercase tracking-wider text-slate-800">
              Paste CSV / Text
            </span>
          </div>
          {showPasteText ? <ChevronUp className="w-4 h-4 text-slate-500" /> : <ChevronDown className="w-4 h-4 text-slate-500" />}
        </div>
      </div>

      {/* Paste Text Area */}
      {showPasteText && (
        <div className="mb-3 p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
          <p className="text-[8px] font-bold text-slate-600 uppercase">
            CSV File ki lines (BillRefNo, Salesperson Name, etc.) yahan paste karein:
          </p>
          <textarea
            value={pastedText}
            onChange={e => setPastedText(e.target.value)}
            placeholder="Paste CSV rows here (e.g. BillRefNo, Salesperson Name...)"
            rows={4}
            className="w-full text-[10px] font-mono p-2 border rounded-lg bg-background focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={() => { setShowPasteText(false); setPastedText(''); }}
              className="px-2.5 py-1 text-[9px] font-bold border rounded-lg hover:bg-slate-200"
            >
              Cancel
            </button>
            <button
              onClick={handleParsePastedText}
              disabled={loading || !pastedText.trim()}
              className="px-3 py-1 text-[9px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg flex items-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              {loading && <Loader2 className="w-3 h-3 animate-spin" />}
              Parse Pasted CSV
            </button>
          </div>
        </div>
      )}

      {/* Options Row */}
      <div className="flex items-center justify-between px-1 py-1 mb-2 bg-muted/40 rounded-lg text-[9px] font-bold text-muted-foreground">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={preferMaster}
            onChange={e => {
              setPreferMaster(e.target.checked);
              // Re-parse if we have raw text or file
              if (pastedText && showPasteText) {
                void handleParsePastedText();
              }
            }}
            className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
          />
          <span>Master Salesperson Names Standardize karein (Recommended)</span>
        </label>
        {parseResult && (
          <span className="text-[8px] font-mono bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded">
            {parseResult.uniqueBills} Bills Found
          </span>
        )}
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-[9px] font-bold text-red-700">
          <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Success Message */}
      {successResult && (
        <div className="mb-2 p-2.5 bg-emerald-50 border border-emerald-300 rounded-xl space-y-1">
          <div className="flex items-center gap-2 text-[10px] font-black text-emerald-800 uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            Database Updated Successfully!
          </div>
          <p className="text-[9px] font-bold text-emerald-700">
            ✅ <span className="font-black">{successResult.updated}</span> Bills ka Salesperson Name Supabase me update ho gaya!
            {successResult.skipped > 0 && ` • ${successResult.skipped} bills pehle se match the.`}
            {successResult.notFound > 0 && ` • ${successResult.notFound} bills database me nahi mile.`}
          </p>
        </div>
      )}

      {/* Progress Bar */}
      {syncing && (
        <div className="mb-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl space-y-1.5">
          <div className="flex items-center justify-between text-[9px] font-black text-emerald-800 uppercase">
            <span className="flex items-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
              {progressMsg || 'Updating Supabase...'}
            </span>
            <span>{progressPercent}%</span>
          </div>
          <div className="w-full bg-emerald-200 h-2 rounded-full overflow-hidden">
            <div
              className="bg-emerald-600 h-full transition-all duration-200"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Parsed Results Overview */}
      {parseResult && (
        <div className="space-y-2 mt-2 pt-2 border-t border-slate-200">
          {/* Stats Bar */}
          <div className="grid grid-cols-4 gap-1 text-center">
            <button
              onClick={() => setFilterTab('all')}
              className={`p-1.5 rounded-lg border text-left transition-all ${
                filterTab === 'all' ? 'border-slate-800 bg-slate-100 font-black' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[8px] font-bold text-slate-500 uppercase">Total in File</div>
              <div className="text-[12px] font-black text-slate-800">{stats.total}</div>
            </button>

            <button
              onClick={() => setFilterTab('will_update')}
              className={`p-1.5 rounded-lg border text-left transition-all ${
                filterTab === 'will_update' ? 'border-amber-600 bg-amber-50 font-black ring-1 ring-amber-400' : 'border-amber-200 bg-amber-50/50'
              }`}
            >
              <div className="text-[8px] font-bold text-amber-700 uppercase">Will Update</div>
              <div className="text-[12px] font-black text-amber-700">{stats.willUpdate}</div>
            </button>

            <button
              onClick={() => setFilterTab('already_matches')}
              className={`p-1.5 rounded-lg border text-left transition-all ${
                filterTab === 'already_matches' ? 'border-emerald-600 bg-emerald-50 font-black ring-1 ring-emerald-400' : 'border-emerald-200 bg-emerald-50/50'
              }`}
            >
              <div className="text-[8px] font-bold text-emerald-700 uppercase">Already OK</div>
              <div className="text-[12px] font-black text-emerald-700">{stats.alreadyMatches}</div>
            </button>

            <button
              onClick={() => setFilterTab('not_found')}
              className={`p-1.5 rounded-lg border text-left transition-all ${
                filterTab === 'not_found' ? 'border-slate-600 bg-slate-100 font-black ring-1 ring-slate-400' : 'border-slate-200 bg-slate-50'
              }`}
            >
              <div className="text-[8px] font-bold text-slate-500 uppercase">Not In DB</div>
              <div className="text-[12px] font-black text-slate-600">{stats.notFound}</div>
            </button>
          </div>

          {/* Action Button */}
          <div className="flex items-center justify-between gap-2 pt-1">
            <div className="text-[9px] font-bold text-slate-600">
              {stats.willUpdate > 0 ? (
                <span>
                  <strong className="text-amber-700">{stats.willUpdate}</strong> bills me naya salesman name update hoga.
                </span>
              ) : (
                <span className="text-emerald-700 font-black">Sabhi bills already up-to-date hain!</span>
              )}
            </div>

            <button
              onClick={handleApplyUpdates}
              disabled={syncing || stats.willUpdate === 0}
              className="px-4 py-2 text-[10px] font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-md flex items-center gap-2 disabled:opacity-50 transition-all hover:scale-[1.01]"
            >
              {syncing ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Updating Database...
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  Apply {stats.willUpdate} Salesperson Updates
                </>
              )}
            </button>
          </div>

          {/* Search & Filter Header for Table */}
          <div className="flex items-center gap-2 pt-1">
            <div className="relative flex-1">
              <Search className="w-3 h-3 text-muted-foreground absolute left-2 top-2.5" />
              <input
                type="text"
                placeholder="Search Bill No, Party, Salesman..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-7 pr-2 py-1 text-[9px] border rounded-lg bg-background focus:outline-none"
              />
            </div>
            <span className="text-[8px] font-bold text-muted-foreground shrink-0">
              Showing {filteredRows.length} of {parseResult.rows.length}
            </span>
          </div>

          {/* Preview Table */}
          <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto bg-background">
            <table className="w-full text-left text-[9px]">
              <thead className="bg-muted sticky top-0 text-[8px] font-black uppercase text-muted-foreground tracking-wider border-b">
                <tr>
                  <th className="p-1.5">Bill No</th>
                  <th className="p-1.5">Party</th>
                  <th className="p-1.5">Current in DB</th>
                  <th className="p-1.5">New in File</th>
                  <th className="p-1.5 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredRows.slice(0, 100).map(row => (
                  <tr key={row.billNo} className="hover:bg-slate-50/80 transition-colors">
                    <td className="p-1.5 font-mono font-black text-slate-800 whitespace-nowrap">
                      {row.billNo}
                    </td>
                    <td className="p-1.5 truncate max-w-[120px] text-slate-600 font-bold" title={row.partyName}>
                      {row.partyName || '-'}
                    </td>
                    <td className="p-1.5 truncate max-w-[130px] text-slate-500 font-medium" title={row.currentDbSalesperson}>
                      {row.currentDbSalesperson || <span className="italic text-slate-400">Empty</span>}
                    </td>
                    <td className="p-1.5 truncate max-w-[150px] font-bold text-emerald-800" title={row.finalSalesperson}>
                      {row.finalSalesperson}
                    </td>
                    <td className="p-1.5 text-center whitespace-nowrap">
                      {row.status === 'will_update' && (
                        <span className="text-[7.5px] font-black bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded-full uppercase">
                          Will Update
                        </span>
                      )}
                      {row.status === 'already_matches' && (
                        <span className="text-[7.5px] font-black bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded-full uppercase">
                          Matches
                        </span>
                      )}
                      {row.status === 'not_found_in_db' && (
                        <span className="text-[7.5px] font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full uppercase">
                          Not In DB
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredRows.length > 100 && (
              <div className="p-1 text-center text-[8px] text-muted-foreground bg-muted/30">
                Showing first 100 rows ({filteredRows.length - 100} more hidden)
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
