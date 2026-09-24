import { useState, useEffect } from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

type Props = {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (date: string) => void;
  initialDate: string;
};

export default function DatePickerModal({ isOpen, onClose, onConfirm, initialDate }: Props) {
  const [pendingDate, setPendingDate] = useState(initialDate);

  useEffect(() => {
    if (isOpen) {
      setPendingDate(initialDate || new Date().toISOString().split('T')[0]);
    }
  }, [isOpen, initialDate]);

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

  const handleConfirm = () => {
    const finalDate = pendingDate || initialDate || new Date().toISOString().split('T')[0];
    onConfirm(finalDate);
  };

  return (
    <div 
      className="fixed inset-0 bg-black/60 z-[200] flex items-start justify-center pt-4 px-4 backdrop-blur-sm"
      id="datepicker-modal-overlay"
      onClick={onClose}
    >
      <div 
        className="bg-card rounded-3xl p-6 w-full max-w-xs shadow-2xl border border-border text-center animate-in zoom-in-95 duration-150"
        onClick={e => e.stopPropagation()}
        id="datepicker-modal-container"
      >
        <h3 className="font-black text-sm uppercase mb-4 flex items-center justify-center gap-2 text-primary" id="datepicker-title">
          <Calendar className="w-5 h-5 text-primary" id="datepicker-calendar-icon" /> Select Date
        </h3>
        <input
          id="datepicker-date-input"
          type="date" 
          autoFocus 
          value={pendingDate}
          onChange={e => setPendingDate(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleConfirm();
            }
          }}
          className="w-full h-12 px-4 bg-muted rounded-2xl text-sm font-black border-2 border-border focus:border-primary outline-none mb-4 text-center cursor-pointer"
        />
        <div className="flex gap-2" id="datepicker-actions">
          <Button 
            id="datepicker-cancel-btn"
            variant="outline" 
            onClick={onClose} 
            className="flex-1 rounded-2xl font-black uppercase text-[11px] h-12 cursor-pointer"
          >
            Cancel
          </Button>
          <Button 
            id="datepicker-confirm-btn"
            onClick={handleConfirm} 
            className="flex-1 rounded-2xl font-black uppercase text-[11px] h-12 cursor-pointer"
          >
            Confirm
          </Button>
        </div>
      </div>
    </div>
  );
}
