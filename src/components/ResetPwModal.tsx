import { useState, useEffect } from 'react';
import { RotateCcw, Lock, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getOwnerPassword } from '@/lib/billStore';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  billNo?: string;
};

export default function ResetPwModal({ isOpen, onClose, onSuccess, billNo }: Props) {
  const [passwordInput, setPasswordInput] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setPasswordInput('');
      setError(false);
      return;
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '+' || e.code === 'NumpadAdd') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleConfirmReset = () => {
    const ownerPw = (getOwnerPassword() || '').trim();
    if (passwordInput.trim().toUpperCase() === ownerPw.toUpperCase()) {
      onSuccess();
      setPasswordInput('');
      setError(false);
      onClose();
    } else {
      setError(true);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-[250] flex items-start justify-center pt-6 px-4 backdrop-blur-sm"
      id="resetpw-modal-overlay"
    >
      <div 
        className="bg-card rounded-3xl p-6 w-full max-w-sm shadow-2xl border-2 border-destructive/30 animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        id="resetpw-modal-container"
      >
        <div className="flex items-center gap-2 mb-2 text-destructive" id="resetpw-header">
          <RotateCcw className="w-5 h-5 text-destructive" id="resetpw-icon" />
          <h3 className="font-black text-sm uppercase tracking-wide" id="resetpw-title">
            Reset Confirmation
          </h3>
        </div>

        {billNo && (
          <p className="text-[11px] font-black text-primary uppercase mb-1">
            BILL: {billNo}
          </p>
        )}

        <div className="bg-destructive/10 rounded-xl p-2.5 mb-3 flex items-start gap-2 border border-destructive/20">
          <AlertTriangle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
          <p className="text-[10px] font-bold text-foreground leading-tight">
            Reset karne ke liye Owner Password enter karein. Bill ka payment record clear ho jayega.
          </p>
        </div>

        <div className="relative mb-3">
          <Lock className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            id="resetpw-password-input"
            type="password" 
            placeholder="ENTER OWNER PASSWORD" 
            autoFocus 
            value={passwordInput}
            onChange={e => { setPasswordInput(e.target.value); setError(false); }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleConfirmReset();
              }
            }}
            className={cn(
              "w-full h-11 pl-9 pr-3 bg-muted rounded-xl text-xs font-black border-2 outline-none uppercase text-center transition-all", 
              error ? "border-destructive shake" : "border-border focus:border-destructive/60"
            )}
          />
        </div>

        {error && (
          <p className="text-destructive text-[10px] font-black text-center mb-2 uppercase" id="resetpw-error-msg">
            Wrong Owner Password
          </p>
        )}

        <div className="flex gap-2 mt-2" id="resetpw-actions">
          <Button 
            id="resetpw-cancel-btn"
            variant="outline" 
            onClick={onClose} 
            className="flex-1 rounded-xl font-black uppercase text-[11px] h-10 cursor-pointer"
          >
            Cancel
          </Button>
          <Button 
            id="resetpw-submit-btn"
            onClick={handleConfirmReset} 
            className="flex-1 rounded-xl font-black uppercase text-[11px] h-10 bg-destructive hover:bg-destructive/90 text-white cursor-pointer"
          >
            Reset
          </Button>
        </div>
      </div>
    </div>
  );
}
