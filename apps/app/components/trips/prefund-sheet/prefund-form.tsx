'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@sendero/ui/button';
import { Checkbox } from '@sendero/ui/checkbox';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@sendero/ui/form';
import { Input } from '@sendero/ui/input';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

export const prefundFormSchema = z.object({
  budgetUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Use a decimal USDC amount, e.g. 500.00'),
  guestEmail: z.string().email(),
  guestName: z.string().max(80).optional(),
  tripSummary: z.string().max(200).optional(),
  expiresInDays: z.coerce.number().int().min(1).max(365).default(30),
  require2fa: z.boolean().default(true),
});

type FormValues = z.infer<typeof prefundFormSchema>;

export type PrefundResult = {
  tripId: string;
  guestLink: string;
  claimCode?: string | null;
  onchainCalls: unknown;
  invite?: { ok?: boolean; skipped?: boolean; error?: string };
};

export function PrefundForm({ onSuccess }: { onSuccess: (result: PrefundResult) => void }) {
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(prefundFormSchema),
    defaultValues: { budgetUsdc: '', guestEmail: '', expiresInDays: 30, require2fa: true },
  });

  async function onSubmit(values: FormValues) {
    setError(null);
    const response = await fetch('/api/guest/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(values),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(String(data.message ?? data.error ?? response.statusText));
      return;
    }
    onSuccess(data as PrefundResult);
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4 py-4">
        <FormField
          control={form.control}
          name="budgetUsdc"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Budget (USDC)</FormLabel>
              <FormControl>
                <Input type="text" inputMode="decimal" placeholder="500.00" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="guestEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Traveler email</FormLabel>
              <FormControl>
                <Input type="email" placeholder="traveler@example.com" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="guestName"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Traveler name</FormLabel>
              <FormControl>
                <Input placeholder="Optional" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="tripSummary"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Trip summary</FormLabel>
              <FormControl>
                <Input placeholder="SFO to LHR, May 3-10" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="expiresInDays"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Expires in days</FormLabel>
              <FormControl>
                <Input type="number" min={1} max={365} {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="require2fa"
          render={({ field }) => (
            <FormItem className="flex-row items-center gap-3">
              <FormControl>
                <Checkbox
                  checked={field.value}
                  onCheckedChange={value => field.onChange(Boolean(value))}
                />
              </FormControl>
              <FormLabel>Require 6-digit claim code</FormLabel>
            </FormItem>
          )}
        />
        {error ? (
          <p className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>
        ) : null}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {form.formState.isSubmitting ? 'Creating...' : 'Create claim link'}
        </Button>
      </form>
    </Form>
  );
}
