'use client';

/**
 * WhatsApp Business Embedded Signup button.
 *
 * Loads Meta's JS SDK, launches FB.login with `embedded_signup`, and
 * posts the returned short-lived `code` to
 * `/api/integrations/whatsapp/connect` for server-side token exchange.
 *
 * Requires env:
 *   NEXT_PUBLIC_META_APP_ID         — Meta app id
 *   NEXT_PUBLIC_META_ES_CONFIG_ID   — Embedded Signup configuration id
 *
 * Until Meta approves your app + Embedded Signup, this button is
 * hidden behind an "unavailable" state and the manual-paste form
 * below is the primary install path.
 */

import { useEffect, useState } from 'react';

declare global {
  interface Window {
    FB?: {
      init: (args: { appId: string; cookie: boolean; xfbml: boolean; version: string }) => void;
      login: (
        cb: (response: {
          authResponse?: { code?: string; accessToken?: string };
          status?: string;
        }) => void,
        opts: {
          config_id: string;
          response_type: string;
          override_default_response_type?: boolean;
          extras?: Record<string, unknown>;
        }
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

type Status = 'idle' | 'loading_sdk' | 'ready' | 'launching' | 'connecting' | 'done' | 'error';

export function EmbeddedSignupButton() {
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const appId = process.env.NEXT_PUBLIC_META_APP_ID;
  const configId = process.env.NEXT_PUBLIC_META_ES_CONFIG_ID;

  useEffect(() => {
    if (!appId || !configId) return;
    if (typeof window === 'undefined') return;
    if (window.FB) {
      setStatus('ready');
      return;
    }
    setStatus('loading_sdk');
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: 'v21.0' });
      setStatus('ready');
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      setStatus('error');
      setError('Failed to load Meta SDK');
    };
    document.body.appendChild(script);
  }, [appId, configId]);

  if (!appId || !configId) {
    return (
      <div style={disabledStyle}>
        <strong>Embedded Signup unavailable.</strong> Set <code>NEXT_PUBLIC_META_APP_ID</code> +{' '}
        <code>NEXT_PUBLIC_META_ES_CONFIG_ID</code> once your Meta app is approved for WhatsApp
        Business API.
      </div>
    );
  }

  const onClick = () => {
    if (!window.FB || status !== 'ready') return;
    setStatus('launching');
    window.FB.login(
      async response => {
        const code = response.authResponse?.code;
        if (!code) {
          setStatus('error');
          setError('Meta login did not return a code');
          return;
        }
        const tenantId = new URLSearchParams(window.location.search).get('tenantId');
        if (!tenantId) {
          setStatus('error');
          setError('Missing tenantId in URL — complete the manual form first to create the tenant');
          return;
        }
        setStatus('connecting');
        try {
          const res = await fetch('/api/integrations/whatsapp/connect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code, tenantId }),
          });
          const json = (await res.json()) as { ok?: boolean; error?: string; message?: string };
          if (!res.ok || !json.ok) {
            throw new Error(json.message ?? json.error ?? `HTTP ${res.status}`);
          }
          setStatus('done');
          window.location.href = `/onboarding/agency?tenantId=${tenantId}&installed=1`;
        } catch (err) {
          setStatus('error');
          setError(err instanceof Error ? err.message : String(err));
        }
      },
      {
        config_id: configId,
        response_type: 'code',
        override_default_response_type: true,
        extras: { feature: 'whatsapp_embedded_signup', version: 2 },
      }
    );
  };

  return (
    <>
      <button
        type="button"
        onClick={onClick}
        disabled={status !== 'ready'}
        style={btnStyle(status === 'ready')}
      >
        {status === 'loading_sdk' && 'Loading Meta SDK…'}
        {status === 'ready' && 'Continue with WhatsApp Business'}
        {status === 'launching' && 'Opening Meta login…'}
        {status === 'connecting' && 'Connecting Sendero…'}
        {status === 'done' && 'Connected'}
        {status === 'idle' && 'Continue with WhatsApp Business'}
        {status === 'error' && 'Try again'}
      </button>
      {error && <div style={errorStyle}>{error}</div>}
    </>
  );
}

function btnStyle(ready: boolean): React.CSSProperties {
  return {
    padding: '12px 18px',
    background: ready ? '#25D366' : '#cfcfcf',
    color: '#fff',
    border: 'none',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 12,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    cursor: ready ? 'pointer' : 'not-allowed',
  };
}

const disabledStyle: React.CSSProperties = {
  padding: '12px 14px',
  border: '1px solid #e6e6e6',
  color: '#8a8a8a',
  fontSize: 13,
};
const errorStyle: React.CSSProperties = {
  marginTop: 12,
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
  color: '#e34',
};
