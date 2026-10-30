import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Send, Megaphone, AlertTriangle, Users, CheckCircle2,
  Trash2, Radio, User, Clock, BellOff, Volume2, Sparkles,
  Search, Check,
} from 'lucide-react';
import {
  sendUrgentMessage,
  cancelUrgentMessage,
  getActiveMessages,
  getAllMessages,
  syncActiveMessages,
  syncAllMessages,
  subscribeUrgentMessages,
  UrgentMessage,
} from '@/lib/urgentMessageStore';
import { getDrivers } from '@/lib/billStore';
import { getLoggedInName, getRole } from '@/lib/auth';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface SendUrgentMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SendUrgentMessageModal({ isOpen, onClose }: SendUrgentMessageModalProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'compose' | 'active'>('compose');
  const [selectedTargets, setSelectedTargets] = useState<string[]>(['ALL']);
  const [customUser, setCustomUser] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [messageText, setMessageText] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [activeMessages, setActiveMessages] = useState<UrgentMessage[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Staff users list (ONLY users who have login passwords - DRIVERS STRICTLY EXCLUDED)
  const [staffList, setStaffList] = useState<string[]>([]);

  useEffect(() => {
    // 1. Primary Staff users who have login passwords
    const staffNames = new Set<string>();
    staffNames.add('KHUSHI');
    staffNames.add('TARACHAND');
    staffNames.add('VIPUL BHAI');
    staffNames.add('PRATIXA');

    // 2. Add any additional users from user_passwords settings
    try {
      const pwMap = JSON.parse(localStorage.getItem('vt_user_passwords') || '{}');
      if (pwMap && typeof pwMap === 'object') {
        for (const k of Object.keys(pwMap)) {
          if (!k || !k.trim()) continue;
          const uUpper = k.trim().toUpperCase();
          if (uUpper.includes('VIPUL')) {
            staffNames.add('VIPUL BHAI');
          } else {
            staffNames.add(uUpper);
          }
        }
      }
    } catch {}

    // 3. Add staff users from drivers table where role is explicitly 'user' or id starts with 'usr_'
    try {
      const rawDrivers = getDrivers();
      for (const d of rawDrivers) {
        if (!d.name) continue;
        const tName = d.name.trim().toUpperCase();
        if (d.role === 'user' || (d.id && d.id.startsWith('usr_'))) {
          if (tName.includes('VIPUL')) {
            staffNames.add('VIPUL BHAI');
          } else {
            staffNames.add(tName);
          }
        }
      }
    } catch {}

    // Strict Driver Exclusion: gather all driver names to ensure ZERO drivers leak in
    const knownDriverNames = new Set<string>();
    try {
      const rawDrivers = getDrivers();
      for (const d of rawDrivers) {
        if (d.name && d.role !== 'user' && !d.id?.startsWith('usr_') && d.role !== 'owner' && !d.id?.startsWith('own_')) {
          knownDriverNames.add(d.name.trim().toUpperCase());
        }
      }
      const dn = JSON.parse(localStorage.getItem('vt_driver_names') || '[]');
      if (Array.isArray(dn)) {
        for (const s of dn) if (s) knownDriverNames.add(String(s).trim().toUpperCase());
      }
    } catch {}

    // Filter to ONLY staff who are not drivers
    const cleanStaff: string[] = [];
    for (const s of staffNames) {
      if (s && !knownDriverNames.has(s.toUpperCase())) {
        cleanStaff.push(s);
      }
    }

    // Sort with primary 4 first, then alphabetical
    const primaryOrder = ['KHUSHI', 'TARACHAND', 'VIPUL BHAI', 'PRATIXA'];
    cleanStaff.sort((a, b) => {
      const idxA = primaryOrder.indexOf(a);
      const idxB = primaryOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });

    setStaffList(cleanStaff);
  }, [isOpen]);

  // Keep active messages in sync
  useEffect(() => {
    if (!isOpen) return;
    syncActiveMessages();
    syncAllMessages();
    setActiveMessages(getActiveMessages());

    const unsubscribe = subscribeUrgentMessages(() => {
      setActiveMessages(getActiveMessages());
    });

    return () => {
      unsubscribe();
    };
  }, [isOpen]);

  // Memoize unique active messages to avoid any duplicate keys in render
  const uniqueActiveMessages = useMemo(() => {
    const seen = new Set<string>();
    const res: UrgentMessage[] = [];
    for (const m of activeMessages) {
      if (m && m.id && !seen.has(m.id)) {
        seen.add(m.id);
        res.push(m);
      }
    }
    return res;
  }, [activeMessages]);

  // Toggle user selection
  function toggleUserSelection(name: string) {
    setSelectedTargets((prev) => {
      if (prev.includes('ALL')) {
        return [name];
      }
      if (prev.includes(name)) {
        const next = prev.filter((n) => n !== name);
        return next;
      } else {
        return [...prev, name];
      }
    });
  }

  const isAllSelected = selectedTargets.includes('ALL');

  // Compute final effective target string
  const effectiveTargetsList = useMemo(() => {
    if (isAllSelected) return ['ALL'];
    const list = [...selectedTargets];
    if (customUser.trim() && !list.includes(customUser.trim())) {
      list.push(customUser.trim());
    }
    return list;
  }, [isAllSelected, selectedTargets, customUser]);

  const effectiveTargetString = effectiveTargetsList.join(', ');
  const effectiveTargetLabel = isAllSelected
    ? 'Sabhi Staff Users (ALL)'
    : effectiveTargetsList.length > 0
    ? effectiveTargetsList.join(', ')
    : 'Koi user select nahi hai';

  // Filter staff list based on search query
  const qLower = searchQuery.trim().toLowerCase();
  const filteredStaff = useMemo(() => {
    if (!qLower) return staffList;
    return staffList.filter((s) => s.toLowerCase().includes(qLower));
  }, [staffList, qLower]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = messageText.trim();
    if (!trimmed) {
      toast({
        title: 'Message Khali Hai',
        description: 'Kripya sandesh likhein!',
        variant: 'destructive',
      });
      return;
    }

    if (!isAllSelected && effectiveTargetsList.length === 0) {
      toast({
        title: 'User Name Select Karein',
        description: 'Kripya kam se kam ek user select karein ya ALL choose karein!',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const res = await sendUrgentMessage({
        targetUser: effectiveTargetString || 'ALL',
        text: trimmed,
      });

      if (res.ok) {
        toast({
          title: 'Message Sent / Popup Live!',
          description: `Sandesh ${effectiveTargetLabel} ke device par popup ho gaya!`,
        });
        setMessageText('');
        setActiveTab('active');
      } else {
        toast({
          title: 'Bhejne Me Error',
          description: res.error || 'Server error',
          variant: 'destructive',
        });
      }
    } finally {
      setIsSending(false);
    }
  }

  async function handleCancelMessage(id: string) {
    setCancellingId(id);
    try {
      const ok = await cancelUrgentMessage(id);
      if (ok) {
        toast({
          title: 'Message Band Ho Gaya',
          description: 'Sabhi screens se sandesh turant hat gaya!',
        });
      }
    } finally {
      setCancellingId(null);
    }
  }

  const role = getRole();
  if (!isOpen || role !== 'owner') return null;

  return (
    <div
      className="fixed inset-0 z-[100000] flex items-center justify-center p-3 sm:p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-2xl bg-card border-2 border-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-red-600/10 text-red-600 flex items-center justify-center border border-red-600/20">
              <Megaphone className="w-5 h-5 animate-pulse" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-foreground flex items-center gap-2">
                Emergency Message Pop / Broadcast
              </h2>
              <p className="text-[11px] text-muted-foreground font-medium">
                Target internal user ke device par 48px Bold Red font me popup dikhega
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs: Compose vs Active Messages */}
        <div className="flex border-b border-border px-5 bg-muted/10">
          <button
            onClick={() => setActiveTab('compose')}
            className={cn(
              "py-3 px-4 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2",
              activeTab === 'compose'
                ? "border-red-600 text-red-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Send className="w-3.5 h-3.5" />
            Naya Message Bhejo
          </button>
          <button
            onClick={() => setActiveTab('active')}
            className={cn(
              "py-3 px-4 text-xs font-black uppercase tracking-wider border-b-2 transition-all flex items-center gap-2 relative",
              activeTab === 'active'
                ? "border-red-600 text-red-600"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            <Radio className="w-3.5 h-3.5 animate-pulse" />
            Chal Rahe Messages
            {uniqueActiveMessages.length > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded-full bg-red-600 text-white text-[10px] font-black">
                {uniqueActiveMessages.length}
              </span>
            )}
          </button>
        </div>

        {/* Tab Body */}
        <div className="p-5 overflow-y-auto flex-1">
          {activeTab === 'compose' ? (
            <form onSubmit={handleSend} className="space-y-4">
              
              {/* Target Users Selector: Visibly Show All User & Driver Names */}
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-primary" />
                    Kisko Bhejna Hai? (User Name Select Karein)
                  </label>
                  <div className="flex flex-wrap items-center gap-1 text-[11px] font-bold">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTargets(['ALL']);
                        setCustomUser('');
                      }}
                      className={cn(
                        "px-2.5 py-1 rounded-lg border text-xs font-black transition-all cursor-pointer",
                        isAllSelected
                          ? "bg-red-600 text-white border-red-600 shadow-xs"
                          : "bg-muted/60 hover:bg-muted text-muted-foreground border-border"
                      )}
                    >
                      🔴 SABHI (ALL)
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedTargets(staffList.length > 0 ? [...staffList] : ['staff']);
                        setCustomUser('');
                      }}
                      className="px-2 py-1 rounded-lg bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground border border-border text-[11px] font-bold transition-all cursor-pointer"
                    >
                      💼 Sabhi Staff
                    </button>
                    {selectedTargets.length > 0 && !isAllSelected && (
                      <button
                        type="button"
                        onClick={() => setSelectedTargets([])}
                        className="px-2 py-1 rounded-lg bg-muted/40 hover:bg-destructive/10 text-destructive border border-border text-[11px] font-bold transition-all cursor-pointer"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                </div>

                {/* Search filter for staff users */}
                {staffList.length > 4 && (
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Staff user ka naam search karein..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-background/80 border border-border rounded-xl pl-8 pr-3 py-1.5 text-xs font-semibold text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                )}

                {/* Selected Targets Summary Banner */}
                <div className="p-2.5 rounded-xl border border-border bg-muted/20 flex flex-wrap items-center gap-1.5 min-h-[38px]">
                  <span className="text-[11px] font-black uppercase tracking-wider text-muted-foreground mr-1 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    Selected ({isAllSelected ? 'SABHI STAFF' : effectiveTargetsList.length}):
                  </span>
                  {isAllSelected ? (
                    <span className="px-2.5 py-0.5 rounded-md bg-red-600/15 text-red-600 border border-red-600/30 text-xs font-black">
                      🔴 SABHI STAFF USERS (ALL DEVICES)
                    </span>
                  ) : effectiveTargetsList.length === 0 ? (
                    <span className="text-xs text-amber-500 font-bold italic">
                      Koi user select nahi hai (Niche staff chip par click karein ya ALL chunein)
                    </span>
                  ) : (
                    <>
                      {selectedTargets.map((name) => (
                        <span
                          key={name}
                          className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-primary/15 text-primary border border-primary/30 text-xs font-black"
                        >
                          {name}
                          <button
                            type="button"
                            onClick={() => toggleUserSelection(name)}
                            className="hover:text-destructive cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3 stroke-[3]" />
                          </button>
                        </span>
                      ))}
                      {customUser.trim() && (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-lg bg-purple-500/15 text-purple-600 border border-purple-500/30 text-xs font-black">
                          ✏️ {customUser.trim()}
                          <button
                            type="button"
                            onClick={() => setCustomUser('')}
                            className="hover:text-destructive cursor-pointer ml-0.5"
                          >
                            <X className="w-3 h-3 stroke-[3]" />
                          </button>
                        </span>
                      )}
                    </>
                  )}
                </div>

                {/* Visual User Chips: Staff Users with Login Passwords */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-black uppercase tracking-wider text-foreground/80 flex items-center gap-1">
                      <User className="w-3.5 h-3.5 text-blue-500" />
                      Staff Login Users ({filteredStaff.length})
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2 max-h-[160px] overflow-y-auto p-2 rounded-xl bg-background/50 border border-border/60">
                    {filteredStaff.length === 0 ? (
                      <span className="text-xs text-muted-foreground p-2">Koi staff match nahi hua</span>
                    ) : (
                      filteredStaff.map((staffName) => {
                        const isSelected = selectedTargets.includes(staffName);
                        return (
                          <button
                            key={staffName}
                            type="button"
                            onClick={() => toggleUserSelection(staffName)}
                            className={cn(
                              "flex items-center gap-2 px-3.5 py-2 rounded-xl border text-xs font-black transition-all cursor-pointer select-none",
                              isSelected
                                ? "bg-primary text-primary-foreground border-primary shadow-sm scale-102 ring-2 ring-primary/40"
                                : "bg-card hover:bg-muted text-foreground border-border hover:border-primary/50"
                            )}
                          >
                            <User className={cn("w-4 h-4", isSelected ? "text-primary-foreground" : "text-blue-500")} />
                            <span className="tracking-wide">{staffName}</span>
                            {isSelected && <CheckCircle2 className="w-3.5 h-3.5 ml-0.5 stroke-[3]" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Custom Name / Other User Optional Input */}
                <div className="flex items-center gap-2 pt-1">
                  <input
                    type="text"
                    placeholder="✏️ Kisi aur user ka naam add karein..."
                    value={customUser}
                    onChange={(e) => {
                      setCustomUser(e.target.value);
                      if (selectedTargets.includes('ALL')) {
                        setSelectedTargets([]);
                      }
                    }}
                    className="flex-1 bg-background border border-border rounded-xl px-3 py-1.5 text-xs font-bold text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                  {customUser.trim() && (
                    <button
                      type="button"
                      onClick={() => {
                        const trimmed = customUser.trim();
                        if (trimmed && !selectedTargets.includes(trimmed)) {
                          setSelectedTargets((prev) => [...prev.filter(t => t !== 'ALL'), trimmed]);
                          setCustomUser('');
                        }
                      }}
                      className="px-3 py-1.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-black cursor-pointer shadow-xs"
                    >
                      + Add
                    </button>
                  )}
                </div>
              </div>

              {/* Message Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Megaphone className="w-4 h-4 text-red-600" />
                  Message Text (Sandesh)
                </label>
                <textarea
                  rows={3}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Yahan message likhein... (e.g. Sabhi staff turant verification complete karein! / Naya collection update karein)"
                  className="w-full bg-background border border-border rounded-2xl p-3 text-base font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500 resize-none shadow-inner"
                  required
                />
              </div>

              {/* Quick Template Chips */}
              <div className="flex flex-wrap gap-1.5 pt-0.5">
                {[
                  'Sabhi staff turant bill check karein!',
                  'Day end collection verify karein.',
                  'Naya bill check karein aur verify karein.',
                  'Emergency notice: Owner desk par contact karein.',
                ].map((tpl) => (
                  <button
                    key={tpl}
                    type="button"
                    onClick={() => setMessageText(tpl)}
                    className="text-[11px] font-semibold bg-muted hover:bg-muted/80 text-foreground px-2.5 py-1 rounded-lg border border-border transition-colors cursor-pointer text-left"
                  >
                    + {tpl}
                  </button>
                ))}
              </div>

              {/* Live Preview Box: 48px BOLD RED FONT */}
              {messageText.trim() && (
                <div className="mt-3 p-4 rounded-2xl border-2 border-red-500/40 bg-red-500/5 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-red-600">
                    <span>Live Preview (48px Bold Red Font)</span>
                    <span className="truncate max-w-[50%]">Target: {effectiveTargetLabel}</span>
                  </div>
                  <div
                    style={{ fontSize: '48px', lineHeight: '1.15' }}
                    className="text-[28px] sm:text-[48px] font-black font-extrabold text-red-600 tracking-tight leading-tight text-center break-words select-none py-2"
                  >
                    {messageText}
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSending || !messageText.trim() || (!isAllSelected && selectedTargets.length === 0 && !customUser.trim())}
                  className="w-full py-3.5 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                  <span>
                    {isSending
                      ? 'Bheja Jaa Raha Hai...'
                      : `SEND POPUP TO ${effectiveTargetLabel.toUpperCase()}`}
                  </span>
                </button>
              </div>
            </form>
          ) : (
            /* Active Messages Management List ("ME BAND KARU TOBHI BAND HO JAYE GA") */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold text-muted-foreground">
                  Yahan se aap kisi bhi chal rahe popup message ko band kar sakte hain. Aapke band karte hi sabhi screens se gayab ho jayega!
                </p>
              </div>

              {uniqueActiveMessages.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center text-muted-foreground border-2 border-dashed border-border rounded-2xl">
                  <BellOff className="w-10 h-10 mb-2 opacity-50" />
                  <p className="text-sm font-bold">Koi active popup message nahi chal raha hai</p>
                  <button
                    onClick={() => setActiveTab('compose')}
                    className="mt-3 text-xs font-black text-red-600 hover:underline"
                  >
                    Naya Message Bhejein
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {uniqueActiveMessages.map((msg, index) => (
                    <div
                      key={`${msg.id}_${index}`}
                      className="p-4 rounded-2xl border-2 border-red-500/30 bg-card shadow-sm flex flex-col gap-3"
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2 text-xs font-bold text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5 text-primary" />
                          <span>By: <strong>{msg.senderName}</strong></span>
                          <span className="ml-2 px-2 py-0.5 rounded-md bg-red-600/10 text-red-600 font-black uppercase text-[10px]">
                            Target: {msg.targetUser === 'ALL' ? 'ALL USERS' : msg.targetUser}
                          </span>
                        </div>
                        <div className="flex items-center gap-1 text-[11px]">
                          <Clock className="w-3 h-3" />
                          <span>
                            {new Date(msg.createdAt).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                              hour12: true,
                            })}
                          </span>
                        </div>
                      </div>

                      {/* Message in 30px / large red bold */}
                      <div className="text-[20px] sm:text-[24px] font-black text-red-600 leading-tight break-words">
                        {msg.text}
                      </div>

                      {/* Recipient dismiss count */}
                      {msg.dismissedBy && msg.dismissedBy.length > 0 && (
                        <div className="text-[11px] font-semibold text-muted-foreground">
                          Closed by recipients: {msg.dismissedBy.join(', ')}
                        </div>
                      )}

                      {/* Sender Close Button: "ME BAND KARU TOBHI BAND HO JAYE GA" */}
                      <div className="pt-1 flex justify-end">
                        <button
                          onClick={() => handleCancelMessage(msg.id)}
                          disabled={cancellingId === msg.id}
                          className="py-2 px-4 rounded-xl bg-destructive hover:bg-destructive/90 text-white font-black text-xs uppercase tracking-wider flex items-center gap-1.5 shadow-sm transition-all cursor-pointer active:scale-95 disabled:opacity-50"
                        >
                          <X className="w-4 h-4 stroke-[3]" />
                          <span>
                            {cancellingId === msg.id ? 'Band Ho Raha Hai...' : 'BAND KARE / STOP FOR ALL'}
                          </span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
export default SendUrgentMessageModal;
