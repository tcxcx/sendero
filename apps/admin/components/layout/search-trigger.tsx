'use client';

import { Search } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function SearchTrigger() {
  return (
    <Button
      variant="outline"
      className="hidden h-9 w-48 justify-start rounded-lg bg-[color:var(--color-background)] text-sm font-normal text-[color:var(--color-muted-foreground)] shadow-none md:flex lg:w-72"
      onClick={() => window.dispatchEvent(new Event('sendero:admin-command-palette'))}
    >
      <Search className="mr-2 h-4 w-4" />
      Search...
      <kbd className="ml-auto rounded border bg-[color:var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px]">
        ⌘ K
      </kbd>
    </Button>
  );
}
