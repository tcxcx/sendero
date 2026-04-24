'use client';

import type { ReactNode } from 'react';
import { useState } from 'react';

import { cn } from '../../utils/cn';

interface BubbleButtonProps {
  action: () => void;
  isActive?: boolean;
  children: ReactNode;
  className?: string;
  tooltip?: string;
  disabled?: boolean;
}

export function BubbleButton({
  action,
  isActive,
  children,
  className,
  tooltip,
  disabled,
}: BubbleButtonProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={e => {
          e.preventDefault();
          e.stopPropagation();
          action();
        }}
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        className={cn(
          'px-2.5 py-1.5 text-[11px] font-mono uppercase tracking-[0.08em] transition-colors',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isActive
            ? 'bg-[color:var(--ink)] text-[color:var(--bg-elev)]'
            : 'bg-transparent text-[color:var(--text)] hover:bg-[color:var(--bg-sunk)] hover:text-[color:var(--ink)]',
          className
        )}
        title={tooltip}
      >
        {children}
      </button>
      {tooltip && show ? (
        <div
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 -translate-x-1/2 whitespace-nowrap bg-[color:var(--text)] px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.12em] text-[color:var(--bg-elev)]"
          role="tooltip"
        >
          {tooltip}
        </div>
      ) : null}
    </div>
  );
}
