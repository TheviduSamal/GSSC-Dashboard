import { type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}

export function Modal({ open, onClose, title, subtitle, actions, children, wide }: ModalProps) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 p-4 backdrop-blur-md animate-fade"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className={`glass flex max-h-[94vh] w-full flex-col overflow-hidden rounded-2xl shadow-2xl ${wide ? 'max-w-6xl' : 'max-w-3xl'}`}>
        <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] px-6 py-4">
          <div className="min-w-0">
            <div className="truncate text-base font-semibold text-slate-100">{title}</div>
            {subtitle && <div className="mt-0.5 truncate text-xs text-[var(--muted)]">{subtitle}</div>}
          </div>
          <div className="flex items-center gap-2">
            {actions}
            <button className="btn btn-ghost !p-1.5" onClick={onClose} aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="overflow-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
