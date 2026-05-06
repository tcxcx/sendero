'use client';

/**
 * Broadcast modal — operator picks a Meta-approved template, fills
 * body params, fires `POST /api/groups/[id]/broadcast`. The API route
 * authenticates via Clerk session, calls `broadcast_to_group_trip`
 * tool with the operator's tenant binding.
 *
 * Templates are read from a small static catalog for v1 (matches the
 * five templates submitted to Meta — see CLAUDE.md "Templates to
 * seed"). A future iteration pulls live from Kapso /whatsapp/templates
 * filtered to APPROVED + transactional.
 */

import { useState } from 'react';

interface TemplateSpec {
  /** Sendero-side label — also the template name in Meta. */
  name: string;
  /** Body placeholders in order, e.g. `['location', 'time']`. */
  fields: Array<{ key: string; label: string; placeholder?: string }>;
  /** Body text used for the in-modal preview. */
  preview: string;
}

const TEMPLATES: TemplateSpec[] = [
  {
    name: 'group_meeting_point',
    preview: '{{tripName}} meets at {{1}} at {{2}}. Confirm: ✅',
    fields: [
      { key: 'location', label: 'Meeting location', placeholder: 'Lobby of Hotel Lima' },
      { key: 'time', label: 'Meeting time', placeholder: '06:00' },
    ],
  },
  {
    name: 'group_change_alert',
    preview: 'Update for {{tripName}}: {{1}}. Tap for details: {{2}}',
    fields: [
      { key: 'changeSummary', label: 'Change summary', placeholder: 'Departure pushed to 7am' },
      { key: 'url', label: 'Details URL', placeholder: 'https://sendero.travel/t/abc' },
    ],
  },
  {
    name: 'group_day_of_reminder',
    preview: '{{tripName}} starts in 24h. Quick check-in: {{1}}',
    fields: [{ key: 'url', label: 'Check-in URL', placeholder: 'https://sendero.travel/t/abc' }],
  },
];

export function BroadcastButton({
  groupTripId,
  eligibleCount,
}: {
  groupTripId: string;
  eligibleCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [templateName, setTemplateName] = useState(TEMPLATES[0]!.name);
  const [params, setParams] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { ok: true; broadcastId: string; recipientCount: number; skippedCount: number }
    | { ok: false; error: string }
    | null
  >(null);

  const tpl = TEMPLATES.find(t => t.name === templateName) ?? TEMPLATES[0]!;
  const previewSubbed = tpl.preview.replace(
    /\{\{(\d+)\}\}/g,
    (_, n: string) => params[tpl.fields[Number(n) - 1]?.key ?? ''] || `{{${n}}}`
  );

  async function send() {
    setSubmitting(true);
    setResult(null);
    try {
      const orderedParams = tpl.fields.map(f => params[f.key] ?? '');
      const res = await fetch(`/api/groups/${encodeURIComponent(groupTripId)}/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateName: tpl.name,
          bodyParams: orderedParams,
          audience: 'claimed',
        }),
      });
      const payload = (await res.json()) as
        | { ok: true; broadcastId: string; recipientCount: number; skipped: unknown[] }
        | { ok: false; error: string; message?: string };
      if ('ok' in payload && payload.ok) {
        setResult({
          ok: true,
          broadcastId: payload.broadcastId,
          recipientCount: payload.recipientCount,
          skippedCount: Array.isArray(payload.skipped) ? payload.skipped.length : 0,
        });
      } else {
        setResult({
          ok: false,
          error:
            ('message' in payload && payload.message) ||
            ('error' in payload && payload.error) ||
            'unknown',
        });
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        disabled={eligibleCount === 0}
        onClick={() => setOpen(true)}
        className="rounded-full bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:#fdfbf7] transition disabled:opacity-50"
      >
        Broadcast{eligibleCount > 0 ? ` to ${eligibleCount}` : ''}
      </button>
    );
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 px-4">
      <div className="grid w-full max-w-md gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--bg)] p-4">
        <header className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-[color:var(--ink)]">Group broadcast</h3>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setResult(null);
            }}
            className="font-mono text-xs text-[color:var(--text-dim)]"
          >
            close
          </button>
        </header>

        {result?.ok ? (
          <div className="grid gap-2 rounded-xl border border-[color:var(--accent-green,#15803d)] bg-[color:var(--bg-soft)] p-3 text-sm">
            <div className="text-[color:var(--ink)]">
              ✓ Broadcast sent to {result.recipientCount}
              {result.skippedCount > 0 ? ` (${result.skippedCount} skipped)` : ''}
            </div>
            <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
              {result.broadcastId}
            </div>
          </div>
        ) : null}

        {result && 'ok' in result && !result.ok ? (
          <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-3 text-sm">
            <div className="font-medium text-[color:var(--ink)]">Couldn&rsquo;t send.</div>
            <div className="font-mono text-[11px] text-[color:var(--text-dim)]">
              {'error' in result ? result.error : 'unknown'}
            </div>
          </div>
        ) : null}

        <label className="grid gap-1 text-sm">
          <span className="text-[color:var(--text-dim)]">Template</span>
          <select
            value={templateName}
            onChange={e => {
              setTemplateName(e.target.value);
              setParams({});
            }}
            className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1.5 text-sm"
          >
            {TEMPLATES.map(t => (
              <option key={t.name} value={t.name}>
                {t.name}
              </option>
            ))}
          </select>
        </label>

        {tpl.fields.map(f => (
          <label key={f.key} className="grid gap-1 text-sm">
            <span className="text-[color:var(--text-dim)]">{f.label}</span>
            <input
              type="text"
              placeholder={f.placeholder}
              value={params[f.key] ?? ''}
              onChange={e => setParams(p => ({ ...p, [f.key]: e.target.value }))}
              className="rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-2 py-1.5 text-sm"
            />
          </label>
        ))}

        <div className="rounded-xl border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-3 text-sm">
          <div className="font-mono text-[11px] uppercase tracking-wide text-[color:var(--text-dim)]">
            Preview
          </div>
          <div className="text-[color:var(--ink)]">{previewSubbed}</div>
        </div>

        <button
          type="button"
          onClick={send}
          disabled={submitting || (result?.ok ?? false)}
          className="rounded-full bg-[color:var(--ink)] px-4 py-2 text-sm font-semibold text-[color:#fdfbf7] transition disabled:opacity-50"
        >
          {submitting ? 'Sending…' : result?.ok ? 'Sent' : `Send to ${eligibleCount}`}
        </button>
      </div>
    </div>
  );
}
