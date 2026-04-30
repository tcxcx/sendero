'use client';

import { useEffect, useMemo, useState } from 'react';

import { motion } from 'motion/react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

export interface ReputationRecentFeedback {
  stars: number;
  score: number;
  tag: string | null;
  fromAddress: string;
  txHash: string;
  createdAt: string;
  tripId?: string | null;
  bookingId?: string | null;
}

export interface ReputationValidation {
  validatorAddress: string;
  requestHash: string;
  responseScore: number | null;
  tag: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

export interface ReputationDialogIdentity {
  kind: 'sendero-agent' | 'workspace-agent';
  name: string;
  agentId: string | null;
  status?: string | null;
  providerAddress?: string | null;
  holderAddress?: string | null;
  contract?: string | null;
  publicUrl?: string | null;
  explorerUrl?: string | null;
  mintedAt?: string | null;
  cachedAt?: string | null;
}

export interface ReputationStatDialogProps {
  children: React.ReactNode;
  identity: ReputationDialogIdentity;
  metric: {
    key: 'stars' | 'feedback' | 'validators' | 'mean-score' | 'ratings' | 'raters' | 'checks';
    label: string;
    value: string;
    description: string;
  };
  recent?: ReputationRecentFeedback[];
  validations?: ReputationValidation[];
}

export function ReputationStatDialog({
  children,
  identity,
  metric,
  recent = [],
  validations = [],
}: ReputationStatDialogProps) {
  const currentTripId = useCurrentTripId();
  const focusedRecent = useMemo(() => {
    if (!currentTripId) return recent;
    const exact = recent.filter(r => r.tripId === currentTripId);
    return exact.length > 0 ? exact : recent;
  }, [currentTripId, recent]);

  return (
    <Dialog>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-hidden border-[color:var(--ink)] bg-[color:var(--surface-floating)] p-0 text-[color:var(--midnight)] shadow-[0_24px_80px_rgba(31,42,68,0.28)]">
        <motion.div
          layoutId={`reputation-stat-${identity.kind}-${metric.key}`}
          transition={{ type: 'spring', stiffness: 420, damping: 36 }}
          className="overflow-hidden"
        >
          <div className="grid border-b border-[color:var(--ink)] md:grid-cols-[1fr_180px]">
            <div className="p-5">
              <DialogTitle className="font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-[color:var(--vermillion)]">
                {identity.kind === 'sendero-agent'
                  ? 'Sendero agent identity'
                  : 'Workspace agent identity'}
              </DialogTitle>
              <DialogDescription className="mt-2 max-w-xl text-[13px] leading-relaxed text-[color:var(--text-dim)]">
                {metric.description}
              </DialogDescription>
              <div className="mt-4 font-sans text-2xl font-medium tracking-normal text-[color:var(--ink)]">
                {identity.name}
              </div>
            </div>
            <div className="grid place-items-center border-t border-[color:var(--ink)] bg-[color:var(--tint-vermillion-soft)] p-5 md:border-l md:border-t-0">
              <div className="text-center">
                <div className="font-mono text-3xl text-[color:var(--vermillion)]">
                  {metric.value}
                </div>
                <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-[color:var(--text-dim)]">
                  {metric.label}
                </div>
              </div>
            </div>
          </div>

          <div className="max-h-[62vh] overflow-auto p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoPanel
                title="Identity"
                rows={[
                  [
                    'agent id',
                    identity.agentId ? `#${identity.agentId}` : (identity.status ?? 'pending'),
                  ],
                  ['holder', shortAddress(identity.holderAddress ?? identity.providerAddress)],
                  ['contract', shortAddress(identity.contract)],
                  ['minted', formatDate(identity.mintedAt)],
                  ['cache', formatDate(identity.cachedAt)],
                ]}
              />
              <InfoPanel
                title="Validation"
                rows={[
                  ['status', validationStatus(validations, identity.status)],
                  [
                    'validators',
                    String(new Set(validations.map(v => v.validatorAddress)).size || '—'),
                  ],
                  [
                    'latest check',
                    validations[0]?.tag ??
                      validations[0]?.requestHash?.slice(0, 10) ??
                      'none recorded',
                  ],
                  ['current trip', currentTripId ?? 'not scoped'],
                  [
                    'source',
                    identity.publicUrl ?? identity.explorerUrl ?? 'local reputation cache',
                  ],
                ]}
              />
            </div>

            <section className="mt-5">
              <SectionHead
                title="Specific trips and feedback"
                meta={`${focusedRecent.length} visible ${focusedRecent.length === 1 ? 'row' : 'rows'}`}
              />
              {focusedRecent.length > 0 ? (
                <div className="mt-2 divide-y divide-[color:var(--hairline-color)] border border-[color:var(--hairline-color)]">
                  {focusedRecent.map(row => (
                    <InteractionRow key={row.txHash} row={row} />
                  ))}
                </div>
              ) : (
                <EmptyState text="No persisted feedback rows are attached to this identity yet. New trip ratings will appear here with trip ID, booking ID, validator wallet, and transaction hash once Circle event monitoring indexes the ERC-8004 event." />
              )}
            </section>

            <section className="mt-5">
              <SectionHead
                title="Validation checks"
                meta={`${validations.length} ${validations.length === 1 ? 'check' : 'checks'}`}
              />
              {validations.length > 0 ? (
                <div className="mt-2 divide-y divide-[color:var(--hairline-color)] border border-[color:var(--hairline-color)]">
                  {validations.map(row => (
                    <ValidationRow key={row.requestHash} row={row} />
                  ))}
                </div>
              ) : (
                <EmptyState text="No ValidationRegistry request has been indexed for this identity. When KYB, KYC, suitability, or trip-specific checks run, the request hash and validator response will appear here." />
              )}
            </section>
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}

function InfoPanel({ title, rows }: { title: string; rows: Array<[string, string]> }) {
  return (
    <section className="border border-[color:var(--hairline-color)]">
      <div className="border-b border-[color:var(--hairline-color)] px-3 py-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]">
        {title}
      </div>
      <div className="divide-y divide-[color:var(--hairline-color)]">
        {rows.map(([k, v]) => (
          <div key={k} className="grid grid-cols-[112px_1fr] gap-3 px-3 py-2 font-mono text-[11px]">
            <span className="uppercase tracking-[0.12em] text-[color:var(--text-faint)]">{k}</span>
            <span className="min-w-0 truncate text-right text-[color:var(--ink)]">{v}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHead({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.14em] text-[color:var(--ink)]">
        {title}
      </h3>
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-[color:var(--text-faint)]">
        {meta}
      </span>
    </div>
  );
}

function InteractionRow({ row }: { row: ReputationRecentFeedback }) {
  return (
    <div className="grid gap-2 bg-[color:var(--surface-raised)] px-3 py-3 md:grid-cols-[88px_1fr_132px]">
      <div>
        <div className="font-mono text-[13px] text-[color:var(--vermillion)]">
          {row.stars.toFixed(2)}★
        </div>
        <div className="font-mono text-[9px] uppercase tracking-[0.14em] text-[color:var(--text-faint)]">
          score {row.score}
        </div>
      </div>
      <div className="min-w-0">
        <div className="font-mono text-[11px] text-[color:var(--ink)]">{row.tag ?? 'feedback'}</div>
        <div className="mt-1 grid gap-1 font-mono text-[10px] text-[color:var(--text-dim)] md:grid-cols-2">
          <span>trip {row.tripId ?? 'not linked'}</span>
          <span>booking {row.bookingId ?? 'not linked'}</span>
          <span>validator {shortAddress(row.fromAddress)}</span>
          <span>tx {shortHash(row.txHash)}</span>
        </div>
      </div>
      <time className="font-mono text-[10px] text-[color:var(--text-faint)] md:text-right">
        {formatDate(row.createdAt)}
      </time>
    </div>
  );
}

function ValidationRow({ row }: { row: ReputationValidation }) {
  const result =
    row.responseScore == null ? 'pending' : row.responseScore >= 80 ? 'passed' : 'failed';
  return (
    <div className="grid gap-2 bg-[color:var(--surface-raised)] px-3 py-3 md:grid-cols-[88px_1fr_132px]">
      <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-[color:var(--vermillion)]">
        {result}
      </div>
      <div className="min-w-0 font-mono text-[10px] text-[color:var(--text-dim)]">
        <div className="text-[11px] text-[color:var(--ink)]">{row.tag ?? 'validation request'}</div>
        <div className="mt-1">validator {shortAddress(row.validatorAddress)}</div>
        <div>request {shortHash(row.requestHash)}</div>
      </div>
      <time className="font-mono text-[10px] text-[color:var(--text-faint)] md:text-right">
        {formatDate(row.resolvedAt ?? row.createdAt)}
      </time>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="mt-2 border border-dashed border-[color:var(--hairline-color)] bg-[color:var(--surface-raised)] px-3 py-4 text-[12px] leading-relaxed text-[color:var(--text-dim)]">
      {text}
    </div>
  );
}

function useCurrentTripId(): string | null {
  const [tripId, setTripId] = useState<string | null>(null);
  useEffect(() => {
    const match = window.location.pathname.match(/\/dashboard\/inbox\/([^/?#]+)/);
    setTripId(match?.[1] ?? null);
  }, []);
  return tripId;
}

function validationStatus(rows: ReputationValidation[], fallback?: string | null): string {
  if (rows.length === 0) return fallback ?? 'not requested';
  const pending = rows.filter(r => r.responseScore == null).length;
  const passed = rows.filter(r => (r.responseScore ?? 0) >= 80).length;
  return pending > 0 ? `${pending} pending · ${passed} passed` : `${passed}/${rows.length} passed`;
}

function shortAddress(value?: string | null): string {
  if (!value) return '—';
  if (value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function shortHash(value?: string | null): string {
  if (!value) return '—';
  if (value.length <= 18) return value;
  return `${value.slice(0, 10)}…${value.slice(-6)}`;
}

function formatDate(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
