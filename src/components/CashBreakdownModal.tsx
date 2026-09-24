import { X, Banknote, User, Car, Crown, IndianRupee } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface PersonCashRecord {
  name: string;
  role: 'driver' | 'user' | 'owner';
  amount: number;
  count: number;
}

export interface CashStatsData {
  totalCash: number;
  billsCount: number;
  driverCash: number;
  userCash: number;
  ownerCash: number;
  driverBillsCount: number;
  userBillsCount: number;
  ownerBillsCount: number;
  personList: PersonCashRecord[];
}

interface CashBreakdownModalProps {
  isOpen: boolean;
  onClose: () => void;
  displayDate: string;
  cashStats: CashStatsData;
}

export default function CashBreakdownModal({
  isOpen,
  onClose,
  displayDate,
  cashStats,
}: CashBreakdownModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/60 z-[280] flex items-start justify-center pt-4 sm:pt-6 p-4 backdrop-blur-xs animate-in fade-in duration-150 overflow-y-auto">
      <div className="bg-card rounded-3xl p-5 w-full max-w-lg shadow-2xl border-2 border-emerald-500/40 animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border mb-3 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-2xl bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 flex items-center justify-center shadow-xs">
              <Banknote className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black uppercase text-foreground tracking-tight flex items-center gap-1.5">
                Total Cash Collection
              </h3>
              <p className="text-[10px] font-bold text-muted-foreground uppercase">
                {displayDate} • Drivers, Users & Owner Combined
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-muted flex items-center justify-center text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Big Total Box */}
        <div className="bg-gradient-to-br from-emerald-500/15 via-emerald-500/5 to-transparent border-2 border-emerald-500/30 rounded-2xl p-4 text-center mb-3 shrink-0 shadow-sm">
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-700 dark:text-emerald-400">
            Current Date Total Cash
          </span>
          <div className="text-3xl sm:text-4xl font-black text-emerald-600 dark:text-emerald-300 mt-0.5 tracking-tight">
            ₹{cashStats.totalCash.toLocaleString('en-IN')}
          </div>
          <div className="text-[10px] font-bold text-muted-foreground uppercase mt-1">
            Across <span className="font-black text-foreground">{cashStats.billsCount}</span> Cash Paid Bills
          </div>
        </div>

        {/* 3 Overview Role Cards */}
        <div className="grid grid-cols-3 gap-2 mb-3 shrink-0">
          {/* Driver Cash */}
          <div className="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700/50 rounded-2xl p-2.5 flex flex-col items-center text-center">
            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-300 text-[9px] font-black uppercase">
              <Car className="w-3 h-3" />
              Drivers
            </div>
            <span className="text-base font-black text-amber-900 dark:text-amber-200 mt-0.5">
              ₹{cashStats.driverCash.toLocaleString('en-IN')}
            </span>
            <span className="text-[8px] font-bold text-amber-700/80 dark:text-amber-400 uppercase mt-0.5">
              {cashStats.driverBillsCount} Bills
            </span>
          </div>

          {/* User / Staff Cash */}
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-300 dark:border-blue-700/50 rounded-2xl p-2.5 flex flex-col items-center text-center">
            <div className="flex items-center gap-1 text-blue-700 dark:text-blue-300 text-[9px] font-black uppercase">
              <User className="w-3 h-3" />
              Users / Staff
            </div>
            <span className="text-base font-black text-blue-900 dark:text-blue-200 mt-0.5">
              ₹{cashStats.userCash.toLocaleString('en-IN')}
            </span>
            <span className="text-[8px] font-bold text-blue-700/80 dark:text-blue-400 uppercase mt-0.5">
              {cashStats.userBillsCount} Bills
            </span>
          </div>

          {/* Owner Cash */}
          <div className="bg-purple-50 dark:bg-purple-950/40 border border-purple-300 dark:border-purple-700/50 rounded-2xl p-2.5 flex flex-col items-center text-center">
            <div className="flex items-center gap-1 text-purple-700 dark:text-purple-300 text-[9px] font-black uppercase">
              <Crown className="w-3 h-3" />
              Owner
            </div>
            <span className="text-base font-black text-purple-900 dark:text-purple-200 mt-0.5">
              ₹{cashStats.ownerCash.toLocaleString('en-IN')}
            </span>
            <span className="text-[8px] font-bold text-purple-700/80 dark:text-purple-400 uppercase mt-0.5">
              {cashStats.ownerBillsCount} Bills
            </span>
          </div>
        </div>

        {/* Detailed Person / Collector List */}
        <div className="flex-1 overflow-y-auto border border-border/60 rounded-2xl bg-muted/20">
          <div className="p-2 bg-muted/40 border-b border-border/60 sticky top-0 z-10 flex items-center justify-between text-[9px] font-black text-muted-foreground uppercase tracking-wider">
            <span>Staff / Driver Name</span>
            <span>Bills & Amount</span>
          </div>

          {cashStats.personList.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-xs font-bold uppercase">
              No cash collections recorded for {displayDate}
            </div>
          ) : (
            <div className="divide-y divide-border/40">
              {cashStats.personList.map(person => {
                const isOwner = person.role === 'owner';
                const isUser = person.role === 'user';
                return (
                  <div
                    key={person.name}
                    className="p-2.5 flex items-center justify-between hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base shrink-0">
                        {isOwner ? '👑' : isUser ? '👤' : '🚗'}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-black uppercase text-foreground truncate">
                          {person.name}
                        </div>
                        <div className="text-[8px] font-bold uppercase text-muted-foreground">
                          {isOwner ? 'Owner' : isUser ? 'User / Staff' : 'Driver'} • {person.count} {person.count === 1 ? 'bill' : 'bills'}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                        ₹{person.amount.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 pt-3 border-t border-border flex items-center justify-between shrink-0">
          <span className="text-[9px] font-bold text-muted-foreground uppercase">
            Auto-calculated from all bills on {displayDate}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="rounded-xl text-[10px] font-black uppercase h-8 px-4"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
