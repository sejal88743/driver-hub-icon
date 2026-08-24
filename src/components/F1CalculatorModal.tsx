import { useState, useEffect, useRef } from 'react';
import { X, Calculator, Copy, Check, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  isOpen: boolean;
  onClose: () => void;
};

export default function F1CalculatorModal({ isOpen, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<'rate' | 'standard'>('rate');

  // ── Rate & Line Cut Calculator State ──
  const [totalPrice, setTotalPrice] = useState('');
  const [totalPcs, setTotalPcs] = useState('');
  const [returnPcs, setReturnPcs] = useState('');
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // ── Standard Calculator State ──
  const [calcDisplay, setCalcDisplay] = useState('0');
  const [prevVal, setPrevVal] = useState<number | null>(null);
  const [op, setOp] = useState<string | null>(null);
  const [waitingForOperand, setWaitingForOperand] = useState(false);

  const priceInputRef = useRef<HTMLInputElement>(null);
  const pcsInputRef = useRef<HTMLInputElement>(null);
  const returnInputRef = useRef<HTMLInputElement>(null);

  // Focus on open
  useEffect(() => {
    if (isOpen) {
      setCopiedField(null);
      setTimeout(() => priceInputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Standard calculator operations
  const inputDigit = (digit: string) => {
    if (waitingForOperand) {
      setCalcDisplay(digit);
      setWaitingForOperand(false);
    } else {
      setCalcDisplay(calcDisplay === '0' ? digit : calcDisplay + digit);
    }
  };

  const inputDot = () => {
    if (waitingForOperand) {
      setCalcDisplay('0.');
      setWaitingForOperand(false);
    } else if (!calcDisplay.includes('.')) {
      setCalcDisplay(calcDisplay + '.');
    }
  };

  const clearCalc = () => {
    setCalcDisplay('0');
    setPrevVal(null);
    setOp(null);
    setWaitingForOperand(false);
  };

  const performOp = (nextOp: string) => {
    const inputVal = parseFloat(calcDisplay);
    if (prevVal === null) {
      setPrevVal(inputVal);
    } else if (op) {
      const currentVal = prevVal || 0;
      let computed = currentVal;
      if (op === '+') computed = currentVal + inputVal;
      else if (op === '-') computed = currentVal - inputVal;
      else if (op === '*') computed = currentVal * inputVal;
      else if (op === '/') computed = inputVal !== 0 ? currentVal / inputVal : 0;
      setCalcDisplay(String(Math.round(computed * 1000) / 1000));
      setPrevVal(computed);
    }
    setWaitingForOperand(true);
    setOp(nextOp === '=' ? null : nextOp);
  };

  // Global keydown inside modal for standard calculator & escape
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (activeTab === 'standard') {
        if (/^[0-9]$/.test(e.key)) {
          inputDigit(e.key);
        } else if (e.key === '.') {
          inputDot();
        } else if (['+', '-', '*', '/'].includes(e.key)) {
          performOp(e.key);
        } else if (e.key === 'Enter' || e.key === '=') {
          performOp('=');
        } else if (e.key === 'Backspace') {
          setCalcDisplay(prev => (prev.length > 1 ? prev.slice(0, -1) : '0'));
        } else if (e.key.toLowerCase() === 'c') {
          clearCalc();
        }
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, activeTab, calcDisplay, prevVal, op, waitingForOperand]);

  if (!isOpen) return null;

  // ── Rate & Line Cut Calculations ──
  const nTotalPrice = Number(totalPrice) || 0;
  const nTotalPcs = Number(totalPcs) || 0;
  const onePcRate = nTotalPcs > 0 ? nTotalPrice / nTotalPcs : 0;

  const nReturnPcs = Number(returnPcs) || 0;
  const lineCutAmt = nReturnPcs > 0 ? onePcRate * nReturnPcs : 0;
  const netCollectAmt = Math.max(0, nTotalPrice - lineCutAmt);

  const copyToClipboard = (val: number | string, field: string) => {
    const rounded = typeof val === 'number' ? Math.round(val * 100) / 100 : val;
    navigator.clipboard.writeText(String(rounded));
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleReset = () => {
    setTotalPrice('');
    setTotalPcs('');
    setReturnPcs('');
    setCopiedField(null);
    priceInputRef.current?.focus();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 z-[400] flex items-center justify-center p-3 sm:p-4 backdrop-blur-sm animate-in fade-in-50 duration-150"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="bg-card border border-border rounded-3xl w-full max-w-md shadow-2xl p-4 sm:p-5 relative animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border/40">
          <div className="flex items-center gap-2 text-primary">
            <Calculator className="w-5 h-5 stroke-[2.5]" />
            <h3 className="font-black text-sm uppercase tracking-wider">Rate & Line Cut Calculator (F2)</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-muted text-muted-foreground transition-colors cursor-pointer"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab switcher */}
        <div className="grid grid-cols-2 gap-1.5 p-1 bg-muted/60 rounded-xl my-3">
          <button
            type="button"
            onClick={() => setActiveTab('rate')}
            className={cn(
              "py-1.5 text-xs font-black uppercase rounded-lg transition-all",
              activeTab === 'rate'
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Rate & Line Cut
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('standard')}
            className={cn(
              "py-1.5 text-xs font-black uppercase rounded-lg transition-all",
              activeTab === 'standard'
                ? "bg-card text-primary shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            Standard Math (+ - × ÷)
          </button>
        </div>

        {activeTab === 'rate' ? (
          <div className="space-y-3">
            {/* Input Row: Total Price & Total Pcs */}
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="text-[10px] font-black uppercase text-muted-foreground block mb-1">
                  Total Price (₹)
                </label>
                <input
                  ref={priceInputRef}
                  type="number"
                  inputMode="decimal"
                  placeholder="e.g. 1500"
                  value={totalPrice}
                  onChange={e => setTotalPrice(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') pcsInputRef.current?.focus();
                  }}
                  className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/60 text-sm font-black text-foreground focus:border-primary focus:bg-background outline-none transition-colors"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase text-muted-foreground block mb-1">
                  Total Pcs (Quantity)
                </label>
                <input
                  ref={pcsInputRef}
                  type="number"
                  inputMode="numeric"
                  placeholder="e.g. 24"
                  value={totalPcs}
                  onChange={e => setTotalPcs(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') returnInputRef.current?.focus();
                  }}
                  className="w-full h-10 px-3 rounded-xl bg-muted/50 border border-border/60 text-sm font-black text-foreground focus:border-primary focus:bg-background outline-none transition-colors"
                />
              </div>
            </div>

            {/* 1 Pc Rate Display Banner */}
            <div className="bg-primary/10 border border-primary/20 rounded-2xl p-2.5 flex items-center justify-between">
              <div>
                <span className="text-[9px] font-black uppercase text-muted-foreground block">
                  1 Pc Rate (Total Price ÷ Total Pcs)
                </span>
                <span className="text-base font-black text-primary">
                  ₹{onePcRate > 0 ? onePcRate.toFixed(2) : '0.00'}
                </span>
              </div>
              {onePcRate > 0 && (
                <button
                  type="button"
                  onClick={() => copyToClipboard(onePcRate.toFixed(2), 'rate')}
                  className="px-2.5 py-1 rounded-lg bg-card text-primary text-[10px] font-black uppercase border border-primary/20 hover:bg-primary hover:text-white transition-all flex items-center gap-1"
                >
                  {copiedField === 'rate' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedField === 'rate' ? 'Copied' : 'Copy Rate'}
                </button>
              )}
            </div>

            {/* Return Pcs Input */}
            <div>
              <label className="text-[10px] font-black uppercase text-muted-foreground block mb-1">
                Return Pcs (Cut Quantity)
              </label>
              <input
                ref={returnInputRef}
                type="number"
                inputMode="numeric"
                placeholder="e.g. 2"
                value={returnPcs}
                onChange={e => setReturnPcs(e.target.value)}
                className="w-full h-10 px-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-sm font-black text-amber-900 dark:text-amber-200 focus:border-amber-500 focus:bg-amber-500/15 outline-none transition-colors"
              />
            </div>

            {/* Results Card: Line Cut Amt & Net To Collect */}
            <div className="bg-card rounded-2xl p-3 border border-border shadow-xs space-y-2">
              <div className="flex items-center justify-between text-xs font-black">
                <span className="text-muted-foreground uppercase">Line Cut Amt (Return × Rate):</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-destructive font-black text-sm">₹{lineCutAmt.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(lineCutAmt.toFixed(2), 'linecut')}
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                    title="Copy Line Cut Amount"
                  >
                    {copiedField === 'linecut' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between text-xs font-black border-t border-border/40 pt-2">
                <span className="text-emerald-700 dark:text-emerald-400 uppercase">Net To Collect:</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-700 dark:text-emerald-400 font-black text-sm">₹{netCollectAmt.toFixed(2)}</span>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(netCollectAmt.toFixed(2), 'net')}
                    className="p-1 rounded hover:bg-muted text-muted-foreground"
                    title="Copy Net Amount"
                  >
                    {copiedField === 'net' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <Button
                variant="outline"
                onClick={handleReset}
                className="flex-1 h-9 rounded-xl font-black text-xs uppercase"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Clear
              </Button>
              <Button
                onClick={() => copyToClipboard(lineCutAmt > 0 ? lineCutAmt.toFixed(2) : nTotalPrice.toFixed(2), 'main')}
                className="flex-[1.5] h-9 rounded-xl font-black text-xs uppercase bg-primary text-white hover:bg-primary/90"
              >
                {copiedField === 'main' ? (
                  <><Check className="w-4 h-4 mr-1 stroke-[3]" /> Copied!</>
                ) : (
                  <><Copy className="w-3.5 h-3.5 mr-1" /> Copy {lineCutAmt > 0 ? `Cut (₹${lineCutAmt.toFixed(0)})` : `Price (₹${nTotalPrice.toFixed(0)})`}</>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* Standard Calculator Keypad */
          <div className="space-y-3">
            {/* Display screen */}
            <div className="bg-muted/60 border border-border/60 rounded-2xl p-3 text-right">
              <div className="text-[10px] font-bold text-muted-foreground h-4">
                {prevVal !== null ? `${prevVal} ${op || ''}` : ''}
              </div>
              <div className="text-2xl font-black tracking-wider text-foreground truncate">
                {calcDisplay}
              </div>
            </div>

            {/* Keypad Grid */}
            <div className="grid grid-cols-4 gap-2">
              <button
                type="button"
                onClick={clearCalc}
                className="h-10 rounded-xl bg-destructive/10 text-destructive font-black text-xs uppercase hover:bg-destructive/20 transition-all"
              >
                C
              </button>
              <button
                type="button"
                onClick={() => setCalcDisplay(prev => (prev.length > 1 ? prev.slice(0, -1) : '0'))}
                className="h-10 rounded-xl bg-muted text-foreground font-black text-xs hover:bg-muted/80 transition-all"
              >
                ⌫
              </button>
              <button
                type="button"
                onClick={() => performOp('/')}
                className={cn("h-10 rounded-xl font-black text-sm transition-all", op === '/' ? "bg-primary text-white" : "bg-primary/10 text-primary hover:bg-primary/20")}
              >
                ÷
              </button>
              <button
                type="button"
                onClick={() => performOp('*')}
                className={cn("h-10 rounded-xl font-black text-sm transition-all", op === '*' ? "bg-primary text-white" : "bg-primary/10 text-primary hover:bg-primary/20")}
              >
                ×
              </button>

              {['7', '8', '9'].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => inputDigit(d)}
                  className="h-10 rounded-xl bg-muted/50 border border-border/40 text-foreground font-black text-sm hover:bg-muted transition-all"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => performOp('-')}
                className={cn("h-10 rounded-xl font-black text-sm transition-all", op === '-' ? "bg-primary text-white" : "bg-primary/10 text-primary hover:bg-primary/20")}
              >
                −
              </button>

              {['4', '5', '6'].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => inputDigit(d)}
                  className="h-10 rounded-xl bg-muted/50 border border-border/40 text-foreground font-black text-sm hover:bg-muted transition-all"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => performOp('+')}
                className={cn("h-10 rounded-xl font-black text-sm transition-all", op === '+' ? "bg-primary text-white" : "bg-primary/10 text-primary hover:bg-primary/20")}
              >
                +
              </button>

              {['1', '2', '3'].map(d => (
                <button
                  key={d}
                  type="button"
                  onClick={() => inputDigit(d)}
                  className="h-10 rounded-xl bg-muted/50 border border-border/40 text-foreground font-black text-sm hover:bg-muted transition-all"
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                onClick={() => performOp('=')}
                className="h-22 row-span-2 rounded-xl bg-primary text-white font-black text-lg hover:bg-primary/90 transition-all shadow-md flex items-center justify-center"
              >
                =
              </button>

              <button
                type="button"
                onClick={() => inputDigit('0')}
                className="col-span-2 h-10 rounded-xl bg-muted/50 border border-border/40 text-foreground font-black text-sm hover:bg-muted transition-all"
              >
                0
              </button>
              <button
                type="button"
                onClick={inputDot}
                className="h-10 rounded-xl bg-muted/50 border border-border/40 text-foreground font-black text-sm hover:bg-muted transition-all"
              >
                .
              </button>
            </div>

            {/* Quick copy result */}
            <div className="flex gap-2 pt-1">
              <Button
                onClick={() => copyToClipboard(calcDisplay, 'calc')}
                className="w-full h-9 rounded-xl font-black text-xs uppercase bg-primary text-white"
              >
                {copiedField === 'calc' ? (
                  <><Check className="w-4 h-4 mr-1 stroke-[3]" /> Result Copied!</>
                ) : (
                  <><Copy className="w-3.5 h-3.5 mr-1" /> Copy Result (₹{calcDisplay})</>
                )}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

