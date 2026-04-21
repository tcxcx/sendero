import { auth } from '@clerk/nextjs/server';
import { put } from '@vercel/blob';
import { prisma } from '@sendero/database';
import { NextResponse, type NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const { orgId, has } = await auth();
  if (!orgId) return NextResponse.json({ error: 'no_org' }, { status: 401 });
  if (!has({ role: 'org:admin' }))
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const tenant = await prisma.tenant.findUnique({
    where: { clerkOrgId: orgId },
    select: { id: true, billingTier: true },
  });
  if (!tenant) return NextResponse.json({ error: 'tenant_not_found' }, { status: 404 });
  if (!['business', 'enterprise'].includes(tenant.billingTier)) {
    return NextResponse.json({ error: 'tier_not_allowed' }, { status: 403 });
  }

  const formData = await req.formData();
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: 'file_required' }, { status: 400 });
  }

  const ext = file.name.split('.').pop()?.toLowerCase() ?? 'png';
  const blob = await put(`tenants/${tenant.id}/logo.${ext}`, file, {
    access: 'public',
    addRandomSuffix: false,
    contentType: file.type || undefined,
  });

  await prisma.tenant.update({ where: { id: tenant.id }, data: { brandLogoUrl: blob.url } });
  return NextResponse.json({ url: blob.url });
}
