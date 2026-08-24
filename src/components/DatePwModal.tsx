import { useState, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  systemPassword: string;
};

export default function DatePwModal({ isOpen, onClose, onSuccess, systemPassword }: Props) {
  const [datePwInput, setDatePwInput] = useState('');
  const [datePwError, setDatePwError] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
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

  const handleUnlock = () => {
    if (datePwInput === systemPassword) {
      onSuccess();
      setDatePwInput('');
      setDatePwError(false);
    } else {
      setDatePwError(true);
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-4 px-4 backdrop-blur-sm"
      id="datepw-modal-overlay"
    >
      <div 
        className="bg-card rounded-3xl p-6 w-full max-w-xs shadow-2xl border border-border animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        id="datepw-modal-container"
      >
        <h3 className="font-black text-sm uppercase mb-4 flex items-center gap-2 text-primary" id="datepw-title">
          <Lock className="w-5 h-5 text-primary" id="datepw-lock-icon" /> Change Date
        </h3>
        <input
          id="datepw-password-input"
          type="password" 
          placeholder="ENTER SYSTEM PASSWORD" 
          autoFocus 
          value={datePwInput}
          onChange={e => { setDatePwInput(e.target.value); setDatePwError(false); }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleUnlock();
            }
          }}
          className={cn(
            "w-full h-12 px-4 bg-muted rounded-2xl mb-3 text-xs font-black border-2 outline-none uppercase text-center transition-all", 
            datePwError ? "border-destructive shake" : "border-border"
          )}
        />
        {datePwError && (
          <p className="text-destructive text-[10px] font-black text-center mb-2 uppercase" id="datepw-error-msg">
            Wrong Password
          </p>
        )}
        <div className="flex gap-2 mt-2" id="datepw-actions">
          <Button 
            id="datepw-cancel-btn"
            variant="outline" 
            onClick={onClose} 
            className="flex-1 rounded-2xl font-black uppercase text-[11px] h-12 cursor-pointer"
          >
            Cancel
          </Button>
          <Button 
            id="datepw-unlock-btn"
            onClick={handleUnlock} 
            className="flex-1 rounded-2xl font-black uppercase text-[11px] h-12 cursor-pointer"
          >
            Unlock
          </Button>
        </div>
      </div>
    </div>
  );
}
