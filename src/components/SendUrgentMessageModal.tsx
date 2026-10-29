import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Send, Megaphone, AlertTriangle, Users, CheckCircle2,
  Trash2, Radio, User, Clock, BellOff, Volume2, Sparkles,
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
  const [targetUser, setTargetUser] = useState<string>('ALL');
  const [customUser, setCustomUser] = useState<string>('');
  const [messageText, setMessageText] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [activeMessages, setActiveMessages] = useState<UrgentMessage[]>([]);
  const [cancellingId, setCancellingId] = useState<string | null>(null);

  // Available users/drivers list
  const [userList, setUserList] = useState<string[]>([]);

  useEffect(() => {
    // Gather all known driver names and staff names
    const drivers = getDrivers();
    const names = new Set<string>();

    // Add drivers
    for (const d of drivers) {
      if (d.name) names.add(d.name.trim());
    }

    // Add cached staff names from login
    try {
      const staff = JSON.parse(localStorage.getItem('vt_staff_names') || '[]');
      if (Array.isArray(staff)) {
        for (const s of staff) if (s) names.add(String(s).trim());
      }
    } catch {}

    // Add other known driver names
    try {
      const dn = JSON.parse(localStorage.getItem('vt_driver_names') || '[]');
      if (Array.isArray(dn)) {
        for (const s of dn) if (s) names.add(String(s).trim());
      }
    } catch {}

    // Pratixa if not already present
    names.add('Pratixa');

    const sorted = Array.from(names).sort((a, b) => a.localeCompare(b));
    setUserList(sorted);
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

  if (!isOpen) return null;

  const effectiveTarget = targetUser === '__custom__' ? customUser.trim() : targetUser;

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

    if (targetUser === '__custom__' && !customUser.trim()) {
      toast({
        title: 'User Name Daalein',
        description: 'Kripya target user ka naam likhein!',
        variant: 'destructive',
      });
      return;
    }

    setIsSending(true);
    try {
      const res = await sendUrgentMessage({
        targetUser: effectiveTarget || 'ALL',
        text: trimmed,
      });

      if (res.ok) {
        toast({
          title: 'Message Sent / Popup Live!',
          description: `Sandesh ${effectiveTarget === 'ALL' ? 'Sabhi Users' : effectiveTarget} ke device par popup ho gaya!`,
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
                Target user ke device par 30px Bold Red font me popup dikhega
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
              
              {/* Target User Selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-black uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Users className="w-4 h-4 text-primary" />
                  Kisko Bhejna Hai? (Select User / Screen)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <select
                    value={targetUser}
                    onChange={(e) => setTargetUser(e.target.value)}
                    className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    <option value="ALL">🔴 SABHI USERS (All Devices & Screens)</option>
                    <option value="owner">👑 Owner Only</option>
                    <option value="user">💼 Staff Users Only</option>
                    <option value="driver">🚚 All Drivers Only</option>
                    <optgroup label="Single User / Driver">
                      {userList.map((u, i) => (
                        <option key={`${u}_${i}`} value={u}>
                          👤 {u}
                        </option>
                      ))}
                    </optgroup>
                    <option value="__custom__">✏️ Custom Name Type Karein...</option>
                  </select>

                  {targetUser === '__custom__' && (
                    <input
                      type="text"
                      placeholder="User / Driver ka naam..."
                      value={customUser}
                      onChange={(e) => setCustomUser(e.target.value)}
                      className="w-full bg-background border border-border rounded-xl px-3 py-2 text-sm font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500"
                      autoFocus
                    />
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
                  rows={4}
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  placeholder="Yahan message likhein... (e.g. Sabhi drivers turant office aakar cash jama karwayein! / Bill verify karein)"
                  className="w-full bg-background border border-border rounded-2xl p-3 text-base font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-red-500 resize-none shadow-inner"
                  required
                />
              </div>

              {/* Quick Template Chips */}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {[
                  'Sabhi Drivers collection cash turant jama karein!',
                  'Gadi loading complete ho gayi hai!',
                  'Naya bill check karein aur verify karein.',
                  'Emergency notice: Office me contact karein.',
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

              {/* Live Preview Box: 30px BOLD RED FONT */}
              {messageText.trim() && (
                <div className="mt-4 p-4 rounded-2xl border-2 border-red-500/40 bg-red-500/5 space-y-2">
                  <div className="flex items-center justify-between text-[11px] font-black uppercase tracking-wider text-red-600">
                    <span>Live Preview (30px Bold Red Font)</span>
                    <span>Target: {effectiveTarget === 'ALL' ? 'All Users' : effectiveTarget}</span>
                  </div>
                  <div
                    style={{ fontSize: '30px', lineHeight: '1.25' }}
                    className="text-[30px] font-black font-extrabold text-red-600 tracking-tight leading-tight text-center break-words select-none"
                  >
                    {messageText}
                  </div>
                </div>
              )}

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={isSending || !messageText.trim()}
                  className="w-full py-3.5 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-black text-base uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-5 h-5" />
                  <span>
                    {isSending
                      ? 'Bheja Jaa Raha Hai...'
                      : `SEND POPUP TO ${effectiveTarget === 'ALL' ? 'ALL DEVICES' : effectiveTarget.toUpperCase()}`}
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
