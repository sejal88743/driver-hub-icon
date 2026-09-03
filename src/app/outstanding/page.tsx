import { useMemo, useState, useEffect } from 'react';
import {
  IndianRupee,
  TrendingUp,
  Users,
  Loader2,
  Clock,
  Calendar,
  Search,
  X,
  Check,
  FileText,
  Send,
  MessageCircle,
  CheckSquare,
  Square,
  Phone,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Lock,
  RotateCcw
} from 'lucide-react';
import { useBillStore } from '@/hooks/use-bill-store';
import TopNav from '@/components/TopNav';
import { cn } from '@/lib/utils';
import { apiFetchSettingsEarly } from '@/lib/apiSync';
import {
  Bill,
  getTodayDMY,
  findSalespersonContact,
  getSalespersonContacts,
  saveSalespersonContacts,
  getCreditAssigns,
  saveCreditAssigns,
  loadCreditAssigns,
  CreditAssign
} from '@/lib/billStore';
import { Button } from '@/components/ui/button';

type SortField = 'billNo' | 'billDate' | 'partyName' | 'billAmt' | 'delDate' | 'giveDate' | 'givenTo' | 'time';
type SortOrder = 'asc' | 'desc';

function getInitialTime(): string {
  const now = new Date();
  let h = now.getHours();
  const m = String(now.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  h = h ? h : 12;
  return `${String(h).padStart(2, '0')}:${m} ${ampm}`;
}

function formatPartyName14Words(name?: string): string {
  if (!name) return '-';
  const words = name.trim().split(/\s+/);
  if (words.length <= 14) return name.trim();
  return words.slice(0, 14).join(' ');
}

function formatDisplayDate(dateStr?: string): string {
  if (!dateStr) return '-';
  const clean = dateStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) return clean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-');
    return `${d}/${m}/${y}`;
  }
  return clean;
}

function parseDateToTime(dateStr?: string): number {
  if (!dateStr) return 0;
  const clean = dateStr.trim();
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(clean)) {
    const [d, m, y] = clean.split('/').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const [y, m, d] = clean.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }
  const parsed = Date.parse(clean);
  return isNaN(parsed) ? 0 : parsed;
}

// 16 Vibrant and distinct color themes for Salesperson Cards (A to Z)
const SP_COLOR_THEMES = [
  {
    unselected: 'bg-blue-50 text-blue-900 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-800 hover:bg-blue-100',
    selected: 'bg-blue-600 text-white border-blue-700 ring-2 ring-blue-500 shadow-md',
  },
  {
    unselected: 'bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-800 hover:bg-emerald-100',
    selected: 'bg-emerald-600 text-white border-emerald-700 ring-2 ring-emerald-500 shadow-md',
  },
  {
    unselected: 'bg-purple-50 text-purple-900 border-purple-300 dark:bg-purple-950/60 dark:text-purple-200 dark:border-purple-800 hover:bg-purple-100',
    selected: 'bg-purple-600 text-white border-purple-700 ring-2 ring-purple-500 shadow-md',
  },
  {
    unselected: 'bg-amber-50 text-amber-950 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-800 hover:bg-amber-100',
    selected: 'bg-amber-600 text-white border-amber-700 ring-2 ring-amber-500 shadow-md',
  },
  {
    unselected: 'bg-rose-50 text-rose-900 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-800 hover:bg-rose-100',
    selected: 'bg-rose-600 text-white border-rose-700 ring-2 ring-rose-500 shadow-md',
  },
  {
    unselected: 'bg-cyan-50 text-cyan-900 border-cyan-300 dark:bg-cyan-950/60 dark:text-cyan-200 dark:border-cyan-800 hover:bg-cyan-100',
    selected: 'bg-cyan-600 text-white border-cyan-700 ring-2 ring-cyan-500 shadow-md',
  },
  {
    unselected: 'bg-indigo-50 text-indigo-900 border-indigo-300 dark:bg-indigo-950/60 dark:text-indigo-200 dark:border-indigo-800 hover:bg-indigo-100',
    selected: 'bg-indigo-600 text-white border-indigo-700 ring-2 ring-indigo-500 shadow-md',
  },
  {
    unselected: 'bg-orange-50 text-orange-950 border-orange-300 dark:bg-orange-950/60 dark:text-orange-200 dark:border-orange-800 hover:bg-orange-100',
    selected: 'bg-orange-600 text-white border-orange-700 ring-2 ring-orange-500 shadow-md',
  },
  {
    unselected: 'bg-teal-50 text-teal-900 border-teal-300 dark:bg-teal-950/60 dark:text-teal-200 dark:border-teal-800 hover:bg-teal-100',
    selected: 'bg-teal-600 text-white border-teal-700 ring-2 ring-teal-500 shadow-md',
  },
  {
    unselected: 'bg-fuchsia-50 text-fuchsia-900 border-fuchsia-300 dark:bg-fuchsia-950/60 dark:text-fuchsia-200 dark:border-fuchsia-800 hover:bg-fuchsia-100',
    selected: 'bg-fuchsia-600 text-white border-fuchsia-700 ring-2 ring-fuchsia-500 shadow-md',
  },
  {
    unselected: 'bg-lime-50 text-lime-950 border-lime-300 dark:bg-lime-950/60 dark:text-lime-200 dark:border-lime-800 hover:bg-lime-100',
    selected: 'bg-lime-700 text-white border-lime-800 ring-2 ring-lime-600 shadow-md',
  },
  {
    unselected: 'bg-sky-50 text-sky-900 border-sky-300 dark:bg-sky-950/60 dark:text-sky-200 dark:border-sky-800 hover:bg-sky-100',
    selected: 'bg-sky-600 text-white border-sky-700 ring-2 ring-sky-500 shadow-md',
  },
  {
    unselected: 'bg-violet-50 text-violet-900 border-violet-300 dark:bg-violet-950/60 dark:text-violet-200 dark:border-violet-800 hover:bg-violet-100',
    selected: 'bg-violet-600 text-white border-violet-700 ring-2 ring-violet-500 shadow-md',
  },
  {
    unselected: 'bg-pink-50 text-pink-900 border-pink-300 dark:bg-pink-950/60 dark:text-pink-200 dark:border-pink-800 hover:bg-pink-100',
    selected: 'bg-pink-600 text-white border-pink-700 ring-2 ring-pink-500 shadow-md',
  },
  {
    unselected: 'bg-yellow-50 text-yellow-950 border-yellow-300 dark:bg-yellow-950/60 dark:text-yellow-200 dark:border-yellow-800 hover:bg-yellow-100',
    selected: 'bg-yellow-600 text-white border-yellow-700 ring-2 ring-yellow-500 shadow-md',
  },
  {
    unselected: 'bg-emerald-50 text-emerald-950 border-emerald-400 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-700 hover:bg-emerald-100',
    selected: 'bg-emerald-700 text-white border-emerald-800 ring-2 ring-emerald-600 shadow-md',
  },
];

export default function OutstandingPage() {
  const { bills, loading } = useBillStore();
  const [selectedSalesperson, setSelectedSalesperson] = useState<string | null>(null);
  const [tableSearch, setTableSearch] = useState('');
  const [assigns, setAssigns] = useState<Record<string, CreditAssign>>(getCreditAssigns);

  // Sorting State
  const [sortField, setSortField] = useState<SortField>('billNo');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');

  // Bill Selection State
  const [selectedBillKeys, setSelectedBillKeys] = useState<Set<string>>(new Set());

  // Give Popup Modal State
  const [showGiveModal, setShowGiveModal] = useState(false);
  const [giveDateInput, setGiveDateInput] = useState(getTodayDMY());
  const [giveSalesmanInput, setGiveSalesmanInput] = useState('');
  const [giveSalesmanMobile, setGiveSalesmanMobile] = useState('');
  const [alertNotice, setAlertNotice] = useState<string | null>(null);

  useEffect(() => {
    setAssigns(getCreditAssigns());
  }, [bills]);

  const updateAssign = (bill: Bill, patch: Partial<CreditAssign>) => {
    const key = bill.id || bill.billNo;
    const current = assigns[key] || {};
    const updated: CreditAssign = {
      givenTo: patch.givenTo !== undefined ? patch.givenTo : (current.givenTo || bill.salespersonName || ''),
      giveDate: patch.giveDate !== undefined ? patch.giveDate : (current.giveDate || getTodayDMY()),
      giveTime: patch.giveTime !== undefined ? patch.giveTime : (current.giveTime || getInitialTime()),
      isGiven: patch.isGiven !== undefined ? patch.isGiven : (current.isGiven || false),
    };
    const next = { ...assigns, [key]: updated };
    setAssigns(next);
    saveCreditAssigns(next);
  };

  const totals = useMemo(() => {
    let billAmt = 0;
    let collected = 0;
    let lineCutTotal = 0;
    for (let i = 0; i < bills.length; i++) {
      const b = bills[i];
      billAmt += Number(b.billNetAmt || 0);
      collected += Number(b.collectedAmount || 0);
      lineCutTotal += b.lineCutAmt != null ? b.lineCutAmt : (Number(b.cancelLine) || 0);
    }
    return { billAmt, collected, lineCutTotal, outstanding: billAmt - lineCutTotal - collected };
  }, [bills]);

  // Unique list of all salespersons for the "Kon Legaya" dropdown
  const allSalespersons = useMemo(() => {
    const set = new Set<string>();
    bills.forEach(b => {
      if (b.salespersonName?.trim()) set.add(b.salespersonName.trim());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [bills]);

  // Salespersons who have credit bills (Sorted strictly A to Z)
  const creditSalespersons = useMemo(() => {
    const set = new Set<string>();
    bills.forEach(b => {
      const mode = (b.paymentMode || '').trim().toLowerCase();
      const isCredit = mode === 'credit';
      const hasMoneyReceived = (Number(b.collectedAmount) || 0) > 0 ||
        (Number(b.cashAmount) || 0) > 0 ||
        (Number(b.upiAmount) || 0) > 0 ||
        (Number(b.chequeAmount) || 0) > 0 ||
        !!b.paymentDate;

      if (isCredit && !hasMoneyReceived && b.salespersonName?.trim()) {
        set.add(b.salespersonName.trim());
      }
    });

    if (set.size === 0) {
      bills.forEach(b => {
        if (b.salespersonName?.trim()) set.add(b.salespersonName.trim());
      });
    }

    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [bills]);

  // Handle Sort Toggle
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortOrder(prev => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  // Credit bills for the selected salesperson (or all credit bills if selectedSalesperson is null)
  // JAB BILL ME PAYMENT REC HOGA VAH AUTOMATIC TABLE SE REMOVE HOGA
  const creditBills = useMemo(() => {
    const filtered = bills.filter(b => {
      const mode = (b.paymentMode || '').trim().toLowerCase();
      const isCredit = mode === 'credit';
      const hasMoneyReceived = (Number(b.collectedAmount) || 0) > 0 ||
        (Number(b.cashAmount) || 0) > 0 ||
        (Number(b.upiAmount) || 0) > 0 ||
        (Number(b.chequeAmount) || 0) > 0 ||
        !!b.paymentDate;

      // Must be Credit mode AND no payment received yet
      if (!isCredit || hasMoneyReceived) return false;

      // If a specific salesperson card was clicked, show ONLY that salesperson's bills
      if (selectedSalesperson) {
        const bSp = (b.salespersonName || '').trim().toLowerCase();
        const selSp = selectedSalesperson.trim().toLowerCase();
        if (bSp !== selSp) {
          return false;
        }
      }

      // Search filter if provided
      if (tableSearch.trim()) {
        const q = tableSearch.trim().toLowerCase();
        const bn = (b.billNo || '').toLowerCase();
        const party = (b.partyName || '').toLowerCase();
        const sp = (b.salespersonName || '').toLowerCase();
        if (!bn.includes(q) && !party.includes(q) && !sp.includes(q)) {
          return false;
        }
      }

      return true;
    });

    // Apply Sorting across all columns
    return filtered.sort((a, b) => {
      const keyA = a.id || a.billNo;
      const keyB = b.id || b.billNo;
      const assignA = assigns[keyA] || {};
      const assignB = assigns[keyB] || {};

      let valA: string | number = '';
      let valB: string | number = '';

      switch (sortField) {
        case 'billNo': {
          const numA = parseInt((a.billNo || '').replace(/\D/g, ''), 10) || 0;
          const numB = parseInt((b.billNo || '').replace(/\D/g, ''), 10) || 0;
          if (numA !== numB) {
            return sortOrder === 'asc' ? numA - numB : numB - numA;
          }
          valA = a.billNo || '';
          valB = b.billNo || '';
          break;
        }
        case 'billDate': {
          valA = parseDateToTime(a.date || a.deliveryDate);
          valB = parseDateToTime(b.date || b.deliveryDate);
          break;
        }
        case 'partyName': {
          valA = (a.partyName || '').toLowerCase();
          valB = (b.partyName || '').toLowerCase();
          break;
        }
        case 'billAmt': {
          valA = Number(a.billNetAmt || 0);
          valB = Number(b.billNetAmt || 0);
          break;
        }
        case 'delDate': {
          valA = parseDateToTime(a.deliveryDate || a.date);
          valB = parseDateToTime(b.deliveryDate || b.date);
          break;
        }
        case 'giveDate': {
          valA = parseDateToTime(assignA.giveDate || getTodayDMY());
          valB = parseDateToTime(assignB.giveDate || getTodayDMY());
          break;
        }
        case 'givenTo': {
          valA = (assignA.givenTo || a.salespersonName || '').toLowerCase();
          valB = (assignB.givenTo || b.salespersonName || '').toLowerCase();
          break;
        }
        case 'time': {
          valA = assignA.giveTime || '';
          valB = assignB.giveTime || '';
          break;
        }
      }

      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortOrder === 'asc' ? valA - valB : valB - valA;
      }
      const strA = String(valA);
      const strB = String(valB);
      return sortOrder === 'asc' ? strA.localeCompare(strB) : strB.localeCompare(strA);
    });
  }, [bills, selectedSalesperson, tableSearch, sortField, sortOrder, assigns]);

  const creditTableTotalAmt = useMemo(() => {
    return creditBills.reduce((sum, b) => sum + Number(b.billNetAmt || 0), 0);
  }, [creditBills]);

  // Bills that are NOT yet given and can be selected for Give
  const selectableBills = useMemo(() => {
    return creditBills.filter(b => {
      const key = b.id || b.billNo;
      const assign = assigns[key] || {};
      return !assign.isGiven;
    });
  }, [creditBills, assigns]);

  // Selected bills objects (excludes already given bills)
  const selectedBillsList = useMemo(() => {
    return creditBills.filter(b => {
      const key = b.id || b.billNo;
      const assign = assigns[key] || {};
      return selectedBillKeys.has(key) && !assign.isGiven;
    });
  }, [creditBills, selectedBillKeys, assigns]);

  const selectedBillsTotalAmt = useMemo(() => {
    return selectedBillsList.reduce((sum, b) => sum + Number(b.billNetAmt || 0), 0);
  }, [selectedBillsList]);

  // Toggle single bill selection (Locked if already given)
  const toggleBillSelection = (key: string) => {
    const assign = assigns[key] || {};
    if (assign.isGiven) {
      setAlertNotice(`⚠️ Bill already "${assign.givenTo || 'Salesman'}" ko ${assign.giveDate || 'date'} par diya ja chuka hai aur dobara select nahi ho sakta.`);
      setTimeout(() => setAlertNotice(null), 3500);
      return;
    }
    setSelectedBillKeys(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Toggle select all visible selectable credit bills
  const toggleSelectAll = () => {
    if (selectableBills.length === 0) {
      setAlertNotice('Sabhi visible bills already give kiye ja chuke hain.');
      setTimeout(() => setAlertNotice(null), 3000);
      return;
    }
    const allSelectableChosen = selectableBills.every(b => selectedBillKeys.has(b.id || b.billNo));
    if (allSelectableChosen) {
      setSelectedBillKeys(new Set());
    } else {
      const allKeys = new Set(selectableBills.map(b => b.id || b.billNo));
      setSelectedBillKeys(allKeys);
    }
  };

  // Open Give Modal
  const handleOpenGiveModal = () => {
    if (selectedBillsList.length === 0) {
      setAlertNotice('Kripya kam se kam ek pending credit bill select karein!');
      setTimeout(() => setAlertNotice(null), 3500);
      return;
    }

    setGiveDateInput(getTodayDMY());

    // Determine default salesman
    const defaultSp = selectedSalesperson || (selectedBillsList[0]?.salespersonName || allSalespersons[0] || '');
    setGiveSalesmanInput(defaultSp);

    // Auto load mobile number from contact store
    const contact = findSalespersonContact(defaultSp);
    setGiveSalesmanMobile(contact?.mobile || '');

    setShowGiveModal(true);
  };

  // Update mobile number when salesman selection changes in modal
  const handleSalesmanChangeInModal = (spName: string) => {
    setGiveSalesmanInput(spName);
    const contact = findSalespersonContact(spName);
    setGiveSalesmanMobile(contact?.mobile || '');
  };

  // Assign & mark bills as Given (Red font in table & locked from further selection)
  const executeBillGiveAssignment = (salesmanName: string, giveDate: string) => {
    const nowTime = getInitialTime();
    const nextAssigns = { ...assigns };

    selectedBillsList.forEach(b => {
      const key = b.id || b.billNo;
      nextAssigns[key] = {
        givenTo: salesmanName,
        giveDate: giveDate || getTodayDMY(),
        giveTime: nowTime,
        isGiven: true,
      };
    });

    setAssigns(nextAssigns);
    saveCreditAssigns(nextAssigns);
  };

  // Save salesperson mobile to Supabase / store if entered/updated
  const persistSalespersonMobile = async (spName: string, mobile: string) => {
    if (!spName || !mobile) return;
    const cleanDigits = mobile.replace(/\D/g, '');
    if (cleanDigits.length < 10) return;

    try {
      const contacts = getSalespersonContacts();
      const existingIdx = contacts.findIndex(c => (c.name || '').trim().toLowerCase() === spName.trim().toLowerCase());
      let updatedContacts: typeof contacts;
      if (existingIdx >= 0) {
        updatedContacts = contacts.map((c, idx) => idx === existingIdx ? { ...c, mobile: cleanDigits } : c);
      } else {
        updatedContacts = [...contacts, { id: `sp_${Date.now()}`, name: spName, mobile: cleanDigits }];
      }
      await saveSalespersonContacts(updatedContacts);
    } catch (e) {
      console.warn('Failed to save salesperson mobile:', e);
    }
  };

  // Send WhatsApp message & Give Bills
  const handleSendWhatsAppAndGive = async () => {
    const spName = giveSalesmanInput.trim();
    if (!spName) {
      alert('Kripya Salesperson select karein!');
      return;
    }

    const cleanDigits = giveSalesmanMobile.replace(/\D/g, '');
    if (cleanDigits.length < 10) {
      alert('Kripya 10-digit valid WhatsApp Mobile Number enter karein!');
      return;
    }

    const count = selectedBillsList.length;

    // 1. Persist mobile number
    await persistSalespersonMobile(spName, cleanDigits);

    // 2. Assign bills & mark as Given (Red font in table)
    executeBillGiveAssignment(spName, giveDateInput);

    // 3. Format WhatsApp Message for batch handover
    const phone = cleanDigits.length === 10 ? `91${cleanDigits}` : cleanDigits;

    let itemsList = '';
    selectedBillsList.forEach((b, idx) => {
      const bn = b.billNo.replace(/^GST[-/]?/i, '');
      const party = formatPartyName14Words(b.partyName);
      const amt = Number(b.billNetAmt || 0).toLocaleString('en-IN');
      const bDate = formatDisplayDate(b.date || b.deliveryDate);
      itemsList += `${idx + 1}. *GST${bn}* | ${party}\n   💰 Amt: ₹${amt} | 📅 Bill Date: ${bDate}\n`;
    });

    const totalAmtFormatted = selectedBillsTotalAmt.toLocaleString('en-IN');

    const message = `📋 *CREDIT BILLS HANDOVER*
━━━━━━━━━━━━━━━━━━━━
👤 *Salesperson:* ${spName}
📅 *Give Date:* ${giveDateInput}
📦 *Total Bills:* ${selectedBillsList.length}
💰 *Total Amount:* ₹${totalAmtFormatted}
━━━━━━━━━━━━━━━━━━━━
${itemsList}━━━━━━━━━━━━━━━━━━━━
Kripya in credit bills ka collection coordinate karein.`;

    const encodedMessage = encodeURIComponent(message);
    window.location.href = `whatsapp://send?phone=${phone}&text=${encodedMessage}`;

    setShowGiveModal(false);
    setSelectedBillKeys(new Set());
    setAlertNotice(`✓ ${count} Bills handed over to ${spName} successfully!`);
    setTimeout(() => setAlertNotice(null), 4000);
  };

  // Only Assign without WhatsApp
  const handleOnlyAssign = async () => {
    const spName = giveSalesmanInput.trim();
    if (!spName) {
      alert('Kripya Salesperson select karein!');
      return;
    }

    const count = selectedBillsList.length;

    if (giveSalesmanMobile.trim()) {
      await persistSalespersonMobile(spName, giveSalesmanMobile.trim());
    }

    executeBillGiveAssignment(spName, giveDateInput);

    setShowGiveModal(false);
    setSelectedBillKeys(new Set());
    setAlertNotice(`✓ ${count} Bills assigned to ${spName}!`);
    setTimeout(() => setAlertNotice(null), 4000);
  };

  // Render Sort Header Indicator
  const renderSortIndicator = (field: SortField) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-2.5 h-2.5 opacity-40 group-hover/th:opacity-100 transition-opacity" />;
    }
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-primary stroke-[3]" />
    ) : (
      <ArrowDown className="w-3 h-3 text-primary stroke-[3]" />
    );
  };

  return (
    <div className="min-h-screen bg-background pb-12 pt-10">
      <TopNav />
      <div className="bg-primary px-3 pt-2 pb-2 rounded-b-xl shadow-md">
        <h1 className="text-sm font-black text-primary-foreground uppercase tracking-widest max-w-full mx-auto">Outstanding Ledger</h1>
        <p className="text-[10px] font-black text-primary-foreground/60 uppercase tracking-tighter max-w-full mx-auto">Credit Bills & Collection Efficiency</p>
      </div>

      <div className="max-w-full mx-auto px-1 mt-3 space-y-3">
        {alertNotice && (
          <div className="bg-emerald-600 text-white text-xs font-black px-4 py-2 rounded-xl shadow-md flex items-center justify-between animate-in fade-in slide-in-from-top-2">
            <span>{alertNotice}</span>
            <button onClick={() => setAlertNotice(null)}><X className="w-4 h-4" /></button>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary" /></div>
        ) : (
          <>
            {/* Top Metric Cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-1">
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-primary/10 flex items-center justify-center mb-1 text-primary">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Net Payable</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.billAmt.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-1 text-amber-600">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Line Cut Total</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.lineCutTotal.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 flex items-center justify-center mb-1 text-emerald-600">
                  <TrendingUp className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Total Collected</p>
                <p className="text-[16px] font-bold text-foreground leading-tight">₹{totals.collected.toLocaleString('en-IN')}</p>
              </div>
              <div className="bg-card rounded-xl p-2 shadow-sm border border-border">
                <div className="w-6 h-6 rounded-lg bg-destructive/10 flex items-center justify-center mb-1 text-destructive">
                  <IndianRupee className="w-3 h-3" />
                </div>
                <p className="text-[7px] font-black text-muted-foreground uppercase tracking-widest leading-none mb-0.5">Outstanding</p>
                <p className="text-[16px] font-bold text-destructive leading-tight">₹{totals.outstanding.toLocaleString('en-IN')}</p>
              </div>
            </div>

            {/* ── Colourful Salesperson Name Cards (Same Size, Bold & Big Font, A-Z) ── */}
            <div className="space-y-1.5 px-0.5 bg-card/60 rounded-xl p-2.5 border border-border shadow-xs">
              <div className="flex items-center justify-between gap-2 flex-wrap mb-1">
                <div className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-primary" />
                  <h2 className="text-[10px] font-black text-foreground uppercase tracking-wider">
                    Salesperson Cards (Click to filter Credit Table)
                  </h2>
                </div>
                {selectedSalesperson && (
                  <button
                    onClick={() => setSelectedSalesperson(null)}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-black uppercase bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-300 border border-red-300 dark:border-red-800 hover:bg-red-200 transition-colors cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" /> Show All
                  </button>
                )}
              </div>

              <div className="flex flex-wrap gap-1.5">
                {/* ALL Button */}
                <button
                  onClick={() => setSelectedSalesperson(null)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all border cursor-pointer select-none shadow-2xs",
                    selectedSalesperson === null
                      ? "bg-primary text-primary-foreground border-primary ring-2 ring-primary/40 shadow-xs"
                      : "bg-card text-muted-foreground border-border hover:border-primary/40 hover:text-foreground hover:bg-muted/60"
                  )}
                >
                  ALL
                </button>

                {/* Salesperson Name Cards (Compact Size Preserved, Big Bold Text, Colorful A-Z) */}
                {creditSalespersons.map((spName, idx) => {
                  const isSelected = selectedSalesperson === spName;
                  const theme = SP_COLOR_THEMES[idx % SP_COLOR_THEMES.length];

                  return (
                    <button
                      key={spName}
                      onClick={() => {
                        setSelectedSalesperson(prev => prev === spName ? null : spName);
                      }}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-black uppercase transition-all border cursor-pointer select-none shadow-2xs flex items-center gap-1.5",
                        isSelected ? theme.selected : theme.unselected
                      )}
                    >
                      <span className="truncate max-w-[200px]">{spName}</span>
                      {isSelected && (
                        <Check className="w-3.5 h-3.5 text-white shrink-0 stroke-[3]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── Credit Bills Table (Salesperson Wise / All) ── */}
            <div className="mt-4 space-y-2 bg-card rounded-2xl p-3 border border-border shadow-sm">
              <div className="flex items-center justify-between gap-3 flex-wrap border-b border-border/80 pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-[12px] font-black uppercase tracking-wide text-foreground">
                        {selectedSalesperson ? `Credit Bills — ${selectedSalesperson}` : 'All Credit Bills (Outstanding Handover)'}
                      </h2>
                      <span className="text-[9.5px] font-black px-2 py-0.5 rounded-full bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-800 uppercase">
                        {creditBills.length} Bills · ₹{creditTableTotalAmt.toLocaleString('en-IN')}
                      </span>

                      {/* ── GIVE BUTTON NEXT TO HEADER ── */}
                      <Button
                        onClick={handleOpenGiveModal}
                        disabled={selectableBills.length === 0}
                        className={cn(
                          "h-7 px-3 rounded-lg font-black text-[10px] uppercase flex items-center gap-1.5 shadow-sm transition-all cursor-pointer",
                          selectedBillsList.length > 0
                            ? "bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse"
                            : "bg-primary hover:bg-primary/90 text-primary-foreground",
                          selectableBills.length === 0 && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <Send className="w-3 h-3" />
                        GIVE {selectedBillsList.length > 0 ? `(${selectedBillsList.length})` : ''}
                      </Button>
                    </div>
                    <p className="text-[8.5px] font-bold text-muted-foreground uppercase">
                      Dashboard entry me Credit bills yahan show honge. Give karne par bills RED font me lock ho jayenge. Payment receive hote hi auto remove honge.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-1 max-w-xs justify-end">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search bill, party, salesperson..."
                      value={tableSearch}
                      onChange={e => setTableSearch(e.target.value)}
                      className="w-full h-8 pl-8 pr-3 bg-muted rounded-xl text-[10px] font-bold border-0 outline-none focus:ring-2 focus:ring-primary/40 uppercase"
                    />
                    {tableSearch && (
                      <button
                        onClick={() => setTableSearch('')}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {creditBills.length === 0 ? (
                <div className="py-12 text-center text-muted-foreground space-y-1">
                  <p className="text-[11px] font-black uppercase text-foreground">Koi Credit Bill Pending Nahi Hai</p>
                  <p className="text-[9px] font-bold">
                    {selectedSalesperson
                      ? `Salesperson "${selectedSalesperson}" ke liye koi pending credit bill nahi hai.`
                      : 'Dashboard entry me credit bills save hone par yahan show honge.'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-separate border-spacing-y-[2px] text-left">
                    <thead>
                      <tr className="text-muted-foreground uppercase select-none">
                        {/* SELECT ALL CHECKBOX */}
                        <th className="px-2 py-1 text-[10px] font-black tracking-wider w-8 text-center">
                          <button
                            type="button"
                            onClick={toggleSelectAll}
                            disabled={selectableBills.length === 0}
                            className={cn(
                              "transition-colors flex items-center justify-center mx-auto",
                              selectableBills.length === 0 ? "opacity-40 cursor-not-allowed text-muted-foreground" : "text-foreground hover:text-primary cursor-pointer"
                            )}
                            title={selectableBills.length === 0 ? "Sabhi bills already given hain" : "Select All Pending Bills"}
                          >
                            {selectableBills.length > 0 && selectableBills.every(b => selectedBillKeys.has(b.id || b.billNo)) ? (
                              <CheckSquare className="w-4 h-4 text-primary" />
                            ) : (
                              <Square className="w-4 h-4 text-muted-foreground" />
                            )}
                          </button>
                        </th>

                        {/* 1. BILL NO (Sortable) */}
                        <th
                          onClick={() => handleSort('billNo')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>BILL NO</span>
                            {renderSortIndicator('billNo')}
                          </div>
                        </th>

                        {/* 2. BILL DATE (Sortable) */}
                        <th
                          onClick={() => handleSort('billDate')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>BILL DATE</span>
                            {renderSortIndicator('billDate')}
                          </div>
                        </th>

                        {/* 3. PARTY NAME (Sortable) */}
                        <th
                          onClick={() => handleSort('partyName')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>PARTY NAME (14 WORDS MAX)</span>
                            {renderSortIndicator('partyName')}
                          </div>
                        </th>

                        {/* 4. BILL AMT (Sortable) */}
                        <th
                          onClick={() => handleSort('billAmt')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors text-right"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>BILL AMT</span>
                            {renderSortIndicator('billAmt')}
                          </div>
                        </th>

                        {/* 5. DEL DATE (Sortable) */}
                        <th
                          onClick={() => handleSort('delDate')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>DEL DATE</span>
                            {renderSortIndicator('delDate')}
                          </div>
                        </th>

                        {/* 6. GIVE BILL DATE (Sortable) */}
                        <th
                          onClick={() => handleSort('giveDate')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>GIVE BILL DATE</span>
                            {renderSortIndicator('giveDate')}
                          </div>
                        </th>

                        {/* 7. KON LEGAYA (SALESPERSON) (Sortable) */}
                        <th
                          onClick={() => handleSort('givenTo')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>KON LEGAYA (SALESPERSON)</span>
                            {renderSortIndicator('givenTo')}
                          </div>
                        </th>

                        {/* 8. TIME (Sortable) */}
                        <th
                          onClick={() => handleSort('time')}
                          className="px-2 py-1 text-[10.5px] font-black tracking-wider cursor-pointer hover:text-foreground group/th transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>TIME</span>
                            {renderSortIndicator('time')}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditBills.map((b) => {
                        const key = b.id || b.billNo;
                        const assign = assigns[key] || {};
                        const giveDate = assign.giveDate || getTodayDMY();
                        const givenTo = assign.givenTo || b.salespersonName || '';
                        const giveTime = assign.giveTime || getInitialTime();
                        const isGiven = !!assign.isGiven;
                        const partyTruncated = formatPartyName14Words(b.partyName);
                        const billDate = formatDisplayDate(b.date || b.deliveryDate);
                        const delDate = formatDisplayDate(b.deliveryDate || b.date);
                        const isSelected = selectedBillKeys.has(key);

                        return (
                          <tr
                            key={key}
                            className={cn(
                              "border rounded-md transition-colors shadow-2xs group select-none",
                              isGiven
                                ? "bg-red-50/40 dark:bg-red-950/20 border-red-200/80 dark:border-red-900/60 hover:bg-red-50/60 dark:hover:bg-red-950/30"
                                : isSelected
                                ? "bg-primary/10 border-primary/40 dark:bg-primary/15"
                                : "bg-card hover:bg-accent/40 border-border/80"
                            )}
                          >
                            {/* SELECTION CHECKBOX (LOCKED IF GIVEN) */}
                            <td className="px-2 py-1 text-center whitespace-nowrap rounded-l-md border-y border-l border-border/60">
                              {isGiven ? (
                                <div
                                  className="flex items-center justify-center mx-auto text-red-600 dark:text-red-400 cursor-not-allowed group/lock"
                                  title={`Already Given to "${givenTo || 'Salesman'}" on ${giveDate}. Dobara select nahi ho sakta.`}
                                  onClick={() => {
                                    setAlertNotice(`⚠️ Bill already "${givenTo || 'Salesman'}" ko ${giveDate} par diya ja chuka hai aur dobara select nahi ho sakta.`);
                                    setTimeout(() => setAlertNotice(null), 3000);
                                  }}
                                >
                                  <Lock className="w-4 h-4 text-red-600 dark:text-red-400 stroke-[2.5]" />
                                </div>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => toggleBillSelection(key)}
                                  className="text-foreground hover:text-primary transition-colors cursor-pointer flex items-center justify-center mx-auto"
                                >
                                  {isSelected ? (
                                    <CheckSquare className="w-4 h-4 text-primary" />
                                  ) : (
                                    <Square className="w-4 h-4 text-muted-foreground" />
                                  )}
                                </button>
                              )}
                            </td>

                            {/* 1. BILL NO - BOLD & BIG FONT */}
                            <td className="px-2 py-1 text-[11.5px] font-black text-foreground whitespace-nowrap border-y border-border/60">
                              <span className={cn(isGiven ? "text-red-600 dark:text-red-400 font-black" : "text-primary font-black")}>
                                {b.billNo}
                              </span>
                            </td>

                            {/* 2. BILL DATE - BOLD & BIG FONT */}
                            <td className="px-2 py-1 text-[11px] font-black text-foreground whitespace-nowrap border-y border-border/60">
                              {billDate}
                            </td>

                            {/* 3. PARTY NAME (14 WORDS MAX) - BOLD & BIG FONT */}
                            <td className="px-2 py-1 text-[11px] font-black text-foreground max-w-xs truncate border-y border-border/60" title={b.partyName}>
                              {partyTruncated}
                            </td>

                            {/* 4. BILL AMT - BOLD & BIG FONT */}
                            <td className="px-2 py-1 text-[11.5px] font-black text-foreground text-right whitespace-nowrap border-y border-border/60">
                              ₹{Number(b.billNetAmt || 0).toLocaleString('en-IN')}
                            </td>

                            {/* 5. DEL DATE - BOLD & BIG FONT */}
                            <td className="px-2 py-1 text-[11px] font-black text-foreground whitespace-nowrap border-y border-border/60">
                              {delDate}
                            </td>

                            {/* 6. GIVE BILL DATE - BOLD & BIG FONT (RED FONT IF GIVEN) */}
                            <td className="px-2 py-1 text-[11px] font-black whitespace-nowrap border-y border-border/60">
                              <div className={cn(
                                "flex items-center gap-1 px-1.5 py-0.5 rounded border transition-colors",
                                isGiven 
                                  ? "bg-red-50 dark:bg-red-950/80 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 shadow-2xs" 
                                  : "bg-muted/70 border-border/50 text-foreground"
                              )}>
                                <Calendar className={cn("w-3 h-3 shrink-0", isGiven ? "text-red-600 dark:text-red-400 stroke-[2.5]" : "text-primary")} />
                                <input
                                  type="text"
                                  value={giveDate}
                                  onChange={e => updateAssign(b, { giveDate: e.target.value })}
                                  placeholder="DD/MM/YYYY"
                                  className={cn(
                                    "w-24 bg-transparent text-[11px] font-black outline-none uppercase",
                                    isGiven ? "text-red-600 dark:text-red-400 font-black placeholder:text-red-400" : "text-foreground"
                                  )}
                                />
                                {isGiven && (
                                  <span className="text-[7.5px] font-black px-1 py-0.2 rounded bg-red-600 text-white uppercase tracking-tighter shrink-0">
                                    GIVEN
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* 7. SALESPERSON NAME SELECTION - BOLD & BIG FONT (RED FONT IF GIVEN) */}
                            <td className="px-2 py-1 text-[11px] font-black whitespace-nowrap border-y border-border/60">
                              <select
                                value={givenTo}
                                onChange={e => updateAssign(b, { givenTo: e.target.value })}
                                className={cn(
                                  "px-1.5 py-0.5 rounded border text-[11px] font-black outline-none uppercase cursor-pointer max-w-[190px]",
                                  isGiven 
                                    ? "bg-red-50 dark:bg-red-950/80 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-black shadow-2xs" 
                                    : "bg-muted/70 border-border/50 text-foreground"
                                )}
                              >
                                <option value="">Select Salesperson</option>
                                {allSalespersons.map(sp => (
                                  <option key={sp} value={sp}>{sp}</option>
                                ))}
                              </select>
                            </td>

                            {/* 8. TIME - BOLD & BIG FONT (RED FONT IF GIVEN + UNLOCK OPTION) */}
                            <td className="px-2 py-1 text-[11px] font-black whitespace-nowrap rounded-r-md border-y border-r border-border/60">
                              <div className={cn(
                                "flex items-center gap-1 px-1.5 py-0.5 rounded border justify-between",
                                isGiven 
                                  ? "bg-red-50 dark:bg-red-950/80 border-red-300 dark:border-red-800 text-red-600 dark:text-red-400 font-black shadow-2xs" 
                                  : "bg-muted/70 border-border/50 text-foreground"
                              )}>
                                <div className="flex items-center gap-1">
                                  <Clock className={cn("w-3 h-3 shrink-0", isGiven ? "text-red-600 dark:text-red-400 stroke-[2.5]" : "text-muted-foreground")} />
                                  <span className={cn("text-[11px] font-black", isGiven ? "text-red-600 dark:text-red-400 font-black" : "text-foreground")}>
                                    {giveTime}
                                  </span>
                                </div>
                                {isGiven && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      if (window.confirm(`Kya aap Bill ${b.billNo} ka Give status unlock/reset karna chahte hain?`)) {
                                        updateAssign(b, { isGiven: false });
                                        setAlertNotice(`✓ Bill ${b.billNo} ka Give status reset kar diya gaya hai.`);
                                        setTimeout(() => setAlertNotice(null), 3000);
                                      }
                                    }}
                                    title="Unlock / Reset Give status"
                                    className="p-0.5 text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 rounded cursor-pointer transition-colors ml-1"
                                  >
                                    <RotateCcw className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* ── GIVE POPUP MODAL ── */}
      {showGiveModal && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4 backdrop-blur-xs">
          <div className="bg-card rounded-2xl p-5 w-full max-w-md shadow-2xl border border-border animate-in zoom-in-95 space-y-4">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-border pb-3">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 flex items-center justify-center text-emerald-600">
                  <Send className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-black text-sm uppercase text-foreground">Handover Credit Bills (GIVE)</h3>
                  <p className="text-[9.5px] font-bold text-muted-foreground uppercase">
                    {selectedBillsList.length} Bills Selected · Total ₹{selectedBillsTotalAmt.toLocaleString('en-IN')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowGiveModal(false)}
                className="p-1 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Form Fields */}
            <div className="space-y-3">
              {/* Field 1: Give Date */}
              <div className="space-y-1">
                <label className="text-[8.5px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-primary" /> Give Bill Date (Current Date / Editable)
                </label>
                <input
                  type="text"
                  value={giveDateInput}
                  onChange={e => setGiveDateInput(e.target.value)}
                  placeholder="DD/MM/YYYY"
                  className="w-full h-10 px-3 bg-muted rounded-xl text-[11px] font-black border border-border focus:ring-2 focus:ring-primary/40 outline-none uppercase text-foreground"
                />
              </div>

              {/* Field 2: Salesman Name Selection */}
              <div className="space-y-1">
                <label className="text-[8.5px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <Users className="w-3 h-3 text-primary" /> Select Salesperson (Kon Legaya)
                </label>
                <select
                  value={giveSalesmanInput}
                  onChange={e => handleSalesmanChangeInModal(e.target.value)}
                  className="w-full h-10 px-3 bg-muted rounded-xl text-[11px] font-black border border-border focus:ring-2 focus:ring-primary/40 outline-none uppercase text-foreground cursor-pointer"
                >
                  <option value="">Select Salesperson</option>
                  {allSalespersons.map(sp => (
                    <option key={sp} value={sp}>{sp}</option>
                  ))}
                </select>
              </div>

              {/* Field 3: Salesperson Mobile Number (From Supabase / Store) */}
              <div className="space-y-1">
                <label className="text-[8.5px] font-black text-muted-foreground uppercase tracking-widest flex items-center gap-1">
                  <Phone className="w-3 h-3 text-emerald-600" /> Salesperson WhatsApp Mobile No
                </label>
                <input
                  type="tel"
                  inputMode="numeric"
                  value={giveSalesmanMobile}
                  onChange={e => setGiveSalesmanMobile(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full h-10 px-3 bg-muted rounded-xl text-[11px] font-black border border-border focus:ring-2 focus:ring-primary/40 outline-none uppercase text-foreground"
                />
                <p className="text-[8px] font-bold text-muted-foreground">
                  * Mobile number Supabase me save ho jayega.
                </p>
              </div>

              {/* Selected Bills Preview Box */}
              <div className="bg-muted/60 rounded-xl p-2.5 border border-border/80 space-y-1.5 max-h-36 overflow-y-auto">
                <p className="text-[8.5px] font-black text-muted-foreground uppercase tracking-wider">
                  Selected Bills to Handover:
                </p>
                <div className="space-y-1">
                  {selectedBillsList.map((b, idx) => (
                    <div key={b.id || b.billNo} className="flex items-center justify-between text-[9px] font-bold bg-card p-1.5 rounded-lg border border-border/50">
                      <span className="text-primary font-black">{idx + 1}. {b.billNo}</span>
                      <span className="text-foreground max-w-[150px] truncate">{formatPartyName14Words(b.partyName)}</span>
                      <span className="text-emerald-600 font-black">₹{Number(b.billNetAmt || 0).toLocaleString('en-IN')}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="space-y-2 pt-1">
              {/* WhatsApp Button */}
              <Button
                onClick={handleSendWhatsAppAndGive}
                disabled={!giveSalesmanInput || selectedBillsList.length === 0}
                className="w-full h-10 bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs uppercase rounded-xl flex items-center justify-center gap-2 shadow-md cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-white" />
                SEND WHATSAPP & GIVE BILLS
              </Button>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleOnlyAssign}
                  disabled={!giveSalesmanInput || selectedBillsList.length === 0}
                  className="flex-1 h-9 rounded-xl font-black text-[10px] uppercase border-border text-foreground hover:bg-muted cursor-pointer"
                >
                  ASSIGN WITHOUT WHATSAPP
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowGiveModal(false)}
                  className="h-9 px-4 rounded-xl font-black text-[10px] uppercase text-muted-foreground hover:text-foreground cursor-pointer"
                >
                  CANCEL
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
