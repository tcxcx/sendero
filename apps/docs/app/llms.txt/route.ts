import { buildLlmsResponse, buildSenderoDocsLlms } from '@sendero/llms';

export const dynamic = 'force-static';

const docsOrigin = process.env.NEXT_PUBLIC_DOCS_URL ?? 'https://docs.sendero.travel';

export function GET() {
  return buildLlmsResponse(
    buildSenderoDocsLlms({
      docsOrigin,
      appOrigin: process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.sendero.travel',
      marketingOrigin: process.env.NEXT_PUBLIC_SITE_URL ?? 'https://sendero.travel',
      helpOrigin: process.env.NEXT_PUBLIC_HELP_URL ?? 'https://help.sendero.travel',
      edgeOrigin: process.env.NEXT_PUBLIC_SENDERO_EDGE_URL ?? 'https://edge.sendero.travel',
    })
  );
}
