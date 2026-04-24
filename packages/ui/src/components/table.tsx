import * as React from 'react';

import { cn } from '@sendero/ui/cn';

// Sendero table line-work: ink-tinted hairlines for borders + dim-ink
// alternating row backgrounds. Header sits on `--tint-midnight-soft`
// so it reads as the "raised" stratum; rows use a vermilion-soft
// zebra to keep the gaze moving down the column. Hover lifts to the
// medium vermilion tint. Mirrors DESIGN.md §13 + §15.
const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative w-full overflow-auto rounded-[var(--radius-md)] border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)]">
      <table
        ref={ref}
        className={cn('w-full caption-bottom text-sm border-separate border-spacing-0', className)}
        {...props}
      />
    </div>
  )
);
Table.displayName = 'Table';

const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <thead
    ref={ref}
    className={cn(
      'bg-[color:var(--tint-midnight-soft)] [&_tr]:border-b [&_tr]:border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)]',
      className
    )}
    {...props}
  />
));
TableHeader.displayName = 'TableHeader';

const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      // Zebra in vermilion-soft on every other row + remove the bottom
      // border on the final row so the wrapper border is the only edge.
      '[&_tr:nth-child(even)]:bg-[color:var(--tint-vermillion-soft)] [&_tr:last-child_td]:border-b-0',
      className
    )}
    {...props}
  />
));
TableBody.displayName = 'TableBody';

const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      'border-t border-[color:color-mix(in_oklab,var(--ink)_22%,transparent)] bg-[color:var(--tint-midnight-soft)] font-medium [&>tr]:last:border-b-0',
      className
    )}
    {...props}
  />
));
TableFooter.displayName = 'TableFooter';

const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      className={cn(
        'transition-colors hover:bg-[color:var(--tint-vermillion-medium)] data-[state=selected]:bg-[color:var(--tint-vermillion-medium)]',
        className
      )}
      {...props}
    />
  )
);
TableRow.displayName = 'TableRow';

const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <th
    ref={ref}
    className={cn(
      'h-11 px-4 text-left align-middle font-mono text-[10px] uppercase tracking-[0.12em] font-medium text-[color:var(--text-dim)] [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableHead.displayName = 'TableHead';

const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...props }, ref) => (
  <td
    ref={ref}
    className={cn(
      'px-4 py-3 align-middle border-b border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] [&:has([role=checkbox])]:pr-0',
      className
    )}
    {...props}
  />
));
TableCell.displayName = 'TableCell';

const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...props }, ref) => (
  <caption ref={ref} className={cn('mt-4 text-sm text-muted-foreground', className)} {...props} />
));
TableCaption.displayName = 'TableCaption';

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
