'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { 
  X, MessageCircle, Send, CheckCircle2, AlertCircle, Copy, 
  Phone, User, Check, ExternalLink, ArrowRight, Sparkles 
} from 'lucide-react';
import { Bill, getSalespersonContacts, findSalespersonContact } from '@/lib/billStore';
import { getDisplayBillNo } from '@/lib/commissionMoc';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  selectedBills: Bill[];
  displayDate: string;
}

function getEffectiveAmounts(b: Bill) {
  const cash = Number(b.cashAmount) || 0;
  const upi  = Number(b.upiAmount)  || 0;
  const chq  = Number(b.chequeAmount) || 0;
  const collected = Number(b.collectedAmount) || 0;
  if (cash === 0 && upi === 0 && chq === 0 && collected > 0) {
    const mode = (b.paymentMode || '').toLowerCase();
    if (mode === 'upi' || mode === 'gpay') return { cash: 0, upi: collected, chq: 0 };
    if (mode === 'cheque' || mode === 'chq') return { cash: 0, upi: 0, chq: collected };
    return { cash: collected, upi: 0, chq: 0 };
  }
  return { cash, upi, chq };
}

function buildSalesmanPaidMessage(salesperson: string, bills: Bill[], displayDate: string) {
  let totalBillAmt = 0;
  let totalRecAmt = 0;
  let totalLineCut = 0;

  const lines = bills.map((b, idx) => {
    const billNo = getDisplayBillNo(b).replace(/^GST[-/]?/i, '');
    const billAmt = Number(b.billNetAmt) || 0;
    const eff = getEffectiveAmounts(b);
    const recAmt = (eff.cash + eff.upi + eff.chq) > 0 
      ? (eff.cash + eff.upi + eff.chq) 
      : (Number(b.collectedAmount) || 0);

    let lineCut = 0;
    if ((b.lineCutAmt || 0) > 0) {
      lineCut = b.lineCutAmt!;
    } else if (billAmt > recAmt && recAmt > 0) {
      lineCut = billAmt - recAmt;
    }

    const recDate = b.paymentDate || displayDate || '-';
    const status = 'PAID';

    totalBillAmt += billAmt;
    totalRecAmt += recAmt;
    totalLineCut += lineCut;

    // Requested format: BILL NO - BILL AMT - REC AMT - LINE CUT - REC DATE - PAID
    let line = `${idx + 1}. ${billNo} - ₹${billAmt.toLocaleString('en-IN')} - ₹${recAmt.toLocaleString('en-IN')} - ₹${lineCut.toLocaleString('en-IN')} - ${recDate} - ${status}`;
    if (b.partyName) {
      line += `\n   Party: ${b.partyName.trim()}`;
    }
    return line;
  });

  let msg = `*PAID BILLS COLLECTION REPORT*\n`;
  msg += `👤 *Salesman:* ${salesperson.toUpperCase()}\n`;
  msg += `📅 *Date:* ${displayDate}\n`;
  msg += `─────────────────────────\n`;
  msg += `*BILL NO - BILL AMT - REC AMT - LINE CUT - REC DATE - PAID*\n`;
  msg += `─────────────────────────\n`;
  msg += lines.join('\n\n') + '\n';
  msg += `─────────────────────────\n`;
  msg += `📦 *Total Paid Bills:* ${bills.length}\n`;
  msg += `💰 *Total Bill Amt:* ₹${totalBillAmt.toLocaleString('en-IN')}\n`;
  msg += `💵 *Total Rec Amt:* ₹${totalRecAmt.toLocaleString('en-IN')}\n`;
  if (totalLineCut > 0) {
    msg += `✂️ *Total Line Cut:* ₹${totalLineCut.toLocaleString('en-IN')}\n`;
  }
  msg += `\n_Generated via VitraTrack Driver Hub_`;

  return {
    message: msg,
    totalBills: bills.length,
    totalBillAmt,
    totalRecAmt,
    totalLineCut,
  };
}

export default function WhatsAppSalesmanModal({ isOpen, onClose, selectedBills, displayDate }: Props) {
  const [phones, setPhones] = useState<Record<string, string>>({});
  const [sentSalespersons, setSentSalespersons] = useState<Set<string>>(new Set());
  const [copiedSp, setCopiedSp] = useState<string | null>(null);
  const [activeStepIdx, setActiveStepIdx] = useState<number>(0);

  // Group bills by Salesperson Name
  const groupedSalespersons = useMemo(() => {
    const map = new Map<string, Bill[]>();
    for (const b of selectedBills) {
      const sp = (b.salespersonName || '').trim() || 'UNASSIGNED';
      if (!map.has(sp)) map.set(sp, []);
      map.get(sp)!.push(b);
    }
    return Array.from(map.entries()).map(([salesperson, bills]) => {
      const summary = buildSalesmanPaidMessage(salesperson, bills, displayDate);
      return {
        salesperson,
        bills,
        ...summary,
      };
    });
  }, [selectedBills, displayDate]);

  // Prepopulate phone numbers from contacts
  useEffect(() => {
    if (!isOpen) return;
    const initialPhones: Record<string, string> = {};
    for (const group of groupedSalespersons) {
      const contact = findSalespersonContact(group.salesperson) || 
        getSalespersonContacts().find(c => (c.name || '').trim().toLowerCase() === group.salesperson.toLowerCase());
      initialPhones[group.salesperson] = contact?.mobile || '';
    }
    setPhones(initialPhones);
    setSentSalespersons(new Set());
    setActiveStepIdx(0);
  }, [isOpen, groupedSalespersons]);

  if (!isOpen) return null;

  const handlePhoneChange = (spName: string, val: string) => {
    setPhones(prev => ({ ...prev, [spName]: val }));
  };

  const handleCopyMessage = async (spName: string, msg: string) => {
    try {
      await navigator.clipboard.writeText(msg);
      setCopiedSp(spName);
      setTimeout(() => setCopiedSp(null), 2000);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = msg;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopiedSp(spName);
      setTimeout(() => setCopiedSp(null), 2000);
    }
  };

  const handleSendWhatsApp = (spName: string, message: string) => {
    const rawPhone = phones[spName] || '';
    let cleanPhone = rawPhone.replace(/[^0-9]/g, '');
    if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;

    const encoded = encodeURIComponent(message);
    const waUrl = cleanPhone 
      ? `https://api.whatsapp.com/send?phone=${cleanPhone}&text=${encoded}`
      : `https://api.whatsapp.com/send?text=${encoded}`;

    window.open(waUrl, '_blank');

    setSentSalespersons(prev => new Set(prev).add(spName));

    // If there is a next salesperson, advance active step
    const currentIdx = groupedSalespersons.findIndex(g => g.salesperson === spName);
    if (currentIdx !== -1 && currentIdx + 1 < groupedSalespersons.length) {
      setActiveStepIdx(currentIdx + 1);
    }
  };

  const totalSalespersonsCount = groupedSalespersons.length;
  const sentCount = sentSalespersons.size;
  const allSent = totalSalespersonsCount > 0 && sentCount === totalSalespersonsCount;

  return (
    <div className="fixed inset-0 bg-black/60 z-[250] flex items-center justify-center p-3 sm:p-4 backdrop-blur-xs animate-in fade-in">
      <div className="bg-card rounded-2xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl border border-border overflow-hidden">
        
        {/* Modal Header */}
        <div className="bg-emerald-600 dark:bg-emerald-700 text-white px-4 py-3 sm:px-6 sm:py-4 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-white/20 text-white">
              <MessageCircle className="w-5 h-5 fill-current" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black tracking-tight leading-tight">
                Send Paid Bills via WhatsApp
              </h2>
              <p className="text-[11px] sm:text-xs text-emerald-100 font-medium">
                {selectedBills.length} Paid Bill{selectedBills.length !== 1 ? 's' : ''} selected • {totalSalespersonsCount} Salesman{totalSalespersonsCount !== 1 ? 'men' : ''}
              </p>
            </div>
          </div>
          <button 
            type="button" 
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/20 text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Informative Guidance Banner */}
        <div className="bg-emerald-50 dark:bg-emerald-950/40 border-b border-emerald-200 dark:border-emerald-800 px-4 py-2.5 text-xs text-emerald-900 dark:text-emerald-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-bold flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
              Format:
            </span>
            <code className="text-[10.5px] bg-emerald-100/70 dark:bg-emerald-900/60 px-1.5 py-0.5 rounded font-mono font-semibold">
              BILL NO - BILL AMT - REC AMT - LINE CUT - REC DATE - PAID
            </code>
          </div>
          {totalSalespersonsCount > 1 && (
            <span className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-200/60 dark:bg-emerald-800/60 px-2 py-0.5 rounded-full">
              {sentCount} / {totalSalespersonsCount} Sent
            </span>
          )}
        </div>

        {totalSalespersonsCount > 1 && (
          <div className="bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 px-4 py-2 text-[11.5px] text-amber-900 dark:text-amber-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <span>
              Selected bills belong to <strong>{totalSalespersonsCount} salesmen</strong>. Browser security requires sending to each salesman one by one using the green WhatsApp buttons below.
            </span>
          </div>
        )}

        {/* Scrollable List of Salesmen */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {groupedSalespersons.map((group, idx) => {
            const isSent = sentSalespersons.has(group.salesperson);
            const currentPhone = phones[group.salesperson] || '';
            const isCopied = copiedSp === group.salesperson;
            const isHighlighted = totalSalespersonsCount > 1 && idx === activeStepIdx && !isSent;

            return (
              <div 
                key={group.salesperson}
                className={cn(
                  "rounded-xl border p-3.5 sm:p-4 transition-all",
                  isSent
                    ? "bg-emerald-50/40 dark:bg-emerald-950/20 border-emerald-300 dark:border-emerald-800"
                    : isHighlighted
                      ? "bg-card border-emerald-500 shadow-md ring-2 ring-emerald-500/20"
                      : "bg-card border-border shadow-xs"
                )}
              >
                {/* Salesperson Header & Stats */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-border/60">
                  <div className="flex items-center gap-2.5">
                    <div className={cn(
                      "w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm",
                      isSent ? "bg-emerald-600 text-white" : "bg-primary/10 text-primary"
                    )}>
                      {isSent ? <Check className="w-4 h-4" /> : idx + 1}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-black text-sm uppercase text-foreground">
                          {group.salesperson}
                        </span>
                        {isSent && (
                          <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                            <CheckCircle2 className="w-2.5 h-2.5" /> Sent
                          </span>
                        )}
                        {isHighlighted && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 px-1.5 py-0.5 rounded-full">
                            Next to send
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-muted-foreground font-medium">
                        {group.totalBills} Bill{group.totalBills !== 1 ? 's' : ''} • Bill Amt: ₹{group.totalBillAmt.toLocaleString('en-IN')} • Rec: ₹{group.totalRecAmt.toLocaleString('en-IN')}
                        {group.totalLineCut > 0 ? ` • Line Cut: ₹${group.totalLineCut.toLocaleString('en-IN')}` : ''}
                      </p>
                    </div>
                  </div>

                  {/* Phone input */}
                  <div className="flex items-center gap-1.5">
                    <div className="relative flex-1 sm:w-44">
                      <Phone className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input 
                        type="text"
                        placeholder="WhatsApp Number"
                        value={currentPhone}
                        onChange={(e) => handlePhoneChange(group.salesperson, e.target.value)}
                        className="w-full pl-8 pr-2 py-1.5 text-xs font-semibold rounded-lg border border-input bg-background focus:outline-none focus:ring-1 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                {/* Bill preview table */}
                <div className="mt-3 overflow-x-auto rounded-lg border border-border/60 bg-muted/20">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-muted/40 text-[10px] font-black uppercase text-muted-foreground border-b border-border/60">
                      <tr>
                        <th className="px-2 py-1.5">#</th>
                        <th className="px-2 py-1.5">Bill No</th>
                        <th className="px-2 py-1.5">Party</th>
                        <th className="px-2 py-1.5 text-right">Bill Amt</th>
                        <th className="px-2 py-1.5 text-right">Rec Amt</th>
                        <th className="px-2 py-1.5 text-right">Line Cut</th>
                        <th className="px-2 py-1.5 text-center">Rec Date</th>
                        <th className="px-2 py-1.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 font-semibold">
                      {group.bills.map((b, bIdx) => {
                        const billNo = getDisplayBillNo(b).replace(/^GST[-/]?/i, '');
                        const eff = getEffectiveAmounts(b);
                        const rec = (eff.cash + eff.upi + eff.chq) > 0 ? (eff.cash + eff.upi + eff.chq) : (Number(b.collectedAmount) || 0);
                        const lc = (b.lineCutAmt || 0) > 0 ? b.lineCutAmt! : (b.billNetAmt > rec && rec > 0 ? b.billNetAmt - rec : 0);
                        const date = b.paymentDate || displayDate || '-';
                        return (
                          <tr key={b.id || b.billNo} className="hover:bg-muted/30">
                            <td className="px-2 py-1 text-muted-foreground">{bIdx + 1}</td>
                            <td className="px-2 py-1 font-bold">{billNo}</td>
                            <td className="px-2 py-1 truncate max-w-[130px]" title={b.partyName}>{b.partyName || '-'}</td>
                            <td className="px-2 py-1 text-right">₹{b.billNetAmt.toLocaleString('en-IN')}</td>
                            <td className="px-2 py-1 text-right text-emerald-600 font-bold">₹{rec.toLocaleString('en-IN')}</td>
                            <td className="px-2 py-1 text-right text-destructive">₹{lc.toLocaleString('en-IN')}</td>
                            <td className="px-2 py-1 text-center text-muted-foreground">{date}</td>
                            <td className="px-2 py-1 text-center">
                              <span className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 px-1.5 py-0.5 rounded text-[9px] font-black">
                                PAID
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Action Buttons for this Salesperson */}
                <div className="mt-3 flex items-center justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => handleCopyMessage(group.salesperson, group.message)}
                    className="h-8 text-xs font-semibold gap-1.5"
                  >
                    {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {isCopied ? 'Copied!' : 'Copy Text'}
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => handleSendWhatsApp(group.salesperson, group.message)}
                    className={cn(
                      "h-8 text-xs font-bold gap-1.5 shadow-xs transition-all active:scale-95",
                      isSent
                        ? "bg-emerald-700 hover:bg-emerald-800 text-white"
                        : "bg-emerald-600 hover:bg-emerald-500 text-white"
                    )}
                  >
                    <MessageCircle className="w-3.5 h-3.5 fill-current" />
                    {isSent ? `Send Again to ${group.salesperson}` : `Send WhatsApp to ${group.salesperson}`}
                    <ExternalLink className="w-3 h-3 opacity-70" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Modal Footer */}
        <div className="bg-muted/40 border-t border-border px-4 py-3 sm:px-6 flex items-center justify-between">
          <div className="text-xs text-muted-foreground">
            {allSent ? (
              <span className="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> All salesmen messages sent successfully!
              </span>
            ) : totalSalespersonsCount > 1 ? (
              <span>
                Salesmen remaining to send: <strong>{totalSalespersonsCount - sentCount}</strong>
              </span>
            ) : (
              <span>Ready to send report</span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClose}
              className="h-9 px-4 text-xs font-semibold"
            >
              Close
            </Button>

            {totalSalespersonsCount > 1 && !allSent && (
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const unsent = groupedSalespersons.find(g => !sentSalespersons.has(g.salesperson));
                  if (unsent) {
                    handleSendWhatsApp(unsent.salesperson, unsent.message);
                  }
                }}
                className="h-9 px-4 text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white gap-1.5 shadow-sm"
              >
                Send Next ({sentCount + 1}/{totalSalespersonsCount})
                <ArrowRight className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
