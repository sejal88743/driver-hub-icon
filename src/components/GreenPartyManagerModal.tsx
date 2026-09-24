import { useState, useEffect } from 'react';
import { getGreenParties, saveGreenParties, addGreenParty, removeGreenParty, GreenParty } from '@/lib/greenParties';
import { applyGreenPartyUpdatesToBillsAndContacts } from '@/lib/billStore';
import { X, Search, Plus, Trash2, RefreshCw, CheckCircle2, FileText, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function GreenPartyManagerModal({ isOpen, onClose }: Props) {
  const [parties, setParties] = useState<GreenParty[]>([]);
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [bulkText, setBulkText] = useState('');
  const [showBulkInput, setShowBulkInput] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setParties(getGreenParties());
      setSyncStatus(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const filteredParties = parties.filter(
    p => p.partyCode.toLowerCase().includes(search.toLowerCase()) ||
         p.partyName.toLowerCase().includes(search.toLowerCase())
  );

  const handleAddSingle = () => {
    if (!newCode.trim() || !newName.trim()) return;
    const updated = addGreenParty(newCode.trim(), newName.trim());
    setParties(updated);
    setNewCode('');
    setNewName('');
  };

  const handleDelete = (code: string) => {
    const updated = removeGreenParty(code);
    setParties(updated);
  };

  const handleBulkAdd = () => {
    if (!bulkText.trim()) return;
    const lines = bulkText.split('\n');
    let addedCount = 0;
    const currentMap = new Map(parties.map(p => [p.partyCode.trim().toUpperCase(), p.partyName]));

    for (const line of lines) {
      const parts = line.split(/[\t,;]/).map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const code = parts[0].toUpperCase();
        const name = parts.slice(1).join(' ').toUpperCase();
        if (code && name) {
          currentMap.set(code, name);
          addedCount++;
        }
      }
    }

    const newList = Array.from(currentMap.entries()).map(([partyCode, partyName]) => ({ partyCode, partyName }));
    saveGreenParties(newList);
    setParties(newList);
    setBulkText('');
    setShowBulkInput(false);
    setSyncStatus(`Successfully imported/updated ${addedCount} parties!`);
  };

  const handleSyncDatabase = async () => {
    setIsSyncing(true);
    setSyncStatus('Updating bills & party master in database and memory...');
    try {
      const result = await applyGreenPartyUpdatesToBillsAndContacts();
      setSyncStatus(`Database Sync Complete! Updated ${result.billsUpdated} bills and ${result.contactsUpdated} party contacts.`);
    } catch (e) {
      console.error(e);
      setSyncStatus('Error syncing with database. Changes are saved locally.');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] bg-black/60 backdrop-blur-xs flex items-start justify-center pt-4 sm:pt-6 p-3 overflow-y-auto">
      <div className="bg-card text-card-foreground border border-emerald-500/30 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="bg-emerald-950 text-emerald-100 p-4 flex items-center justify-between border-b border-emerald-800">
          <div className="flex items-center gap-2">
            <span className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" />
            <div>
              <h2 className="text-base font-black uppercase tracking-wide flex items-center gap-2">
                Green Background Party Master
              </h2>
              <p className="text-[11px] font-medium text-emerald-300">
                {parties.length} parties set to display with Green Background in all driver tables, reports & PDFs
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-emerald-900/80 hover:bg-emerald-800 flex items-center justify-center text-emerald-200 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="p-3 bg-muted/30 border-b border-border space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search Party Code or Name..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-background rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkInput(!showBulkInput)}
                className="text-xs font-bold gap-1 cursor-pointer border-emerald-300 text-emerald-700 hover:bg-emerald-50"
              >
                <Upload className="w-3.5 h-3.5" />
                {showBulkInput ? 'Close Import' : 'Bulk Import CSV'}
              </Button>
              <Button
                size="sm"
                onClick={handleSyncDatabase}
                disabled={isSyncing}
                className="text-xs font-black gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer shadow-sm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                Sync Database Now
              </Button>
            </div>
          </div>

          {/* Sync status alert */}
          {syncStatus && (
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-xs font-bold text-emerald-800 dark:text-emerald-300">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
              <span className="flex-1">{syncStatus}</span>
            </div>
          )}

          {/* Bulk Import Textarea */}
          {showBulkInput && (
            <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 rounded-xl p-3 space-y-2">
              <p className="text-[11px] font-bold text-emerald-900 dark:text-emerald-200 uppercase">
                Paste Party Code and Party Name (Tab or Comma separated, one per line):
              </p>
              <textarea
                rows={4}
                value={bulkText}
                onChange={e => setBulkText(e.target.value)}
                placeholder="P3028, VARIETY DISTRIBUTOR&#10;P3076, PATEL TRADERS&#10;P3055, AKSHAR AGENCY"
                className="w-full p-2 text-xs font-mono bg-background border border-emerald-300 rounded-lg focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setShowBulkInput(false)} className="text-xs">
                  Cancel
                </Button>
                <Button size="sm" onClick={handleBulkAdd} className="text-xs font-bold bg-emerald-600 text-white">
                  Add to Green List
                </Button>
              </div>
            </div>
          )}

          {/* Add Single Party Form */}
          <div className="flex items-center gap-2 bg-background p-2 rounded-xl border border-border">
            <input
              type="text"
              placeholder="Party Code (e.g. P3028)"
              value={newCode}
              onChange={e => setNewCode(e.target.value)}
              className="w-1/3 px-2 py-1 text-xs uppercase bg-muted/40 rounded border border-border focus:outline-none"
            />
            <input
              type="text"
              placeholder="Party Name"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              className="flex-1 px-2 py-1 text-xs uppercase bg-muted/40 rounded border border-border focus:outline-none"
            />
            <Button size="sm" onClick={handleAddSingle} className="text-xs font-bold gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shrink-0">
              <Plus className="w-3.5 h-3.5" /> Add
            </Button>
          </div>
        </div>

        {/* List Table */}
        <div className="flex-1 overflow-y-auto p-3">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground font-black text-[10px] uppercase">
                <th className="text-left py-1.5 px-2">#</th>
                <th className="text-left py-1.5 px-2">Party Code</th>
                <th className="text-left py-1.5 px-2">Party Name (Green Display)</th>
                <th className="text-right py-1.5 px-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredParties.map((p, idx) => (
                <tr key={p.partyCode} className="border-b border-border/40 hover:bg-emerald-50/50 transition-colors">
                  <td className="py-1.5 px-2 text-muted-foreground font-mono">{idx + 1}</td>
                  <td className="py-1.5 px-2 font-mono font-bold text-emerald-900 dark:text-emerald-300">{p.partyCode}</td>
                  <td className="py-1.5 px-2 font-bold">
                    <span className="bg-emerald-200 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100 px-2 py-0.5 rounded font-black text-[11px] border border-emerald-400">
                      {p.partyName}
                    </span>
                  </td>
                  <td className="py-1.5 px-2 text-right">
                    <button
                      onClick={() => handleDelete(p.partyCode)}
                      className="text-rose-600 hover:text-rose-800 p-1 hover:bg-rose-50 rounded transition-colors cursor-pointer"
                      title="Remove from Green List"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
              {filteredParties.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-muted-foreground">
                    No green parties found matching &quot;{search}&quot;.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-3 bg-muted/40 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
          <span>Showing {filteredParties.length} of {parties.length} green parties</span>
          <Button size="sm" onClick={onClose} className="font-bold">
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
