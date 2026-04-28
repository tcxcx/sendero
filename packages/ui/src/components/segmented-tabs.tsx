'use client';

/**
 * SegmentedTabs — vermillion-accent tab strip matching the inbox-rail
 * pattern from apps/app/components/console/inbox-rail.tsx. Lifted into
 * @sendero/ui so the marketing app and any future surface can reuse
 * the same polished segmented look.
 *
 * Visual contract:
 *   - inactive trigger: parchment-tinted ink wash (8% mix), ink text
 *   - active trigger:   solid vermillion bg, parchment text
 *   - 4px radius, 1px transition, no underline, no border-stripes
 *
 * Built on top of @sendero/ui/tabs (Radix). Drop-in: same Tabs /
 * TabsList / TabsTrigger / TabsContent surface, just visually tighter.
 *
 * Usage:
 *   <SegmentedTabs value={tab} onValueChange={setTab}>
 *     <SegmentedTabsList>
 *       <SegmentedTabsTrigger value="cli">CLI</SegmentedTabsTrigger>
 *       <SegmentedTabsTrigger value="plugin">Plugin</SegmentedTabsTrigger>
 *     </SegmentedTabsList>
 *     <SegmentedTabsContent value="cli">…</SegmentedTabsContent>
 *   </SegmentedTabs>
 */

import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';

import { cn } from '../utils/cn';

export const SegmentedTabs = TabsPrimitive.Root;

export const SegmentedTabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn('inline-flex h-9 w-full justify-stretch gap-1 bg-transparent p-0', className)}
    {...props}
  />
));
SegmentedTabsList.displayName = 'SegmentedTabsList';

export const SegmentedTabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      // Layout
      'flex-1 h-9 rounded-sm px-3',
      // Type
      'font-mono text-[11px] uppercase tracking-[0.14em]',
      // Inactive: subtle ink wash + ink text
      'bg-[color-mix(in_oklab,var(--ink,#fb542b)_8%,transparent)]',
      'text-[color-mix(in_oklab,var(--fg,#111)_70%,transparent)]',
      // Active: solid vermillion + parchment text
      'data-[state=active]:bg-[var(--ink,#fb542b)]',
      'data-[state=active]:text-[#fdfbf7]',
      // Polish
      'transition-colors duration-150',
      'hover:text-[var(--fg,#111)]',
      'data-[state=active]:hover:text-[#fdfbf7]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#fb542b)] focus-visible:ring-offset-2',
      'disabled:pointer-events-none disabled:opacity-50',
      'cursor-pointer',
      className
    )}
    {...props}
  />
));
SegmentedTabsTrigger.displayName = 'SegmentedTabsTrigger';

export const SegmentedTabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      'mt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ink,#fb542b)]',
      className
    )}
    {...props}
  />
));
SegmentedTabsContent.displayName = 'SegmentedTabsContent';
