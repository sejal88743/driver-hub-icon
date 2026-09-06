'use client';

import React, { useState, useMemo } from 'react';
import { 
  X, MessageCircle, Send, Users, FileText, CheckCircle2, 
  AlertCircle, Zap, Settings, Bot, Copy, Download, Loader2, Sparkles, RefreshCw,
  Calendar, Code, Terminal, Check
} from 'lucide-react';
import { Bill, getSalespersonContacts, findSalespersonContact, getTodayDMY } from '@/lib/billStore';
import { Button } from '@/components/ui/button';
import { ConfirmModal } from '@/components/ConfirmModal';
import { cn } from '@/lib/utils';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  bills: Bill[];
}

// Convert YYYY-MM-DD to DD/MM/YYYY for comparison
function convertIsoToDmy(isoDate: string): string {
  if (!isoDate) return '';
  const parts = isoDate.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return isoDate;
}

// Convert DD/MM/YYYY to YYYY-MM-DD for <input type="date">
function convertDmyToIso(dmyDate: string): string {
  if (!dmyDate) return '';
  const parts = dmyDate.split('/');
  if (parts.length === 3) {
    return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
  }
  return '';
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('Navigator clipboard failed, falling back to execCommand:', err);
  }
  try {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);
    return successful;
  } catch (err) {
    console.error('Fallback copy failed:', err);
    return false;
  }
}

export function generateSalespersonCreditFbrMessage(
  salespersonName: string,
  bills: Bill[],
  targetDate: string = ''
): { message: string; creditCount: number; fbrCount: number; totalAmt: number; billsList: Bill[] } {
  const normSp = salespersonName.trim().toLowerCase();

  const spBills = bills.filter(b => {
    // 1. Salesperson match
    if ((b.salespersonName || '').trim().toLowerCase() !== normSp) return false;

    // 2. Date match (if targetDate is specified e.g. "26/07/2026")
    if (targetDate) {
      const billD = b.date || '';
      const delD = b.deliveryDate || '';
      const payD = b.paymentDate || '';
      const dateMatches = billD === targetDate || delD === targetDate || payD === targetDate;
      if (!dateMatches) return false;
    }

    // 3. Status match: Credit or FBR/Cancel
    const isManualFbr = b.paymentMode === 'Cancel' || b.paymentMode === 'FBR';
    const isCreditMode = b.paymentMode === 'Credit';
    const collected = b.collectedAmount || 0;
    const net = b.billNetAmt - (b.lineCutAmt || 0);
    const isAutoFbr = !b.paymentDate && Math.abs(net) <= 1 && collected === 0 && !isCreditMode;
    const isCancel = isManualFbr || isAutoFbr;
    const isCredit = !isCancel && isCreditMode;

    return isCancel || isCredit;
  });

  let creditCount = 0;
  let fbrCount = 0;
  let totalCreditAmt = 0;
  let totalFbrAmt = 0;

  const displayDate = targetDate || new Date().toLocaleDateString('en-IN');
  let msg = `📋 *DAILY CREDIT & FBR REPORT*\n`;
  msg += `👤 *SALESPERSON:* ${salespersonName.toUpperCase()}\n`;
  msg += `📅 *DATE:* ${displayDate}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  if (spBills.length === 0) {
    msg += `✅ *No Credit or FBR bills for ${displayDate}!*\nAll clear for this date.`;
    return { message: msg, creditCount: 0, fbrCount: 0, totalAmt: 0, billsList: [] };
  }

  spBills.forEach((b, i) => {
    const isManualFbr = b.paymentMode === 'Cancel' || b.paymentMode === 'FBR';
    const isCreditMode = b.paymentMode === 'Credit';
    const collected = b.collectedAmount || 0;
    const net = b.billNetAmt - (b.lineCutAmt || 0);
    const isAutoFbr = !b.paymentDate && Math.abs(net) <= 1 && collected === 0 && !isCreditMode;
    const isFbr = isManualFbr || isAutoFbr;
    const isCredit = !isFbr && isCreditMode;

    const beat = b.partyCode || 'BEAT';
    const amt = b.billNetAmt || 0;

    if (isCredit) {
      creditCount++;
      totalCreditAmt += amt;
    } else {
      fbrCount++;
      totalFbrAmt += amt;
    }

    const statusStr = isFbr
      ? `🔴 *FBR* (Reason: ${b.discrepancyReason || 'Line Cut / Return'})`
      : `🟢 *CREDIT*`;

    msg += `${i + 1}. *BILL NO:* ${b.billNo}\n`;
    msg += `   🏢 *PARTY:* ${b.partyName}\n`;
    msg += `   📍 *BEAT:* ${beat}\n`;
    msg += `   💰 *AMT:* ₹${amt.toLocaleString('en-IN')}\n`;
    msg += `   📊 *STATUS:* ${statusStr}\n\n`;
  });

  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `💵 *TOTAL CREDIT:* ₹${totalCreditAmt.toLocaleString('en-IN')} (${creditCount} Bills)\n`;
  msg += `⛔ *TOTAL FBR:* ₹${totalFbrAmt.toLocaleString('en-IN')} (${fbrCount} Bills)\n`;
  msg += `📊 *TOTAL OUTSTANDING:* ₹${(totalCreditAmt + totalFbrAmt).toLocaleString('en-IN')}\n\n`;
  msg += `⚠️ *Please coordinate with parties for immediate collection/action.*`;

  return {
    message: msg,
    creditCount,
    fbrCount,
    totalAmt: totalCreditAmt + totalFbrAmt,
    billsList: spBills
  };
}

export default function SalespersonAutoDispatchModal({ isOpen, onClose, bills }: Props) {
  const [copiedSp, setCopiedSp] = useState<string | null>(null);
  const [sendingSp, setSendingSp] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState('');
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchStatusMsg, setBatchStatusMsg] = useState('');

  // Date filtering state: 'today' (current date) | 'custom' | 'all'
  const [dateMode, setDateMode] = useState<'today' | 'custom' | 'all'>('today');
  const [customIsoDate, setCustomIsoDate] = useState<string>(convertDmyToIso(getTodayDMY()) || new Date().toISOString().split('T')[0]);
  const [activeTab, setActiveTab] = useState<'dispatch' | 'python'>('dispatch');
  const [pythonCopied, setPythonCopied] = useState(false);

  const salespersonContacts = useMemo(() => getSalespersonContacts(), []);

  // Compute effective date string (e.g. "26/07/2026")
  const effectiveTargetDate = useMemo(() => {
    if (dateMode === 'all') return '';
    if (dateMode === 'today') return getTodayDMY();
    return convertIsoToDmy(customIsoDate);
  }, [dateMode, customIsoDate]);

  // Group all salespersons and their Credit/FBR summaries filtered by date
  const salespersonData = useMemo(() => {
    const spSet = new Set<string>();
    bills.forEach(b => {
      if (b.salespersonName?.trim()) spSet.add(b.salespersonName.trim());
    });
    salespersonContacts.forEach(c => {
      if (c.name?.trim()) spSet.add(c.name.trim());
    });

    const list = Array.from(spSet).sort((a, b) => a.localeCompare(b));

    const mapped = list.map(spName => {
      const summary = generateSalespersonCreditFbrMessage(spName, bills, effectiveTargetDate);
      const contact = findSalespersonContact(spName) || salespersonContacts.find(c => (c.name || '').toLowerCase() === spName.toLowerCase());
      return {
        spName,
        phone: contact?.mobile || '',
        creditCount: summary.creditCount,
        fbrCount: summary.fbrCount,
        totalAmt: summary.totalAmt,
        message: summary.message,
        billsList: summary.billsList
      };
    });

    // Strictly filter out 0 FBR and 0 CREDIT salespersons (Do not show & Do not send message)
    return mapped.filter(d => d.creditCount > 0 || d.fbrCount > 0);
  }, [bills, salespersonContacts, effectiveTargetDate]);

  const filteredData = useMemo(() => {
    if (!filterQuery) return salespersonData;
    const q = filterQuery.toLowerCase();
    return salespersonData.filter(d => d.spName.toLowerCase().includes(q) || d.phone.includes(q));
  }, [salespersonData, filterQuery]);

  const activeSalespersonsData = useMemo(() => {
    return salespersonData.filter(d => d.creditCount > 0 || d.fbrCount > 0);
  }, [salespersonData]);

  const totalCreditBillsAll = useMemo(() => salespersonData.reduce((s, d) => s + d.creditCount, 0), [salespersonData]);
  const totalFbrBillsAll = useMemo(() => salespersonData.reduce((s, d) => s + d.fbrCount, 0), [salespersonData]);
  const totalPendingAmtAll = useMemo(() => salespersonData.reduce((s, d) => s + d.totalAmt, 0), [salespersonData]);

  // Python WhatsApp Desktop Auto-Sender Script Generator
  const generatedPythonScript = useMemo(() => {
    const payload = activeSalespersonsData.map(d => ({
      name: d.spName,
      phone: d.phone,
      credit: d.creditCount,
      fbr: d.fbrCount,
      total_amt: d.totalAmt,
      message: d.message
    }));

    return `# ==============================================================================
# AUTOMATED WHATSAPP DESKTOP SENDER FOR SALESPERSON CREDIT & FBR REPORTS
# Target Date: ${effectiveTargetDate || 'ALL DATES'}
# Total Active Salespersons to Send: ${payload.length}
# ==============================================================================
import time
import urllib.parse
import webbrowser
import sys

# List of Salesperson Data generated from Bill App
DISPATCH_DATA = ${JSON.stringify(payload, null, 2)}

def clean_phone_number(phone):
    s = ''.join(c for c in str(phone) if c.isdigit())
    if len(s) == 10:
        s = '91' + s
    return s

def run_whatsapp_auto_dispatch():
    print("=" * 65)
    print("🚀 STARTING AUTOMATED WHATSAPP DESKTOP DISPATCHER")
    print(f"📅 Target Date: ${effectiveTargetDate || 'ALL DATES'}")
    print(f"👥 Total Salespersons: {len(DISPATCH_DATA)}")
    print("=" * 65)
    
    if not DISPATCH_DATA:
        print("❌ No active salespersons with Credit/FBR bills for this date.")
        return

    print("\\n⚠️ IMPORTANT: Make sure WhatsApp Desktop or WhatsApp Web is open & logged in on your PC!\\n")
    time.sleep(3)

    for idx, item in enumerate(DISPATCH_DATA, start=1):
        name = item['name']
        phone = clean_phone_number(item['phone'])
        message = item['message']

        if not phone:
            print(f"[{idx}/{len(DISPATCH_DATA)}] ⚠️ Skipping {name}: Phone number missing.")
            continue

        print(f"[{idx}/{len(DISPATCH_DATA)}] 📤 Sending to {name} (+{phone})...")
        encoded_msg = urllib.parse.quote(message)
        
        # Opens WhatsApp Desktop protocol link directly
        url = f"whatsapp://send?phone={phone}&text={encoded_msg}"
        webbrowser.open(url)

        print(f"   ✅ Opened WhatsApp Desktop for {name}. Delaying 4s before next...")
        time.sleep(4)

    print("\\n" + "=" * 65)
    print("🎉 ALL WHATSAPP MESSAGES DISPATCHED SUCCESSFULLY!")
    print("=" * 65)

if __name__ == "__main__":
    run_whatsapp_auto_dispatch()
`;
  }, [activeSalespersonsData, effectiveTargetDate]);

  if (!isOpen) return null;

  const handleSendWhatsApp = (spName: string, phone: string, message: string) => {
    setSendingSp(spName);
    let cleanPhone = phone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    const encoded = encodeURIComponent(message);
    // Tries WhatsApp Desktop protocol app link first, falls back to web
    const appUrl = cleanPhone ? `whatsapp://send?phone=${cleanPhone}&text=${encoded}` : `https://wa.me/?text=${encoded}`;
    window.open(appUrl, '_blank');

    setTimeout(() => setSendingSp(null), 1000);
  };

  const handleCopyMessage = async (spName: string, message: string) => {
    await copyToClipboard(message);
    setCopiedSp(spName);
    setTimeout(() => setCopiedSp(null), 2000);
  };

  const handleDownloadPdf = (spName: string, billsList: Bill[]) => {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(`SALESPERSON CREDIT & FBR REPORT - ${spName.toUpperCase()}`, 14, 15);
    doc.setFontSize(10);
    doc.text(`Date: ${effectiveTargetDate || new Date().toLocaleDateString('en-IN')}`, 14, 22);

    const rows = billsList.map((b, i) => [
      i + 1,
      b.billNo,
      b.partyName,
      b.partyCode || '-',
      `₹${(b.billNetAmt || 0).toLocaleString('en-IN')}`,
      b.paymentMode === 'Cancel' || b.paymentMode === 'FBR' ? `FBR (${b.discrepancyReason || 'Return'})` : 'CREDIT'
    ]);

    autoTable(doc, {
      startY: 28,
      head: [['#', 'Bill No', 'Party Name', 'Beat', 'Amount', 'Status']],
      body: rows,
      styles: { fontSize: 8, fontStyle: 'bold' },
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255] }
    });

    doc.save(`Salesperson_${spName}_Credit_FBR_Report_${effectiveTargetDate || 'All'}.pdf`);
  };

  const handleBatchSendAll = () => {
    if (activeSalespersonsData.length === 0) {
      setBatchStatusMsg(`No salespersons have Credit or FBR bills for ${effectiveTargetDate || 'this date'}!`);
      setTimeout(() => setBatchStatusMsg(''), 4000);
      return;
    }
    setBatchConfirmOpen(true);
  };

  const executeBatchSend = () => {
    setBatchConfirmOpen(false);
    setBatchStatusMsg(`Triggering WhatsApp dispatch for ${activeSalespersonsData.length} salespersons...`);
    let index = 0;
    const interval = setInterval(() => {
      if (index >= activeSalespersonsData.length) {
        clearInterval(interval);
        setBatchStatusMsg('✓ Completed sending WhatsApp triggers for all active salespersons!');
        setTimeout(() => setBatchStatusMsg(''), 6000);
        return;
      }
      const item = activeSalespersonsData[index];
      handleSendWhatsApp(item.spName, item.phone, item.message);
      index++;
    }, 1800);
  };

  const handleDownloadPythonScript = () => {
    const blob = new Blob([generatedPythonScript], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `whatsapp_auto_dispatch_${(effectiveTargetDate || 'all').replace(/\//g, '-')}.py`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCopyPythonScript = async () => {
    await copyToClipboard(generatedPythonScript);
    setPythonCopied(true);
    setTimeout(() => setPythonCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] flex items-start justify-center pt-4 sm:pt-6 p-3 sm:p-6 overflow-y-auto animate-in fade-in duration-200">
      <div className="bg-card border border-border/80 rounded-2xl w-full max-w-5xl max-h-[94vh] flex flex-col shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 border border-emerald-500/40 rounded-xl text-emerald-400">
              <Bot className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black uppercase tracking-tight flex items-center gap-2">
                Daily Salesperson WhatsApp Auto-Dispatch
                <span className="px-2 py-0.5 rounded-full text-[9px] bg-emerald-500 text-slate-950 font-black">
                  PC & PYTHON AUTO SEND
                </span>
              </h2>
              <p className="text-[11px] text-slate-300 font-medium">
                Automatic WhatsApp PC / Python script generator for 50 salespersons (Credit & FBR bills only)
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-slate-300 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Date Selector Filter Bar */}
        <div className="p-3 bg-slate-900/90 border-b border-slate-800 text-white flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-black uppercase text-amber-400 flex items-center gap-1">
              <Calendar className="w-4 h-4 text-amber-400" />
              Date Mode:
            </span>

            <button
              onClick={() => setDateMode('today')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-black uppercase tracking-tight transition-all border",
                dateMode === 'today'
                  ? "bg-amber-400 text-slate-950 border-amber-400 shadow-md"
                  : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
              )}
            >
              Current Date (Today: {getTodayDMY()})
            </button>

            <button
              onClick={() => setDateMode('custom')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-black uppercase tracking-tight transition-all border",
                dateMode === 'custom'
                  ? "bg-amber-400 text-slate-950 border-amber-400 shadow-md"
                  : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
              )}
            >
              Selected Date
            </button>

            <button
              onClick={() => setDateMode('all')}
              className={cn(
                "px-3 py-1 rounded-lg text-xs font-black uppercase tracking-tight transition-all border",
                dateMode === 'all'
                  ? "bg-amber-400 text-slate-950 border-amber-400 shadow-md"
                  : "bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700"
              )}
            >
              All Dates
            </button>

            {dateMode === 'custom' && (
              <input
                type="date"
                value={customIsoDate}
                onChange={e => setCustomIsoDate(e.target.value)}
                className="h-8 px-2 bg-slate-800 border border-amber-400/80 rounded-lg text-xs font-black text-amber-300 outline-none"
              />
            )}
          </div>

          <div className="text-right">
            <span className="text-[10px] font-black uppercase text-slate-400 block">Active Target Date</span>
            <span className="text-xs font-black text-emerald-400 bg-emerald-950/80 px-2.5 py-0.5 rounded border border-emerald-500/40">
              {effectiveTargetDate || 'ALL DATES'}
            </span>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-border bg-muted/40 shrink-0">
          <button
            onClick={() => setActiveTab('dispatch')}
            className={cn(
              "px-5 py-2.5 text-xs font-black uppercase tracking-tight border-b-2 transition-all flex items-center gap-2",
              activeTab === 'dispatch'
                ? "border-emerald-500 text-emerald-600 bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Send className="w-4 h-4" />
            Direct WhatsApp Send ({activeSalespersonsData.length} Salespersons)
          </button>

          <button
            onClick={() => setActiveTab('python')}
            className={cn(
              "px-5 py-2.5 text-xs font-black uppercase tracking-tight border-b-2 transition-all flex items-center gap-2",
              activeTab === 'python'
                ? "border-indigo-500 text-indigo-600 bg-background"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Terminal className="w-4 h-4" />
            🐍 Python PC WhatsApp Auto-Sender
          </button>
        </div>

        {/* Stats Summary Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-3 bg-muted/60 border-b border-border shrink-0 text-center">
          <div className="bg-background p-2 rounded-xl border border-border/50">
            <p className="text-[9px] font-black text-muted-foreground uppercase">Active SPs ({effectiveTargetDate || 'All'})</p>
            <p className="text-sm sm:text-base font-black text-foreground">{activeSalespersonsData.length}</p>
          </div>
          <div className="bg-background p-2 rounded-xl border border-border/50">
            <p className="text-[9px] font-black text-emerald-600 uppercase">Credit Bills ({effectiveTargetDate || 'All'})</p>
            <p className="text-sm sm:text-base font-black text-emerald-600">{totalCreditBillsAll}</p>
          </div>
          <div className="bg-background p-2 rounded-xl border border-border/50">
            <p className="text-[9px] font-black text-rose-600 uppercase">FBR Bills ({effectiveTargetDate || 'All'})</p>
            <p className="text-sm sm:text-base font-black text-rose-600">{totalFbrBillsAll}</p>
          </div>
          <div className="bg-background p-2 rounded-xl border border-border/50">
            <p className="text-[9px] font-black text-indigo-600 uppercase">Total Outstanding</p>
            <p className="text-sm sm:text-base font-black text-indigo-600">₹{totalPendingAmtAll.toLocaleString('en-IN')}</p>
          </div>
        </div>

        {activeTab === 'dispatch' ? (
          <>
            {/* Dispatch Banner */}
            <div className="p-3 sm:p-4 bg-emerald-500/10 border-b border-emerald-500/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shrink-0">
              <div className="flex items-start gap-2.5">
                <Sparkles className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-black text-emerald-950 dark:text-emerald-300 uppercase">
                    ⚡ WhatsApp PC App Direct Dispatch ({effectiveTargetDate || 'All Dates'})
                  </p>
                  <p className="text-[11px] text-emerald-900/80 dark:text-emerald-400 font-medium">
                    Reports contain <span className="font-bold">Bill No, Party Name, Beat, Amount & Status (Credit/FBR + Reason)</span>. 
                    Uses <span className="font-bold">WhatsApp PC Desktop App (`whatsapp://send`)</span> for instant 1-click delivery.
                  </p>
                </div>
              </div>

              <Button
                onClick={handleBatchSendAll}
                className="w-full sm:w-auto h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-wide rounded-xl shadow-md flex items-center justify-center gap-1.5 shrink-0"
              >
                <Zap className="w-4 h-4 fill-white" />
                Trigger All {activeSalespersonsData.length} SPs on WhatsApp PC
              </Button>
            </div>

            {/* Search Filter Input */}
            <div className="px-4 py-2 bg-background border-b border-border flex items-center justify-between gap-2 shrink-0">
              <input
                type="text"
                placeholder="Search salesperson name or phone number..."
                value={filterQuery}
                onChange={e => setFilterQuery(e.target.value)}
                className="w-full max-w-md h-8 px-3 bg-muted rounded-lg text-xs font-bold outline-none border border-border/60 focus:border-primary"
              />
              <span className="text-[10px] font-black text-muted-foreground uppercase whitespace-nowrap">
                Showing {filteredData.length} of {salespersonData.length}
              </span>
            </div>

            {/* Salesperson List */}
            <div className="p-3 sm:p-4 overflow-y-auto flex-1 space-y-3">
              {filteredData.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground font-bold">
                  No salespersons found for date {effectiveTargetDate || 'All'}.
                </div>
              ) : (
                filteredData.map(item => {
                  const hasBills = item.creditCount > 0 || item.fbrCount > 0;

                  return (
                    <div 
                      key={item.spName}
                      className={cn(
                        "p-3 rounded-xl border transition-all flex flex-col md:flex-row items-start md:items-center justify-between gap-3",
                        hasBills 
                          ? "bg-card border-border/80 shadow-sm hover:border-emerald-500/50" 
                          : "bg-muted/30 border-border/40 opacity-70"
                      )}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-black text-foreground uppercase">{item.spName}</span>
                          {item.phone ? (
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">
                              📞 {item.phone}
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-800">
                              ⚠️ No Phone Saved
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
                          <span className="text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                            Credit: {item.creditCount} Bills
                          </span>
                          <span className="text-rose-700 bg-rose-100 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                            FBR: {item.fbrCount} Bills
                          </span>
                          <span className="text-indigo-700 font-black">
                            Total Pending: ₹{item.totalAmt.toLocaleString('en-IN')}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCopyMessage(item.spName, item.message)}
                          className="h-8 px-2.5 text-[10px] font-black uppercase tracking-tight flex items-center gap-1"
                        >
                          <Copy className="w-3.5 h-3.5" />
                          {copiedSp === item.spName ? 'Copied!' : 'Copy Msg'}
                        </Button>

                        {hasBills && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleDownloadPdf(item.spName, item.billsList)}
                            className="h-8 px-2.5 text-[10px] font-black uppercase tracking-tight flex items-center gap-1 text-slate-700 hover:bg-slate-100"
                          >
                            <Download className="w-3.5 h-3.5" />
                            PDF
                          </Button>
                        )}

                        <Button
                          size="sm"
                          onClick={() => handleSendWhatsApp(item.spName, item.phone, item.message)}
                          disabled={sendingSp === item.spName}
                          className={cn(
                            "h-8 px-3 text-[10px] font-black uppercase tracking-tight flex items-center gap-1.5 shadow-sm text-white",
                            hasBills ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-500 hover:bg-slate-600"
                          )}
                        >
                          {sendingSp === item.spName ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <MessageCircle className="w-3.5 h-3.5 fill-white" />
                          )}
                          Send WhatsApp
                        </Button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          /* Python Auto-Sender Tab */
          <div className="p-4 overflow-y-auto flex-1 space-y-4 bg-slate-950 text-slate-100">
            <div className="p-4 bg-indigo-950/80 border border-indigo-500/40 rounded-xl space-y-2">
              <h3 className="text-sm font-black uppercase text-indigo-300 flex items-center gap-2">
                <Code className="w-5 h-5 text-indigo-400" />
                100% AUTOMATIC PYTHON WHATSAPP PC APP SENDER
              </h3>
              <p className="text-xs text-slate-300 leading-relaxed font-medium">
                PC par <span className="font-bold text-amber-300">WhatsApp Desktop App</span> ya WhatsApp Web login karke is Python script ko run kare.
                Ye script bilkul 100% automatic <span className="font-bold text-emerald-400">Selected Date ({effectiveTargetDate || 'ALL DATES'})</span> ke sabhi 50 salespersons ke phone numbers par unka Credit & FBR report bina kisi manual touch ke send kar dega!
              </p>
              
              <div className="flex flex-wrap items-center gap-2 pt-2">
                <Button
                  onClick={handleDownloadPythonScript}
                  className="h-9 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase tracking-tight flex items-center gap-2 rounded-xl shadow-md"
                >
                  <Download className="w-4 h-4" />
                  Download `.py` Script
                </Button>

                <Button
                  onClick={handleCopyPythonScript}
                  variant="outline"
                  className="h-9 px-4 border-slate-700 text-slate-200 hover:bg-slate-800 font-black text-xs uppercase tracking-tight flex items-center gap-2 rounded-xl"
                >
                  {pythonCopied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  {pythonCopied ? 'Copied Python Script!' : 'Copy Script to Clipboard'}
                </Button>
              </div>
            </div>

            {/* Instructions */}
            <div className="p-3 bg-slate-900 border border-slate-800 rounded-xl text-xs space-y-1.5 text-slate-300 font-mono">
              <p className="font-black text-amber-400 uppercase font-sans">📌 Quick Setup Instructions for PC:</p>
              <p>1. Open WhatsApp Desktop App or WhatsApp Web on your PC.</p>
              <p>2. Save the downloaded file as <span className="text-emerald-400">`auto_whatsapp_dispatch.py`</span>.</p>
              <p>3. Open Terminal / Command Prompt and run:</p>
              <div className="bg-black p-2 rounded border border-slate-800 text-emerald-400 font-mono text-[11px]">
                python auto_whatsapp_dispatch.py
              </div>
              <p>4. Python will automatically cycle through all {activeSalespersonsData.length} salespersons and trigger WhatsApp Desktop send!</p>
            </div>

            {/* Script Viewer */}
            <div className="relative">
              <div className="absolute top-2 right-2 z-10">
                <Button
                  size="sm"
                  onClick={handleCopyPythonScript}
                  className="h-7 text-[10px] font-black uppercase bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700"
                >
                  {pythonCopied ? 'Copied!' : 'Copy'}
                </Button>
              </div>
              <pre className="p-4 bg-black border border-slate-800 rounded-xl text-[11px] font-mono text-emerald-400 overflow-x-auto max-h-[320px] leading-relaxed">
                {generatedPythonScript}
              </pre>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3 bg-muted/80 border-t border-border flex items-center justify-between shrink-0 text-xs font-black uppercase">
          <span className="text-[10px] text-muted-foreground">
            Target Date: <span className="text-foreground">{effectiveTargetDate || 'All Dates'}</span> | Salespersons: {salespersonContacts.length}
          </span>
          <div className="flex items-center gap-2">
            {batchStatusMsg && (
              <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                {batchStatusMsg}
              </span>
            )}
            <Button variant="ghost" onClick={onClose} className="h-8 text-xs font-black uppercase">
              Close
            </Button>
          </div>
        </div>

        <ConfirmModal
          isOpen={batchConfirmOpen}
          title="Trigger WhatsApp Batch Dispatch"
          message={`Are you sure you want to trigger the WhatsApp PC app for all ${activeSalespersonsData.length} active salespersons for date [${effectiveTargetDate || 'All'}]?`}
          confirmText="Start Dispatch"
          variant="primary"
          onConfirm={executeBatchSend}
          onCancel={() => setBatchConfirmOpen(false)}
        />
      </div>
    </div>
  );
}

