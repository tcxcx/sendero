import { cn } from '@sendero/ui/cn';

const tones: Record<string, string> = {
  draft:
    'border-[color:color-mix(in_oklab,var(--ink)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--ink)_7%,white)] text-[color:var(--ink)]',
  searching:
    'border-blue-300/70 bg-blue-50 text-blue-700 dark:border-blue-400/35 dark:bg-blue-400/10 dark:text-blue-200',
  awaiting_approval:
    'border-amber-300/80 bg-amber-50 text-amber-800 dark:border-amber-400/35 dark:bg-amber-400/10 dark:text-amber-200',
  booked:
    'border-emerald-300/80 bg-emerald-50 text-emerald-800 dark:border-emerald-400/35 dark:bg-emerald-400/10 dark:text-emerald-200',
  in_progress:
    'border-cyan-300/80 bg-cyan-50 text-cyan-800 dark:border-cyan-400/35 dark:bg-cyan-400/10 dark:text-cyan-200',
  completed:
    'border-zinc-300/80 bg-zinc-50 text-zinc-700 dark:border-zinc-500/40 dark:bg-zinc-500/10 dark:text-zinc-200',
  canceled:
    'border-rose-300/80 bg-rose-50 text-rose-800 dark:border-rose-400/35 dark:bg-rose-400/10 dark:text-rose-200',
  failed:
    'border-red-300/80 bg-red-50 text-red-800 dark:border-red-400/35 dark:bg-red-400/10 dark:text-red-200',
};

export function TripStatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium capitalize leading-none',
        tones[status] ?? tones.draft
      )}
    >
      {status.replaceAll('_', ' ')}
    </span>
  );
}
