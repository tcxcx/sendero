import { notFound } from 'next/navigation';
import { DocsPage, DocsBody, DocsDescription, DocsTitle } from 'fumadocs-ui/page';
import type { Metadata } from 'next';
import { resolvePublicOrigin } from '@sendero/seo';
import { buildOgImageUrl } from '@sendero/seo/og';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';

const DOCS_URL = resolvePublicOrigin(
  process.env.NEXT_PUBLIC_DOCS_URL,
  'https://docs.sendero.travel'
);

export default async function Page(props: { params: Promise<{ slug?: string[] }> }) {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) notFound();

  const MDX = page.data.body;

  return (
    <DocsPage toc={page.data.toc} full={page.data.full}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        {/*
          getMDXComponents threads in `<Tabs>` + `<Tab>` so MDX pages
          (e.g., /docs/mcp-integration) can render per-client install
          tabs without per-file imports.
        */}
        <MDX components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: {
  params: Promise<{ slug?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);
  if (!page) return {};

  // Per-page Satori OG: title + description from the MDX frontmatter
  // get baked into a parchment-and-vermillion card so each docs URL
  // unfurls into its own image instead of the generic site card.
  const ogImage = buildOgImageUrl(DOCS_URL, {
    title: page.data.title,
    description: page.data.description,
    eyebrow: 'sendero · docs',
  });
  const url = `${DOCS_URL}${page.url}`;

  return {
    title: page.data.title,
    description: page.data.description,
    openGraph: {
      title: page.data.title,
      description: page.data.description,
      url,
      siteName: 'Sendero Developer Docs',
      type: 'article',
      images: [{ url: ogImage, width: 1200, height: 630, alt: page.data.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: page.data.title,
      description: page.data.description,
      images: [ogImage],
    },
  };
}
