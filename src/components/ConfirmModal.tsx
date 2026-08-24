import React from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, CheckCircle, Info, X, Loader2 } from 'lucide-react';

export interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message?: string;
  details?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'primary' | 'success';
  loading?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  message,
  details,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'warning',
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  if (!isOpen) return null;

  return (
    <div
      id="confirm-modal-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={onCancel}
    >
      <div
        id="confirm-modal-card"
        className="w-full max-w-md bg-card rounded-2xl p-5 shadow-2xl border border-border animate-in zoom-in-95 duration-150 space-y-4 text-card-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl ${
              variant === 'danger' ? 'bg-destructive/10 text-destructive' :
              variant === 'warning' ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400' :
              variant === 'success' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' :
              'bg-primary/10 text-primary'
            }`}>
              {variant === 'danger' || variant === 'warning' ? (
                <AlertTriangle className="w-5 h-5" />
              ) : variant === 'success' ? (
                <CheckCircle className="w-5 h-5" />
              ) : (
                <Info className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-black text-sm uppercase tracking-wide">{title}</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="text-muted-foreground hover:text-foreground p-1 rounded-lg hover:bg-muted transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {message && (
          <p className="text-xs font-semibold text-muted-foreground whitespace-pre-line leading-relaxed">
            {message}
          </p>
        )}

        {details && (
          <div className="p-3 bg-muted/60 rounded-xl border border-border/60 text-xs font-medium space-y-1">
            {details}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            disabled={loading}
            className="h-9 px-4 rounded-xl font-black uppercase text-[10px] tracking-wider"
          >
            {cancelText}
          </Button>
          <Button
            type="button"
            variant={variant === 'danger' ? 'destructive' : 'default'}
            onClick={onConfirm}
            disabled={loading}
            className={`h-9 px-5 rounded-xl font-black uppercase text-[10px] tracking-wider ${
              variant === 'warning' ? 'bg-amber-600 hover:bg-amber-700 text-white border-0' :
              variant === 'success' ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-0' : ''
            }`}
          >
            {loading ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Processing...
              </span>
            ) : (
              confirmText
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
