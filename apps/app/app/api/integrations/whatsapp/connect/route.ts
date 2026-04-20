/**
 * POST /api/integrations/whatsapp/connect
 *
 * WhatsApp Business Embedded Signup callback. The client-side flow
 * (Meta's JS SDK + FB.login with embedded_signup config) returns a
 * short-lived `code`. We exchange it for:
 *   1. A system-user access_token scoped to the agency's WABA
 *   2. The phone_number_id Sendero should route inbound messages to
 *
 * This replaces the manual paste in /onboarding/agency for agencies
 * whose Meta app review has been approved. Uses Meta Graph API v21.0.
 *
 * Env:
 *   META_APP_ID                — the Sendero Meta app id
 *   META_APP_SECRET            — the Sendero Meta app secret
 *   META_GRAPH_API_VERSION     — defaults to v21.0
 */

import { type NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@sendero/database';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const BodySchema = z.object({
  code: z.string().min(16),
  tenantId: z.string().min(1),
  wabaId: z.string().min(1).optional(),
});

export async function POST(req: NextRequest) {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  if (!appId || !appSecret) {
    return NextResponse.json(
      {
        error: 'meta_not_configured',
        message: 'META_APP_ID + META_APP_SECRET required for WhatsApp Embedded Signup.',
      },
      { status: 503 }
    );
  }

  let body: z.infer<typeof BodySchema>;
  try {
    body = BodySchema.parse(await req.json());
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_input', issues: err instanceof z.ZodError ? err.issues : [] },
      { status: 400 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: body.tenantId },
    select: { id: true, metadata: true },
  });
  if (!tenant) return NextResponse.json({ error: 'unknown_tenant' }, { status: 404 });

  const graphVersion = process.env.META_GRAPH_API_VERSION || 'v21.0';

  try {
    // 1. Exchange code → access_token (business system-user token)
    const tokenUrl = new URL(`https://graph.facebook.com/${graphVersion}/oauth/access_token`);
    tokenUrl.searchParams.set('client_id', appId);
    tokenUrl.searchParams.set('client_secret', appSecret);
    tokenUrl.searchParams.set('code', body.code);
    const tokenRes = await fetch(tokenUrl, { method: 'GET' });
    const tokenJson = (await tokenRes.json()) as {
      access_token?: string;
      token_type?: string;
      expires_in?: number;
      error?: { message: string; type: string };
    };
    if (!tokenRes.ok || !tokenJson.access_token) {
      return NextResponse.json(
        {
          error: 'meta_token_exchange_failed',
          detail: tokenJson.error?.message ?? 'unknown',
        },
        { status: 502 }
      );
    }
    const accessToken = tokenJson.access_token;

    // 2. Resolve the WABA + phone_number_id for this tenant.
    //    If wabaId was passed explicitly, fetch its phone numbers directly;
    //    otherwise list the first WABA linked to the system user.
    let wabaId = body.wabaId;
    if (!wabaId) {
      const wabaListRes = await fetch(
        `https://graph.facebook.com/${graphVersion}/me/owned_whatsapp_business_accounts`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      const wabaListJson = (await wabaListRes.json()) as {
        data?: Array<{ id: string; name?: string }>;
      };
      wabaId = wabaListJson.data?.[0]?.id;
    }
    if (!wabaId) {
      return NextResponse.json({ error: 'no_waba_found_on_token' }, { status: 409 });
    }

    const phonesRes = await fetch(
      `https://graph.facebook.com/${graphVersion}/${wabaId}/phone_numbers`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    );
    const phonesJson = (await phonesRes.json()) as {
      data?: Array<{
        id: string;
        display_phone_number: string;
        verified_name?: string;
      }>;
    };
    const firstPhone = phonesJson.data?.[0];
    if (!firstPhone) {
      return NextResponse.json({ error: 'no_phone_on_waba' }, { status: 409 });
    }

    // 3. Persist — the token + ids go into Tenant.metadata so the WA
    //    webhook route can look them up. Phase 8 will move secrets to a
    //    dedicated encrypted column.
    const priorMeta = (tenant.metadata as Record<string, unknown> | null) ?? {};
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        metadata: {
          ...priorMeta,
          kind: 'agency',
          whatsappAccessToken: accessToken,
          whatsappPhoneNumberId: firstPhone.id,
          whatsappDisplayPhoneNumber: firstPhone.display_phone_number,
          whatsappBusinessAccountId: wabaId,
          whatsappConnectedAt: new Date().toISOString(),
        } as object,
      },
    });

    return NextResponse.json({
      ok: true,
      phoneNumberId: firstPhone.id,
      displayPhoneNumber: firstPhone.display_phone_number,
      verifiedName: firstPhone.verified_name,
      wabaId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[waba/connect] failed:', msg);
    return NextResponse.json({ error: 'waba_connect_failed', message: msg }, { status: 500 });
  }
}
