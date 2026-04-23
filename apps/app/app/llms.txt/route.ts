import { buildLlmsResponse, buildSenderoAppLlms } from '@sendero/llms';
import { resolvePublicOrigin } from '@sendero/seo';

export const dynamic = 'force-static';

const appOrigin = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_APP_URL,
  'https://www.sendero.travel'
);
const marketingOrigin = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SITE_URL,
  'https://sendero.travel'
);
const helpOrigin = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_HELP_URL,
  'https://help.sendero.travel'
);
const docsOrigin = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_DOCS_URL,
  'https://docs.sendero.travel'
);
const edgeOrigin = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_SENDERO_EDGE_URL,
  'https://edge.sendero.travel'
);

export function GET() {
  return buildLlmsResponse(
    buildSenderoAppLlms({
      appOrigin,
      marketingOrigin,
      helpOrigin,
      docsOrigin,
      edgeOrigin,
    })
  );
}
