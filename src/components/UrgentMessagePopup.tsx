import React, { useState, useEffect } from 'react';
import { AlertTriangle, X, BellRing, User, Clock } from 'lucide-react';
import {
  subscribeUrgentMessages,
  getCurrentUserActivePopup,
  dismissUrgentMessage,
  UrgentMessage,
} from '@/lib/urgentMessageStore';

export function UrgentMessagePopup() {
  const [activeMessage, setActiveMessage] = useState<UrgentMessage | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  useEffect(() => {
    // Initial check
    setActiveMessage(getCurrentUserActivePopup());

    // Subscribe to store updates (SSE & polling events)
    const unsubscribe = subscribeUrgentMessages(() => {
      const current = getCurrentUserActivePopup();
      setActiveMessage(current);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  if (!activeMessage) return null;

  async function handleClose() {
    if (!activeMessage || isClosing) return;
    setIsClosing(true);
    try {
      await dismissUrgentMessage(activeMessage.id);
    } finally {
      setIsClosing(false);
      setActiveMessage(null);
    }
  }

  const timeFormatted = (() => {
    try {
      const d = new Date(activeMessage.createdAt);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  })();

  return (
    <div
      className="fixed inset-0 z-[999999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200 select-none"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-xl bg-card border-4 border-red-600 rounded-3xl shadow-[0_0_50px_rgba(220,38,38,0.45)] overflow-hidden flex flex-col p-6 sm:p-8 animate-in zoom-in-95 duration-200">
        
        {/* Top Header Badge */}
        <div className="flex items-center justify-between w-full border-b border-red-200 dark:border-red-950 pb-4">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-4 w-4 bg-red-600"></span>
            </span>
            <div className="flex items-center gap-1.5 bg-red-600/10 text-red-600 px-3 py-1 rounded-full border border-red-600/30">
              <BellRing className="w-4 h-4 animate-bounce shrink-0" />
              <span className="text-xs sm:text-sm font-black uppercase tracking-wider">
                URGENT MESSAGE / ज़रूरी संदेश
              </span>
            </div>
          </div>

          <button
            onClick={handleClose}
            disabled={isClosing}
            className="w-10 h-10 rounded-full bg-muted/80 hover:bg-red-600 hover:text-white flex items-center justify-center text-muted-foreground transition-all duration-150 cursor-pointer shadow-xs active:scale-95"
            title="Band Kare / Close"
          >
            <X className="w-6 h-6 stroke-[3]" />
          </button>
        </div>

        {/* Sender & Target Metadata */}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-4 text-xs font-bold text-muted-foreground bg-muted/40 px-3 py-2 rounded-xl">
          <div className="flex items-center gap-1.5">
            <User className="w-3.5 h-3.5 text-primary" />
            <span>From: <strong className="text-foreground">{activeMessage.senderName}</strong></span>
            {activeMessage.targetUser && (
              <span className="ml-1 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] uppercase font-black">
                To: {activeMessage.targetUser === 'ALL' ? 'ALL USERS' : activeMessage.targetUser}
              </span>
            )}
          </div>
          {timeFormatted && (
            <div className="flex items-center gap-1 text-[11px]">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              <span>{timeFormatted}</span>
            </div>
          )}
        </div>

        {/* Core Message Display: STRICT REQUIREMENT 30px, BOLD, RED FONT */}
        <div className="my-6 px-2 py-4 bg-red-500/5 rounded-2xl border-2 border-red-500/20 text-center flex items-center justify-center min-h-[140px]">
          <div
            style={{ fontSize: '30px', lineHeight: '1.25' }}
            className="text-[30px] font-black font-extrabold text-red-600 tracking-tight leading-tight select-text break-words w-full"
          >
            {activeMessage.text}
          </div>
        </div>

        {/* Action Button: BAND KARE */}
        <div className="w-full pt-2 flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleClose}
            disabled={isClosing}
            className="w-full py-4 px-6 rounded-2xl bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white font-black text-lg uppercase tracking-wider flex items-center justify-center gap-2 shadow-lg shadow-red-600/30 transition-all cursor-pointer"
          >
            <X className="w-6 h-6 stroke-[3]" />
            <span>BAND KARE / CLOSE</span>
          </button>
        </div>

        {/* Note indicating sender can also close it */}
        <p className="text-[11px] text-center font-medium text-muted-foreground mt-3">
          Yeh sandesh screen par show ho raha hai. Aap close kar sakte hain, ya sender ke band karne par bhi gayab ho jayega.
        </p>

      </div>
    </div>
  );
}
export default UrgentMessagePopup;
