'use client';

/**
 * Per-step pane renderers for the WhatsApp setup wizard.
 *
 * Each pane is keyed by `payload.promptId` from the workflow def
 * (whatsappProvisionWorkflow) and reads/writes the wizard's
 * `setResolution` so the operator's inputs flow into the WorkflowRun
 * scratchpad on Continue.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import Image from 'next/image';

import { AlertCircle, Check, ExternalLink, Loader2, RefreshCw } from 'lucide-react';

import type { WizardPaneProps, WizardPaneRenderer } from './types';

const META_BUSINESS_VERIFICATION_URL =
  'https://business.facebook.com/latest/settings/security_center/?nav_ref=bm_settings_redirect_migration&bm_redirect_migration=true';

const TEMPLATE_DEFS = [
  {
    id: 'trip_intake_v3',
    label: 'trip_intake_v3',
    description: 'Initial trip-intake greeting (Utility).',
    body: "Hi {{1}}, I'm Sendero — drop your trip details and I'll get to work.",
  },
  {
    id: 'hold_confirmation_v2',
    label: 'hold_confirmation_v2',
    description: 'Sent when a hold is placed (Utility).',
    body: "Held {{1}} ({{2}}) for you. Ticketing in progress; I'll confirm the moment it's issued.",
  },
  {
    id: 'cap_warning_v1',
    label: 'cap_warning_v1',
    description: 'Fires near the spend cap (Utility).',
    body: "You're at {{1}} of your {{2}} cap. Want to extend or pause autopay?",
  },
] as const;

const FIELD_LABEL =
  'font-mono text-[10px] uppercase tracking-[0.14em] text-[color:var(--text-dim)]';

export const whatsappPanes: Record<string, WizardPaneRenderer> = {
  'whatsapp.verify_number': VerifyNumberPane,
  'whatsapp.brand_profile': BrandProfilePane,
  'whatsapp.approve_templates': ApproveTemplatesPane,
  'whatsapp.go_live': GoLivePane,
};

// ─── 1. verify number ────────────────────────────────────────────────

interface InstallSnapshot {
  status: string;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  businessDisplayName: string | null;
  setupLinkUrl: string | null;
  setupLinkExpiresAt: string | null;
  setupLinkStatus: string | null;
  setupLinkError: string | null;
  setupLinkProvisionPhoneNumber: boolean | null;
  provisioned: boolean;
  sandbox?: boolean;
  lastErrorMessage: string | null;
  health: WhatsAppHealthSummary | null;
}

interface WhatsAppHealthSummary {
  status: string | null;
  messagingStatus: string | null;
  phoneStatus: string | null;
  webhookSubscribed: boolean | null;
  webhookVerified: boolean | null;
  qualityRating: string | null;
  errors: string[];
  checkedAt: string;
}

/**
 * Step 2 — operator finishes Meta Embedded Signup in the hosted setup page.
 *
 * `provision_phone_number=true` doesn't allocate the WABA phone
 * number synchronously. The flow is:
 *
 *   1. We minted a setup link before this pause (kapso_reserve_number stored
 *      `metadata.setupLinkUrl` on WhatsAppInstall).
 *   2. The operator clicks "Open WhatsApp setup" → opens the hosted
 *      page in a new tab → completes Embedded Signup (~30 sec).
 *   3. The provider fires `whatsapp.phone_number.created` to our project
 *      webhook (apps/app/app/api/webhooks/kapso/route.ts), which writes
 *      `phoneNumberId` + `status='active'` on WhatsAppInstall.
 *   4. This pane polls /api/channels/whatsapp/install every 4s; once
 *      `provisioned=true`, it surfaces the real number and enables
 *      Continue. Operator clicks → wizard advances to brand profile.
 */
function VerifyNumberPane({ setResolution }: WizardPaneProps) {
  const [snapshot, setSnapshot] = useState<InstallSnapshot | null>(null);
  const [opened, setOpened] = useState(false);
  const [loadingLink, setLoadingLink] = useState(false);
  const [bindingSandbox, setBindingSandbox] = useState(false);
  const [attemptedSetupLink, setAttemptedSetupLink] = useState(false);
  const [setupError, setSetupError] = useState<string | null>(null);

  const refreshInstall = useCallback(async () => {
    try {
      const res = await fetch('/api/channels/whatsapp/install', {
        headers: { Accept: 'application/json' },
      });
      const data = await readJsonResponse<{ install: InstallSnapshot | null }>(
        res,
        'refresh WhatsApp install'
      );
      console.info('[whatsapp wizard] install refresh', {
        status: res.status,
        provisioned: data.install?.provisioned ?? false,
        phoneNumberId: data.install?.phoneNumberId ?? null,
        installStatus: data.install?.status ?? null,
        setupLinkStatus: data.install?.setupLinkStatus ?? null,
        setupLinkError: data.install?.setupLinkError ?? null,
        lastErrorMessage: data.install?.lastErrorMessage ?? null,
        health: data.install?.health
          ? {
              status: data.install.health.status,
              messagingStatus: data.install.health.messagingStatus,
              webhookVerified: data.install.health.webhookVerified,
            }
          : null,
      });
      setSnapshot(data.install);
    } catch (err) {
      console.warn('[whatsapp wizard] install refresh failed', err);
    }
  }, []);

  useEffect(() => {
    void refreshInstall();
    const id = setInterval(() => void refreshInstall(), 4000);
    return () => {
      clearInterval(id);
    };
  }, [refreshInstall]);

  useEffect(() => {
    if (isVerifiedWhatsAppInstall(snapshot)) {
      setResolution({
        acknowledged: true,
        phoneNumberId: snapshot?.phoneNumberId,
        displayPhoneNumber: snapshot?.displayPhoneNumber,
      });
    } else {
      setResolution(null);
    }
  }, [snapshot, setResolution]);

  const setupUrl = snapshot?.setupLinkUrl ?? null;
  const provisioned = snapshot?.provisioned ?? false;
  const sandbox = snapshot?.sandbox === true;
  const createOrRefreshSetupLink = async () => {
    setAttemptedSetupLink(true);
    setLoadingLink(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/channels/whatsapp/setup-link?provision=true', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numberSource: 'kapso_provisioned',
          provisionPhoneNumber: true,
          countryIso: 'US',
        }),
      });
      const data = await readJsonResponse<{
        error?: string;
        message?: string;
        setupLink?: { url?: string };
      }>(res, 'create WhatsApp setup link');
      console.info('[whatsapp wizard] setup link response', {
        status: res.status,
        ok: res.ok,
        error: data.error ?? null,
        message: data.message ?? null,
        hasSetupUrl: Boolean(data.setupLink?.url),
      });
      if (!res.ok) {
        setSetupError(cleanWhatsAppSetupCopy(data.message ?? data.error ?? `HTTP ${res.status}`));
        return;
      }
      await refreshInstall();
      if (data.setupLink?.url) {
        setSnapshot(prev =>
          prev
            ? { ...prev, setupLinkUrl: data.setupLink?.url ?? prev.setupLinkUrl }
            : {
                status: 'pending',
                phoneNumberId: null,
                displayPhoneNumber: null,
                businessDisplayName: null,
                setupLinkUrl: data.setupLink.url,
                setupLinkExpiresAt: null,
                setupLinkStatus: null,
                setupLinkError: null,
                setupLinkProvisionPhoneNumber: false,
                provisioned: false,
                lastErrorMessage: null,
                health: null,
              }
        );
      }
    } catch (err) {
      console.warn('[whatsapp wizard] setup link request failed', err);
      setSetupError(
        cleanWhatsAppSetupCopy(err instanceof Error ? err.message : 'Could not create setup link')
      );
    } finally {
      setLoadingLink(false);
    }
  };

  useEffect(() => {
    if (!setupUrl && !provisioned && !loadingLink && !attemptedSetupLink) {
      void createOrRefreshSetupLink();
    }
  }, [attemptedSetupLink, loadingLink, provisioned, setupUrl, snapshot]);

  useEffect(() => {
    if (sandbox) setSetupError(null);
  }, [sandbox]);

  const restartSetup = async () => {
    setLoadingLink(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/channels/whatsapp/install', {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      const data = await readJsonResponse<{ ok?: boolean; message?: string; error?: string }>(
        res,
        'restart WhatsApp setup'
      );
      if (!res.ok || data.ok !== true) {
        setSetupError(cleanWhatsAppSetupCopy(data.message ?? data.error ?? `HTTP ${res.status}`));
        return;
      }
      setOpened(false);
      setSnapshot(null);
      window.location.href = '/dashboard/channels/whatsapp/connect';
    } catch (err) {
      console.warn('[whatsapp wizard] restart setup failed', err);
      setSetupError(
        cleanWhatsAppSetupCopy(err instanceof Error ? err.message : 'Could not restart setup')
      );
    } finally {
      setLoadingLink(false);
    }
  };

  const bindSandboxNumber = async () => {
    setBindingSandbox(true);
    setSetupError(null);
    try {
      const res = await fetch('/api/channels/whatsapp/sandbox', {
        method: 'POST',
        headers: { Accept: 'application/json' },
      });
      const data = await readJsonResponse<{ ok?: boolean; message?: string; error?: string }>(
        res,
        'bind WhatsApp sandbox'
      );
      if (!res.ok || data.ok !== true) {
        setSetupError(cleanWhatsAppSetupCopy(data.message ?? data.error ?? `HTTP ${res.status}`));
        return;
      }
      await refreshInstall();
    } catch (err) {
      console.warn('[whatsapp wizard] sandbox bind failed', err);
      setSetupError(
        cleanWhatsAppSetupCopy(err instanceof Error ? err.message : 'Could not bind sandbox number')
      );
    } finally {
      setBindingSandbox(false);
    }
  };
  const action = describeWhatsAppReadiness(snapshot, setupUrl);
  const showBusinessVerification = shouldShowBusinessVerification(snapshot, action);

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <div className={FIELD_LABEL}>Number</div>
        <div className="mt-1 font-mono text-[22px] tracking-tight text-[color:var(--ink)]">
          {snapshot?.displayPhoneNumber ?? 'Not connected'}
        </div>
      </div>

      <ReadinessCallout action={action} />

      {showBusinessVerification ? (
        <div className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] px-3 py-3">
          <div className={FIELD_LABEL}>Meta verification</div>
          <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--text-dim)]">
            Finish business verification in Meta, then return here and refresh. Choose “Verificación
            del negocio” and select your verification use case.
          </p>
          <a
            href={META_BUSINESS_VERIFICATION_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] px-3 text-[12px] font-medium text-[color:var(--ink)] transition-colors hover:border-[color:var(--ink)]"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Verify in Meta
          </a>
        </div>
      ) : null}

      {setupError ? (
        <div className="flex items-start gap-2 rounded-md border border-[color:var(--accent-rose)] bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)] px-3 py-2 text-xs text-[color:var(--accent-rose)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{setupError}</span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {provisioned ? null : setupUrl ? (
          <a
            href={setupUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpened(true)}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[color:#25D366] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            <ExternalLink className="h-4 w-4" />
            Open setup
          </a>
        ) : (
          <button
            type="button"
            onClick={createOrRefreshSetupLink}
            disabled={loadingLink || provisioned}
            className="inline-flex h-9 items-center gap-2 rounded-md bg-[color:#25D366] px-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-70"
          >
            {loadingLink ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ExternalLink className="h-4 w-4" />
            )}
            Open setup
          </button>
        )}
        <button
          type="button"
          onClick={() => void refreshInstall()}
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] px-3 text-[12px] text-[color:var(--text-dim)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
        <button
          type="button"
          onClick={() => void restartSetup()}
          disabled={loadingLink}
          className="inline-flex h-9 items-center rounded-md border border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--text-dim)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)] disabled:cursor-wait disabled:opacity-60"
        >
          Restart
        </button>
        <span className="inline-flex h-9 items-center gap-1.5 text-[12px] text-[color:var(--text-dim)]">
          {(opened || loadingLink) && !provisioned ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : null}
          Waiting
        </span>
        {process.env.NODE_ENV !== 'production' ? (
          <button
            type="button"
            onClick={() => void bindSandboxNumber()}
            disabled={bindingSandbox}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] px-3 font-mono text-[11px] uppercase tracking-[0.08em] text-[color:var(--text-dim)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)] disabled:cursor-wait disabled:opacity-60"
          >
            {bindingSandbox ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Use sandbox
          </button>
        ) : null}
      </div>
    </div>
  );
}

function isVerifiedWhatsAppInstall(snapshot: InstallSnapshot | null): boolean {
  if (!snapshot?.provisioned) return false;
  if (snapshot.setupLinkError || snapshot.lastErrorMessage) return false;
  if (!snapshot.phoneNumberId || snapshot.phoneNumberId === 'pending') return false;
  if (!snapshot.displayPhoneNumber || /pending/i.test(snapshot.displayPhoneNumber)) return false;
  return true;
}

function shouldShowBusinessVerification(
  snapshot: InstallSnapshot | null,
  action: { tone: ReadinessTone; label: string }
): boolean {
  if (!snapshot?.provisioned) return false;
  const text = `${action.label} ${snapshot.health?.errors.join(' ') ?? ''}`;
  return /business|review|limited|payment|verification|verified/i.test(text);
}

async function readJsonResponse<T>(response: Response, label: string): Promise<T> {
  const contentType = response.headers.get('content-type') ?? '';
  const text = await response.text();
  if (!contentType.toLowerCase().includes('application/json')) {
    const snippet = text.slice(0, 240).replace(/\s+/g, ' ').trim();
    throw new Error(
      `${label} returned ${response.status} ${response.statusText || ''} as ${contentType || 'unknown content-type'}: ${snippet}`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    const snippet = text.slice(0, 240).replace(/\s+/g, ' ').trim();
    throw new Error(
      `${label} returned invalid JSON (${err instanceof Error ? err.message : String(err)}): ${snippet}`
    );
  }
}

type ReadinessTone = 'ok' | 'pending' | 'blocked';

function describeWhatsAppReadiness(
  snapshot: InstallSnapshot | null,
  setupUrl: string | null
): { tone: ReadinessTone; label: string; next: string; details: string[] } {
  if (!snapshot) {
    return {
      tone: 'pending',
      label: 'No setup record yet',
      next: 'Create a workspace setup link.',
      details: ['Sendero needs a secure setup link before WhatsApp can connect a number.'],
    };
  }
  if (snapshot.setupLinkError) {
    if (isDuplicateDisplayPhoneNumberError(snapshot.setupLinkError)) {
      return {
        tone: 'pending',
        label: 'Number already connected',
        next: 'Click Refresh. Sendero will bind the existing phone number when it belongs to this workspace.',
        details: [
          'Do not create another WhatsApp config for the same business number.',
          snapshot.setupLinkError,
        ],
      };
    }
    return {
      tone: 'blocked',
      label: 'Setup link error',
      next: 'Create a fresh setup link, then reopen WhatsApp setup.',
      details: [snapshot.setupLinkError],
    };
  }
  if (snapshot.lastErrorMessage) {
    return {
      tone: 'blocked',
      label: 'Provisioning error',
      next: 'Refresh after fixing the reported WhatsApp setup issue.',
      details: [snapshot.lastErrorMessage],
    };
  }
  if (!setupUrl && !snapshot.provisioned) {
    return {
      tone: 'pending',
      label: 'Setup link needed',
      next: 'Click Create setup link.',
      details: ['The link is tenant-scoped and can be safely recreated if it expires.'],
    };
  }
  if (!snapshot.provisioned) {
    return {
      tone: 'pending',
      label: 'Waiting for Meta signup',
      next: 'Open WhatsApp setup, approve the business connection, then click Refresh.',
      details: [
        'Use the Meta account that can manage the target WhatsApp Business number.',
        'Sendero advances after the provider confirms the phone number.',
      ],
    };
  }
  if (snapshot.sandbox === true) {
    return {
      tone: 'ok',
      label: 'Sandbox ready',
      next: 'Activate now. Sendero will route sandbox inbound messages to this workspace.',
      details: [
        'Real WhatsApp Business numbers still use Meta verification before production go-live.',
      ],
    };
  }

  const health = snapshot.health;
  if (!health) {
    return {
      tone: 'pending',
      label: 'WhatsApp connected',
      next: 'Continue while Sendero fetches Meta health in the background.',
      details: ['The number exists, but the health check has not returned yet.'],
    };
  }

  const status = `${health.status ?? ''} ${health.messagingStatus ?? ''} ${health.phoneStatus ?? ''}`;
  if (/blocked/i.test(status)) {
    return {
      tone: 'blocked',
      label: 'Meta review needed',
      next: 'Finish the Meta account review, then refresh this page.',
      details: health.errors.length
        ? health.errors
        : ['Your number is connected, but Meta is blocking outbound messaging for now.'],
    };
  }
  if (/limited/i.test(status)) {
    return {
      tone: 'pending',
      label: 'Connected, pending Meta review',
      next: 'Finish business verification, then send one inbound WhatsApp message and refresh.',
      details: health.errors.length
        ? health.errors
        : [
            'Inbound messaging can work now. Outbound templates may stay limited until Meta clears the account.',
          ],
    };
  }
  if (health.webhookVerified === false) {
    return {
      tone: 'pending',
      label: 'Webhook waiting for first message',
      next: `Send a WhatsApp message to ${snapshot.displayPhoneNumber ?? 'this number'}, then Refresh.`,
      details: ['Meta often marks webhook verification only after the first inbound message.'],
    };
  }
  if (health.webhookSubscribed === false) {
    return {
      tone: 'pending',
      label: 'Ready for test',
      next: 'Continue to send a test message and activate.',
      details: ['Sendero registers the workflow trigger during activation.'],
    };
  }
  if (/healthy|available|active/i.test(status)) {
    return {
      tone: 'ok',
      label: 'Ready for test',
      next: 'Continue to send a test message and activate.',
      details: ['WhatsApp health checks look ready.'],
    };
  }
  return {
    tone: 'pending',
    label: 'WhatsApp connected',
    next: 'Continue to test the channel.',
    details: health.errors.length ? health.errors : ['Meta health is not fully reported yet.'],
  };
}

function isDuplicateDisplayPhoneNumberError(message: string): boolean {
  return /same display phone number already exists|display phone number already exists/i.test(
    message
  );
}

function ReadinessCallout({
  action,
}: {
  action: { tone: ReadinessTone; label: string; next: string; details: string[] };
}) {
  const toneClass =
    action.tone === 'ok'
      ? 'border-[color:#2EA876] bg-[color:color-mix(in_oklab,#2EA876_8%,transparent)] text-[color:#15704e]'
      : action.tone === 'blocked'
        ? 'border-[color:var(--accent-rose)] bg-[color:color-mix(in_oklab,var(--accent-rose)_8%,transparent)] text-[color:var(--accent-rose)]'
        : 'border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] bg-[color:var(--surface-raised)] text-[color:var(--text)]';
  return (
    <div className={`rounded-md border px-3 py-3 ${toneClass}`}>
      <div className="flex items-start gap-2">
        {action.tone === 'ok' ? (
          <Check className="mt-0.5 h-4 w-4 shrink-0" />
        ) : action.tone === 'blocked' ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
        ) : (
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        )}
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-sm font-medium">{action.label}</span>
          <span className="text-[12px] leading-relaxed">{action.next}</span>
          {action.details.length ? (
            <ul className="mt-1 list-disc pl-4 text-[11px] leading-relaxed opacity-80">
              {action.details.slice(0, 3).map(detail => (
                <li key={detail}>{cleanWhatsAppSetupCopy(detail)}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function cleanWhatsAppSetupCopy(message: string): string {
  return message.replaceAll('Kapso', 'the setup provider').replaceAll('kapso', 'setup provider');
}

function HealthGrid({ health }: { health: WhatsAppHealthSummary | null }) {
  if (!health) return null;
  return (
    <div className="flex flex-wrap gap-2 text-[11px] text-[color:var(--text-dim)]">
      <span>Meta: {health.status ?? 'unknown'}</span>
      <span>Messaging: {health.messagingStatus ?? 'unknown'}</span>
      <span>Webhook: {health.webhookVerified ? 'verified' : 'waiting'}</span>
    </div>
  );
}

// ─── 3. brand the experience ─────────────────────────────────────────

function BrandProfilePane({ setResolution }: WizardPaneProps) {
  const [displayName, setDisplayName] = useState('Sendero');
  const [about, setAbout] = useState('');
  const [profilePhotoUrl, setProfilePhotoUrl] = useState('');
  const [defaultGreeting, setDefaultGreeting] = useState(
    "Hi 👋 I'm here to help with your trip — drop your details and I'll get to work."
  );

  useEffect(() => {
    if (!displayName.trim()) {
      setResolution(null);
      return;
    }
    setResolution({
      displayName: displayName.trim(),
      about: about.trim() || undefined,
      profilePhotoUrl: profilePhotoUrl.trim() || undefined,
      defaultGreeting: defaultGreeting.trim() || undefined,
    });
  }, [displayName, about, profilePhotoUrl, defaultGreeting, setResolution]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="flex flex-col gap-4">
        <Field label="Display name" hint="Max 64 characters.">
          <input
            type="text"
            maxLength={64}
            value={displayName}
            onChange={e => setDisplayName(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Profile photo URL" hint="Square, 640×640 recommended.">
          <input
            type="url"
            value={profilePhotoUrl}
            placeholder="https://…/logo.png"
            onChange={e => setProfilePhotoUrl(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Short bio" hint="Up to 139 characters.">
          <input
            type="text"
            maxLength={139}
            value={about}
            placeholder="Travel made for the fast lane."
            onChange={e => setAbout(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
        <Field label="Default greeting" hint="First message Sendero sends a new traveler.">
          <textarea
            rows={3}
            maxLength={2000}
            value={defaultGreeting}
            onChange={e => setDefaultGreeting(e.target.value)}
            className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm leading-relaxed text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
          />
        </Field>
      </div>
      <BrandPreview
        displayName={displayName}
        photoUrl={profilePhotoUrl}
        greeting={defaultGreeting}
      />
    </div>
  );
}

function BrandPreview({
  displayName,
  photoUrl,
  greeting,
}: {
  displayName: string;
  photoUrl: string;
  greeting: string;
}) {
  return (
    <aside className="flex flex-col gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[#075E54] p-4 text-white shadow-md">
      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/70">
        Live preview
      </span>
      <header className="flex items-center gap-2 border-b border-white/15 pb-3">
        {photoUrl ? (
          <Image
            src={photoUrl}
            alt={displayName}
            width={36}
            height={36}
            className="h-9 w-9 rounded-full object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 font-serif text-[14px]">
            {displayName.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-[14px] font-semibold leading-tight">
            {displayName || 'Sendero'}
          </span>
          <span className="text-[11px] text-white/70">online</span>
        </div>
      </header>
      <div className="mt-3 max-w-[230px] self-start rounded-2xl rounded-bl-sm bg-white px-3 py-2 text-[12px] leading-snug text-[#0c1f1c]">
        {greeting || 'Type a greeting to preview…'}
      </div>
    </aside>
  );
}

// ─── 4. approve templates ────────────────────────────────────────────

function ApproveTemplatesPane({ setResolution }: WizardPaneProps) {
  const [picked, setPicked] = useState<Set<string>>(new Set(TEMPLATE_DEFS.map(t => t.id)));

  useEffect(() => {
    if (picked.size === 0) {
      setResolution(null);
      return;
    }
    setResolution({ templateNames: Array.from(picked) });
  }, [picked, setResolution]);

  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-[60ch] text-sm leading-relaxed text-[color:var(--text-dim)]">
        Submitted as <strong className="text-[color:var(--ink)]">Utility</strong> templates; Meta
        typically approves utility templates within minutes.
      </p>
      <ul className="flex flex-col divide-y divide-[color:color-mix(in_oklab,var(--ink)_8%,transparent)] overflow-hidden rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)]">
        {TEMPLATE_DEFS.map(t => {
          const on = picked.has(t.id);
          return (
            <li key={t.id}>
              <button
                type="button"
                onClick={() => {
                  setPicked(prev => {
                    const next = new Set(prev);
                    if (next.has(t.id)) next.delete(t.id);
                    else next.add(t.id);
                    return next;
                  });
                }}
                className="flex w-full items-start gap-3 px-3 py-3 text-left transition-colors hover:bg-[color:color-mix(in_oklab,var(--ink)_4%,transparent)]"
              >
                <span
                  className={
                    'mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border ' +
                    (on
                      ? 'border-[color:var(--accent-rose)] bg-[color:var(--accent-rose)] text-white'
                      : 'border-[color:color-mix(in_oklab,var(--ink)_25%,transparent)] bg-white')
                  }
                >
                  {on ? <Check className="h-3 w-3" /> : null}
                </span>
                <div className="flex flex-col gap-0.5">
                  <span className="font-mono text-[12px] tracking-tight text-[color:var(--ink)]">
                    {t.label}
                  </span>
                  <span className="text-[11px] text-[color:var(--text-dim)]">{t.description}</span>
                  <span className="font-mono text-[11px] text-[color:var(--text-faint)]">
                    {t.body}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ─── 2. send test ────────────────────────────────────────────────────

function GoLivePane({ setResolution }: WizardPaneProps) {
  const [snapshot, setSnapshot] = useState<InstallSnapshot | null>(null);
  const [sendTest, setSendTest] = useState(false);
  const [testToE164, setTestToE164] = useState('');
  const [testBody, setTestBody] = useState('Sendero test ping. You are connected.');
  const connectedNumber = getConnectedWhatsAppNumber(snapshot);
  const sandbox = snapshot?.sandbox === true;
  const action = connectedNumber
    ? describeWhatsAppReadiness(snapshot, snapshot?.setupLinkUrl ?? null)
    : {
        tone: 'pending' as const,
        label: 'Connection needed',
        next: 'Open setup, connect a WhatsApp Business number, then refresh.',
        details: [
          'Sendero activates this channel only after the provider returns a real phone number.',
        ],
      };
  const blockedByMeta = action.tone === 'blocked';

  const refreshInstall = useCallback(async () => {
    try {
      const res = await fetch('/api/channels/whatsapp/install');
      const data = (await res.json()) as { install: InstallSnapshot | null };
      setSnapshot(data.install);
    } catch {
      /* ignore transient health failures */
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch('/api/channels/whatsapp/install');
        const data = (await res.json()) as { install: InstallSnapshot | null };
        if (!cancelled) setSnapshot(data.install);
      } catch {
        /* ignore transient health failures */
      }
    };
    refresh();
    const id = setInterval(refresh, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    if (sandbox) setSendTest(false);
  }, [sandbox]);

  const ready = useMemo(
    () =>
      Boolean(connectedNumber) && !blockedByMeta && (!sendTest || /^\+\d{6,}$/.test(testToE164)),
    [blockedByMeta, connectedNumber, sendTest, testToE164]
  );

  useEffect(() => {
    if (!ready) {
      setResolution(null);
      return;
    }
    setResolution({
      sendTest,
      testToE164: sendTest ? testToE164 : undefined,
      testBody: sendTest ? testBody : undefined,
    });
  }, [ready, sendTest, testToE164, testBody, setResolution]);

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_12%,transparent)] bg-[color:var(--surface-raised)] p-4">
        <p className="text-sm text-[color:var(--text)]">
          {connectedNumber ? (
            <>
              Going live on{' '}
              <strong className="font-mono text-[color:var(--ink)]">{connectedNumber}</strong>.
              Sendero will start routing inbound traveler messages here once you activate.
            </>
          ) : (
            <>
              No WhatsApp number is connected yet. Go back to{' '}
              <strong className="text-[color:var(--ink)]">Verify business number</strong>, open
              setup, then refresh once the number appears.
            </>
          )}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <ReadinessCallout action={action} />
        {sandbox ? null : (
          <button
            type="button"
            onClick={refreshInstall}
            className="inline-flex w-fit items-center gap-1.5 rounded-md border border-[color:color-mix(in_oklab,var(--ink)_16%,transparent)] px-3 py-2 text-[12px] text-[color:var(--text-dim)] transition-colors hover:border-[color:var(--ink)] hover:text-[color:var(--ink)]"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh readiness
          </button>
        )}
      </div>
      {sandbox ? null : <HealthGrid health={snapshot?.health ?? null} />}
      <label className="flex items-start gap-3 text-sm text-[color:var(--text)]">
        <input
          type="checkbox"
          checked={sendTest}
          disabled={!connectedNumber || blockedByMeta}
          onChange={e => setSendTest(e.target.checked)}
          className="mt-1 h-4 w-4 accent-[color:var(--accent-rose)] disabled:cursor-not-allowed disabled:opacity-50"
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-[color:var(--ink)]">Send a test message</span>
          <span className="text-[12px] text-[color:var(--text-dim)]">
            {blockedByMeta
              ? 'Meta is blocking messaging right now. Fix the readiness issue above, then refresh before testing.'
              : !connectedNumber
                ? 'Connect a WhatsApp Business number before sending a test.'
                : sandbox
                  ? 'Sandbox is already bound. Skip this unless you want to try an outbound smoke test.'
                  : 'Send yourself a quick WhatsApp message before activating the channel.'}
          </span>
        </span>
      </label>
      {connectedNumber && sendTest ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[200px_1fr]">
          <Field label="Your phone (E.164)" hint="e.g. +14155551234">
            <input
              type="tel"
              value={testToE164}
              placeholder="+14155551234"
              onChange={e => setTestToE164(e.target.value)}
              className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 font-mono text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            />
          </Field>
          <Field label="Message body" hint="Up to 1024 characters.">
            <textarea
              rows={2}
              maxLength={1024}
              value={testBody}
              onChange={e => setTestBody(e.target.value)}
              className="rounded-md border border-[color:color-mix(in_oklab,var(--ink)_18%,transparent)] bg-white px-3 py-2 text-sm text-[color:var(--ink)] focus:border-[color:var(--ink)] focus:outline-none"
            />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function getConnectedWhatsAppNumber(snapshot: InstallSnapshot | null): string | null {
  const display = snapshot?.displayPhoneNumber?.trim();
  if (!display || /pending/i.test(display)) return null;
  if (!snapshot?.phoneNumberId || snapshot.phoneNumberId === 'pending') return null;
  return display;
}

// ─── shared ──────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={FIELD_LABEL}>{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-[color:var(--text-faint)]">{hint}</span> : null}
    </div>
  );
}
