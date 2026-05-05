'use client';

/**
 * Inject-card dialog — Phase G.4 operator rich-message composer.
 *
 * Posts a `ChannelMessage { kind: 'card' }` to
 * `/api/internal/console/trip/[tripId]/inject` which dispatches over the
 * traveler's resolved primary channel (whatsapp or slack). Tenant-scoped
 * server-side via Clerk org gating.
 *
 * Scope is intentionally narrow: title, body, optional bullets (one
 * per line), optional image URL, up to two CTAs (open_link / reply).
 * Anything richer belongs in a dedicated tool, not a free-form composer.
 */

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface InjectCardDialogProps {
  tripId: string;
  /** Called after a successful inject so the parent can refresh the timeline. */
  onInjected?: () => void;
}

interface CtaDraft {
  label: string;
  kind: 'open_link' | 'reply';
  href: string;
  value: string;
}

export function InjectCardDialog({ tripId, onInjected }: InjectCardDialogProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [bulletsRaw, setBulletsRaw] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [ctas, setCtas] = useState<CtaDraft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setTitle('');
    setBody('');
    setBulletsRaw('');
    setImageUrl('');
    setCtas([]);
    setError(null);
  };

  const submit = async () => {
    if (!title.trim() || !body.trim()) {
      setError('Title and body are required.');
      return;
    }
    setSubmitting(true);
    setError(null);
    const bullets = bulletsRaw
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, 6);
    const payloadCtas = ctas
      .filter(c => c.label.trim().length > 0)
      .map(c => {
        if (c.kind === 'open_link') {
          return { label: c.label.trim(), kind: c.kind, href: c.href.trim() };
        }
        return { label: c.label.trim(), kind: c.kind, value: c.value.trim() };
      });
    try {
      const res = await fetch(`/api/internal/console/trip/${encodeURIComponent(tripId)}/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          body: body.trim(),
          ...(bullets.length > 0 ? { bullets } : {}),
          ...(imageUrl.trim() ? { imageUrl: imageUrl.trim() } : {}),
          ...(payloadCtas.length > 0 ? { ctas: payloadCtas } : {}),
        }),
      });
      const json = (await res.json().catch(() => null)) as {
        id: string;
        status: string;
        channel?: string | null;
        error?: string;
      } | null;
      if (!res.ok) {
        setError(json?.error ?? `Server returned ${res.status}`);
        return;
      }
      if (json?.status === 'no_channel') {
        setError('Traveler has no resolved channel — message logged, not delivered.');
        return;
      }
      if (json?.status === 'failed_delivery') {
        setError('Delivery failed. Message logged. Check trip events for detail.');
        return;
      }
      onInjected?.();
      reset();
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="t-mono text-[10px] uppercase tracking-wider">
          + Card
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Compose card</DialogTitle>
          <DialogDescription>
            Push a rich card to the traveler over their primary channel. Routes to whatsapp or slack
            based on what's bound to this trip.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label htmlFor="inject-title">Title</Label>
            <Input
              id="inject-title"
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Hold confirmed · LAX → CDG"
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="inject-body">Body</Label>
            <Textarea
              id="inject-body"
              value={body}
              onChange={e => setBody(e.target.value)}
              maxLength={2000}
              placeholder="Markdown supported. Channel renderers downgrade as needed."
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="inject-bullets">
              Bullets <span className="text-xs text-muted-foreground">(one per line, max 6)</span>
            </Label>
            <Textarea
              id="inject-bullets"
              value={bulletsRaw}
              onChange={e => setBulletsRaw(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1">
            <Label htmlFor="inject-image">
              Image URL <span className="text-xs text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="inject-image"
              type="url"
              value={imageUrl}
              onChange={e => setImageUrl(e.target.value)}
              placeholder="https://…"
            />
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <Label>CTAs ({ctas.length}/2)</Label>
              <button
                type="button"
                disabled={ctas.length >= 2}
                onClick={() =>
                  setCtas(prev => [...prev, { label: '', kind: 'open_link', href: '', value: '' }])
                }
                className="t-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                + add
              </button>
            </div>
            {ctas.map((cta, i) => (
              <div key={i} className="flex flex-col gap-1 rounded border border-border p-2">
                <div className="flex items-center gap-2">
                  <Input
                    value={cta.label}
                    onChange={e =>
                      setCtas(prev =>
                        prev.map((c, idx) => (idx === i ? { ...c, label: e.target.value } : c))
                      )
                    }
                    placeholder="Button label"
                    maxLength={40}
                    className="flex-1"
                  />
                  <select
                    value={cta.kind}
                    onChange={e =>
                      setCtas(prev =>
                        prev.map((c, idx) =>
                          idx === i ? { ...c, kind: e.target.value as CtaDraft['kind'] } : c
                        )
                      )
                    }
                    className="rounded border border-border bg-background px-2 py-1 text-xs"
                  >
                    <option value="open_link">open_link</option>
                    <option value="reply">reply</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setCtas(prev => prev.filter((_, idx) => idx !== i))}
                    className="text-xs text-muted-foreground hover:text-foreground"
                    aria-label="Remove CTA"
                  >
                    ✕
                  </button>
                </div>
                {cta.kind === 'open_link' ? (
                  <Input
                    type="url"
                    value={cta.href}
                    onChange={e =>
                      setCtas(prev =>
                        prev.map((c, idx) => (idx === i ? { ...c, href: e.target.value } : c))
                      )
                    }
                    placeholder="https://…"
                  />
                ) : (
                  <Input
                    value={cta.value}
                    onChange={e =>
                      setCtas(prev =>
                        prev.map((c, idx) => (idx === i ? { ...c, value: e.target.value } : c))
                      )
                    }
                    placeholder="Quick-reply value the agent will see"
                    maxLength={120}
                  />
                )}
              </div>
            ))}
          </div>

          {error ? (
            <div className="rounded border border-[var(--vermillion)] bg-[color-mix(in_oklab,var(--vermillion)_8%,transparent)] px-3 py-2 text-xs text-[var(--vermillion)]">
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={submitting}>
            {submitting ? 'Sending…' : 'Send card'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
