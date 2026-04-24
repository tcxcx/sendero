import { resolvePublicOrigin } from './metadata';

export interface BuildClerkAllowedRedirectOriginsArgs {
  /** `NEXT_PUBLIC_APP_URL` — console app origin */
  appUrlEnv?: string | null;
  appOriginFallback?: string;
  /** `NEXT_PUBLIC_SITE_URL` — marketing site */
  siteUrlEnv?: string | null;
  siteOriginFallback?: string;
  /** `VERCEL_URL` host only (no scheme) */
  vercelUrl?: string | null;
  /** Comma-separated full origins, e.g. `https://staging.example.com` */
  extraOriginsEnv?: string | null;
  isDevelopment?: boolean;
  localAppPort?: number;
  localMarketingPort?: number;
}

/**
 * Origins Clerk may redirect to after OAuth / magic links. Include app + marketing
 * + Vercel preview + local dev hosts so cross-subdomain flows do not drop the return URL.
 */
export function buildClerkAllowedRedirectOrigins(
  args: BuildClerkAllowedRedirectOriginsArgs = {}
): string[] {
  const {
    appUrlEnv = process.env.NEXT_PUBLIC_APP_URL,
    appOriginFallback = 'https://www.sendero.travel',
    siteUrlEnv = process.env.NEXT_PUBLIC_SITE_URL,
    siteOriginFallback = 'https://sendero.travel',
    vercelUrl = process.env.VERCEL_URL,
    extraOriginsEnv = process.env.NEXT_PUBLIC_CLERK_ALLOWED_REDIRECT_ORIGINS,
    isDevelopment = process.env.NODE_ENV === 'development',
    localAppPort = 3010,
    localMarketingPort = 3011,
  } = args;

  const appOrigin = resolvePublicOrigin(appUrlEnv, appOriginFallback);
  const marketingOrigin = resolvePublicOrigin(siteUrlEnv, siteOriginFallback);
  const vercelDeploy = vercelUrl ? resolvePublicOrigin(`https://${vercelUrl}`, appOrigin) : null;

  const locals: string[] = [];
  if (isDevelopment) {
    for (const host of ['localhost', '127.0.0.1']) {
      locals.push(`http://${host}:${localAppPort}`, `http://${host}:${localMarketingPort}`);
    }
  }

  const extra = parseCommaOrigins(extraOriginsEnv);

  return Array.from(
    new Set(
      [appOrigin, marketingOrigin, vercelDeploy, ...locals, ...extra].filter((o): o is string =>
        Boolean(o?.trim())
      )
    )
  );
}

function parseCommaOrigins(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const s = part.trim();
    if (!s) continue;
    try {
      out.push(new URL(s).origin);
    } catch {
      // skip invalid entries
    }
  }
  return out;
}
