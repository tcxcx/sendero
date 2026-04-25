'use client';

import type { ReactNode } from 'react';
import { PricingTable } from '@clerk/nextjs';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@sendero/ui/dialog';

type PricingTableDialogProps = {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PricingTableDialog({ children, open, onOpenChange }: PricingTableDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            Plans
          </DialogTitle>
          <DialogDescription className="sr-only">
            Choose a plan for your organization. Subscription is managed through Clerk Billing.
          </DialogDescription>
        </DialogHeader>
        <PricingTable for="organization" />
      </DialogContent>
    </Dialog>
  );
}
