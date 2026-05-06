/**
 * POST /api/groups/[id]/broadcast — operator-side broadcast trigger.
 *
 * Auth: Clerk session with active org (operator on a tenant). Resolves
 * the tenant from the org id, refuses cross-tenant access. Calls
 * `broadcast_to_group_trip` with the resolved binding.
 *
 * Templates pre-approved in Kapso/Meta. The body carries
 * `templateName` (Sendero-side label) which we map to the Meta
 * template id at the call site. v1 uses a static catalog; v2 will
 * pull from Kapso /whatsapp/templates filtered to APPROVED.
 */

import { NextResponse, type NextRequest } from 'next/server';

import { auth } from '@clerk/nextjs/server';

import { prisma } from '@sendero/database';
import { broadcastToGroupTripTool } from '@sendero/tools';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Sendero-side template name → Meta template id. Static for v1; the
// Meta ids are stamped at template-approval time (different per env).
// Empty string = template not yet approved in this env, route refuses.
const TEMPLATE_ID_MAP: Record<string, string> = {
  group_meeting_point: process.env.WHATSAPP_TPL_GROUP_MEETING_POINT ?? '',
  group_change_alert: process.env.WHATSAPP_TPL_GROUP_CHANGE_ALERT ?? '',
  group_day_of_reminder: process.env.WHATSAPP_TPL_GROUP_DAY_OF_REMINDER ?? '',
  group_seat_open: process.env.WHATSAPP_TPL_GROUP_SEAT_OPEN ?? '',
  group_completion: process.env.WHATSAPP_TPL_GROUP_COMPLETION ?? '',
};

interface BroadcastRequestBody {
  templateName?: string;
  bodyParams?: string[];
  audience?: 'claimed' | 'all' | 'invited';
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: groupTripId } = await params;

  const session = await auth();
  if (!session?.userId || !session.orgId) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized', message: 'Sign in with an active workspace.' },
      { status: 401 }
    );
  }

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: session.orgId },
    select: { id: true },
  });
  if (!tenant) {
    return NextResponse.json({ ok: false, error: 'tenant_not_found' }, { status: 404 });
  }

  let body: BroadcastRequestBody;
  try {
    body = (await req.json()) as BroadcastRequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid_json' }, { status: 400 });
  }

  const templateName = body.templateName?.trim();
  if (!templateName || !(templateName in TEMPLATE_ID_MAP)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'unknown_template',
        message: `Template ${templateName} is not registered.`,
      },
      { status: 400 }
    );
  }
  const whatsappTemplateId = TEMPLATE_ID_MAP[templateName];
  if (!whatsappTemplateId) {
    return NextResponse.json(
      {
        ok: false,
        error: 'template_not_approved',
        message: `Template ${templateName} has no approved Meta id in this env. Submit + approve before broadcasting.`,
      },
      { status: 409 }
    );
  }

  try {
    const result = await broadcastToGroupTripTool.handler(
      {
        groupTripId,
        templateName,
        whatsappTemplateId,
        bodyParams: body.bodyParams ?? [],
        audience: body.audience ?? 'claimed',
      },
      {
        traveler: {
          userId: session.userId,
          tenantId: tenant.id,
        },
      }
    );
    return NextResponse.json({
      ok: true,
      broadcastId: result.broadcastId,
      recipientCount: result.recipientCount,
      skipped: result.skipped,
      status: result.status,
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: 'broadcast_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 400 }
    );
  }
}
