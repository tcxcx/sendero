'use client';

/**
 * Full-screen Scalar API Reference, pointed at our live OpenAPI doc.
 *
 * Hosted separately from the docs shell because Scalar takes over the
 * page body (scroll, sidebar, search) — nesting it inside the Fumadocs
 * DocsLayout causes double-sidebar UX. The MDX at /docs/api-reference
 * deep-links here with a "Launch API reference" button for humans;
 * agents skip this and pull the raw spec at /api/openapi.json.
 *
 * Loaded via `next/dynamic` with `ssr: false` because Scalar's bundle
 * evaluates zod v4 features (e.g. `.prefault()`) at module load. Our
 * workspace pins zod v3, so SSG would crash if Scalar were imported
 * statically. Client-only dynamic import keeps the build green.
 */

import dynamic from 'next/dynamic';

import '@scalar/api-reference-react/style.css';

const ScalarApiViewer = dynamic(
  () => import('@scalar/api-reference-react').then(mod => mod.ApiReferenceReact),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          minHeight: '100vh',
          background: '#fff',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#666',
        }}
      >
        Loading API reference…
      </div>
    ),
  }
);

export default function ApiViewerPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <ScalarApiViewer
        configuration={{
          url: '/api/openapi.json',
          theme: 'default',
          darkMode: false,
          hideClientButton: false,
          metaData: {
            title: 'Sendero Agent Tools API',
            description: 'Live OpenAPI 3.1 reference for every Sendero agent tool.',
          },
        }}
      />
    </div>
  );
}
