'use client';

import { Check, Moon, Palette, Sun } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { useTheme } from '@/components/theme-provider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/** Header theme menu: light/dark mode plus the active platform theme. */
export function ThemeModeToggle() {
  const { platformTheme, resolvedTheme, setPlatformTheme, setTheme } = useTheme();
  const nextMode = resolvedTheme === 'dark' ? 'light' : 'dark';

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="secondary"
        size="icon"
        className="h-9 w-9"
        aria-label="Toggle color mode"
        onClick={() => setTheme(nextMode)}
      >
        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-9 gap-2 rounded-lg bg-[color:var(--color-background)] shadow-none"
          >
            <Palette className="h-4 w-4 text-[color:var(--color-muted-foreground)]" />
            <span className="hidden min-w-14 text-left capitalize sm:inline">
              {platformTheme === 'sendero' ? 'Sendero' : 'Zen'}
            </span>
            <kbd className="rounded border bg-[color:var(--color-muted)] px-1.5 py-0.5 font-mono text-[10px] text-[color:var(--color-muted-foreground)]">
              T T
            </kbd>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setPlatformTheme('sendero')}>
            <Check
              className={platformTheme === 'sendero' ? 'h-4 w-4 opacity-100' : 'h-4 w-4 opacity-0'}
            />
            Sendero
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setPlatformTheme('zen')}>
            <Check
              className={platformTheme === 'zen' ? 'h-4 w-4 opacity-100' : 'h-4 w-4 opacity-0'}
            />
            Zen
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Mode</DropdownMenuLabel>
          <DropdownMenuItem onClick={() => setTheme('system')}>System preference</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
