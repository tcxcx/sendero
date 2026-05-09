import { prisma } from '@sendero/database';
import type { WhatsAppSendEvent } from '@sendero/whatsapp';

export async function logWhatsAppToolOutbound(args: {
  tenantId: string;
  phoneNumberId: string;
  traceId?: string;
  event: WhatsAppSendEvent;
}): Promise<void> {
  try {
    await prisma.whatsAppOutboundMessage.create({
      data: {
        tenantId: args.tenantId,
        wamid: args.event.wamid,
        phoneNumberId: args.phoneNumberId,
        recipientId: args.event.recipientId,
        kind: args.event.kind,
        source: 'kapso_tool_call',
        ...(args.event.templateName ? { templateName: args.event.templateName } : {}),
        ...(args.event.preview ? { preview: args.event.preview } : {}),
        ...(args.traceId ? { traceId: args.traceId } : {}),
        deliveryStatus: 'sent',
      },
    });
  } catch (err) {
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      return;
    }
    console.error('[tools/whatsapp-audit] outbound insert failed', {
      tenantId: args.tenantId,
      wamid: args.event.wamid,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
