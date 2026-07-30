import { useEffect, useRef, type ReactNode, type MouseEvent } from 'react';
import { X } from 'lucide-react';

// ── Types ──
export interface ModalProps {
  /** Whether the modal is visible */
  open: boolean;
  /** Called when the modal should close (backdrop click, close button, Escape key) */
  onClose: () => void;
  /** Modal size */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Optional header icon element */
  icon?: ReactNode;
  /** Icon wrapper color class (e.g. 'bg-rose-50 border-rose-200 text-rose-600') */
  iconColor?: string;
  /** Title text */
  title?: string;
  /** Subtitle text (below title) */
  subtitle?: string;
  /** Body content */
  children?: ReactNode;
  /** Footer content (usually action buttons) */
  footer?: ReactNode;
  /** Whether to show the close (X) button in header */
  showCloseButton?: boolean;
  /** Additional classes for the inner content container */
  className?: string;
}

// ── Size mapping ──
const SIZE_CLASSES: Record<string, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  full: 'max-w-2xl',
};

// ── Component ──
export function Modal({
  open,
  onClose,
  size = 'md',
  icon,
  iconColor = 'bg-primary/10 text-primary',
  title,
  subtitle,
  children,
  footer,
  showCloseButton = true,
  className = '',
}: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // ── Trap focus & handle Escape ──
  useEffect(() => {
    if (!open) return;

    previousActiveElement.current = document.activeElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }

      // Trap focus within modal
      if (e.key === 'Tab' && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusable.length === 0) return;

        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    // Focus the first focusable element
    requestAnimationFrame(() => {
      const focusable = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      focusable?.focus();
    });

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    };
  }, [open, onClose]);

  // ── Prevent body scroll when open ──
  useEffect(() => {
    if (open) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [open]);

  if (!open) return null;

  const handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4 animate-fade-in"
      onClick={handleBackdropClick}
    >
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={title || 'Diálogo'}
        className={`bg-white rounded-3xl shadow-2xl w-full ${SIZE_CLASSES[size] || SIZE_CLASSES.md} overflow-hidden animate-scale-in ${className}`}
        onClick={e => e.stopPropagation()}
      >
        {/* ── Header ── */}
        {(title || icon || showCloseButton) && (
          <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
            {icon && (
              <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconColor}`}>
                {icon}
              </div>
            )}

            {(title || subtitle) && (
              <div className="flex-1 min-w-0">
                {title && (
                  <h3 className="text-base font-bold text-slate-900 truncate">{title}</h3>
                )}
                {subtitle && (
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{subtitle}</p>
                )}
              </div>
            )}

            {showCloseButton && (
              <button
                onClick={onClose}
                className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors shrink-0"
                aria-label="Cerrar"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        {/* ── Body ── */}
        {children && (
          <div className="px-6 py-5">
            {children}
          </div>
        )}

        {/* ── Footer ── */}
        {footer && (
          <div className="px-6 py-4 bg-slate-50/70 border-t border-slate-100 flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
