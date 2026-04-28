/**
 * Slack file fetcher → AgentMediaAttachment[].
 *
 * Slack sends inline file shares on the event envelope as `event.files[]`.
 * Each entry has metadata (id, name, mimetype, filetype, size,
 * url_private, …) but the actual bytes live behind `url_private` which
 * requires `Authorization: Bearer xoxb-…`. We fetch with the bot token,
 * base64-encode, and hand back `AgentMediaAttachment` so the agent
 * runtime can attach them as multimodal model parts (and nudge the LLM
 * toward `scan_document_auto`).
 *
 * Caps + filters mirror `@sendero/ocr` so a malformed Slack file never
 * blows past the OCR pipeline's contract:
 *   - mediaType must pass `isAllowedOcrMimeType`
 *   - byte size must be under `MAX_OCR_BYTES` (20 MiB)
 * Anything else is dropped with a console.warn — never throws, so a
 * single bad file can't tank a multi-attachment turn.
 */

import { isAllowedOcrMimeType, MAX_OCR_BYTES } from '@sendero/ocr';
import type { AgentMediaAttachment } from '@sendero/agent';

interface SlackFileShape {
  id?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  url_private_download?: string;
  is_external?: boolean;
}

function isSlackFile(x: unknown): x is SlackFileShape {
  return Boolean(x && typeof x === 'object');
}

// Hosts that are permitted to receive the bot token. Slack's CDN serves
// `url_private` from `files.slack.com` and frequently 302s to internal
// edges (`files-edge.slack.com`, plus first-party CDN subdomains). When
// the chain hops to S3 / generic CDN we must drop the Authorization
// header — undici forwards it across redirects by default and that's how
// xoxb tokens leak into bucket logs.
const SLACK_AUTHORIZED_HOST_SUFFIXES: readonly string[] = ['.slack.com', 'slack.com'];
const MAX_REDIRECT_HOPS = 4;

function isSlackHost(host: string): boolean {
  const h = host.toLowerCase();
  return SLACK_AUTHORIZED_HOST_SUFFIXES.some(s => h === s || h.endsWith(s));
}

/**
 * Manual redirect-following fetch that preserves the bot token only on
 * Slack-owned hosts. Mirrors the SSRF-guarded pattern in
 * `packages/tools/src/scan-document-auto.ts::fetchDocument`. Throws on
 * caps or malformed redirects so the caller's per-file try/catch logs
 * cleanly without a leaked token.
 */
async function fetchSlackFileSafe(
  initialUrl: string,
  botToken: string
): Promise<{ buf: ArrayBuffer; contentType: string | null } | { ok: false; reason: string }> {
  let currentUrl = initialUrl;
  let authHeaderActive = true;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    const u = new URL(currentUrl);
    if (u.protocol !== 'https:') {
      return { ok: false, reason: `non-https scheme: ${u.protocol}` };
    }
    // If the host isn't Slack's, drop the Authorization header for this
    // hop. Slack pre-signs S3 URLs as part of the redirect chain, so the
    // body still resolves without the token.
    const headers: Record<string, string> = {};
    if (authHeaderActive && isSlackHost(u.hostname)) {
      headers.Authorization = `Bearer ${botToken}`;
    } else {
      authHeaderActive = false;
    }
    const res = await fetch(currentUrl, { headers, redirect: 'manual' });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      if (!next) return { ok: false, reason: `redirect without Location at hop ${hop}` };
      // Resolve relative redirects; absolute Locations parse as-is.
      currentUrl = new URL(next, currentUrl).toString();
      continue;
    }
    if (!res.ok) return { ok: false, reason: `status ${res.status}` };
    const buf = await res.arrayBuffer();
    return { buf, contentType: res.headers.get('content-type') };
  }
  return { ok: false, reason: `exceeded ${MAX_REDIRECT_HOPS} redirect hops` };
}

export async function fetchSlackFilesAsAttachments(
  rawFiles: unknown[],
  botToken: string
): Promise<AgentMediaAttachment[]> {
  if (!botToken) {
    console.warn('[slack/media] missing botToken — skipping file fetch');
    return [];
  }
  const out: AgentMediaAttachment[] = [];
  for (const raw of rawFiles) {
    if (!isSlackFile(raw)) continue;
    const file = raw;
    const mediaType = file.mimetype ?? '';
    if (!isAllowedOcrMimeType(mediaType)) {
      console.warn('[slack/media] skipping unsupported mediaType', {
        id: file.id,
        mediaType,
      });
      continue;
    }
    if (typeof file.size === 'number' && file.size > MAX_OCR_BYTES) {
      console.warn('[slack/media] skipping oversize file', {
        id: file.id,
        size: file.size,
        cap: MAX_OCR_BYTES,
      });
      continue;
    }
    const fetchUrl = file.url_private_download ?? file.url_private;
    if (!fetchUrl) {
      console.warn('[slack/media] file has no url_private', { id: file.id });
      continue;
    }
    try {
      const result = await fetchSlackFileSafe(fetchUrl, botToken);
      if ('ok' in result && result.ok === false) {
        console.warn('[slack/media] fetch failed', { id: file.id, reason: result.reason });
        continue;
      }
      const { buf } = result as { buf: ArrayBuffer };
      if (buf.byteLength > MAX_OCR_BYTES) {
        console.warn('[slack/media] body exceeds cap after fetch', {
          id: file.id,
          bytes: buf.byteLength,
          cap: MAX_OCR_BYTES,
        });
        continue;
      }
      const base64 = Buffer.from(buf).toString('base64');
      const kind: AgentMediaAttachment['kind'] = mediaType.startsWith('image/')
        ? 'image'
        : 'document';
      out.push({
        kind,
        mediaType,
        data: base64,
        size: buf.byteLength,
        ...(file.name ? { filename: file.name } : {}),
      });
    } catch (err) {
      console.warn('[slack/media] fetch threw', {
        id: file.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  console.log('[slack/media] fetched', {
    requested: rawFiles.length,
    accepted: out.length,
  });
  return out;
}
