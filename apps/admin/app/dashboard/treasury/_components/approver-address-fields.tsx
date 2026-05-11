'use client';

import * as React from 'react';

import { Plus, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';

type AddressKind = 'evm' | 'solana';

interface Props {
  kind: AddressKind;
  name: string;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
}

function validateAddress(kind: AddressKind, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return 'Address required';
  if (kind === 'evm') {
    return /^0x[a-fA-F0-9]{40}$/.test(trimmed) ? null : 'Use a 0x address with 40 hex characters';
  }
  return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed) ? null : 'Use a valid Solana base58 address';
}

export function ApproverAddressFields({ kind, name, disabled, onValidityChange }: Props) {
  const [addresses, setAddresses] = React.useState<string[]>(['']);
  const errors = addresses.map(address => validateAddress(kind, address));
  const valid = errors.every(error => error === null);

  React.useEffect(() => {
    onValidityChange?.(valid);
  }, [onValidityChange, valid]);

  function update(index: number, value: string) {
    setAddresses(current => current.map((address, i) => (i === index ? value : address)));
  }

  function add() {
    setAddresses(current => [...current, '']);
  }

  function remove(index: number) {
    setAddresses(current => {
      const next = current.filter((_, i) => i !== index);
      return next.length > 0 ? next : [''];
    });
  }

  return (
    <div className="space-y-2">
      <div className="flex items-end justify-between gap-3">
        <div>
          <label htmlFor={`${name}-0`} className="block text-sm font-medium">
            Approvers
          </label>
          <p className="text-xs text-[color:var(--color-muted-foreground)]">
            {kind === 'evm' ? 'Arc 0x wallet addresses.' : 'Solana base58 wallet addresses.'}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={add} disabled={disabled}>
          <Plus className="h-3.5 w-3.5" />
          Add
        </Button>
      </div>

      <div className="space-y-2">
        {addresses.map((address, index) => {
          const error = errors[index];
          const showError = Boolean(address.trim() && error);
          const inputId = `${name}-${index}`;
          return (
            <div key={inputId} className="space-y-1">
              <div className="flex gap-2">
                <input
                  id={inputId}
                  name={name}
                  value={address}
                  required
                  disabled={disabled}
                  aria-invalid={showError}
                  onChange={event => update(index, event.target.value)}
                  placeholder={kind === 'evm' ? '0x...' : 'Base58 address'}
                  className="h-9 min-w-0 flex-1 rounded-md border bg-[color:var(--color-background)] px-3 font-mono text-xs outline-none transition-colors focus:border-[color:var(--color-ring)] disabled:cursor-not-allowed disabled:opacity-60 aria-[invalid=true]:border-[color:var(--color-destructive)]"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => remove(index)}
                  disabled={disabled || addresses.length === 1}
                  aria-label="Remove approver"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              {showError ? (
                <p className="text-xs text-[color:var(--color-destructive)]">{error}</p>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
