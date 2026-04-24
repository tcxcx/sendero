'use client';

/**
 * Full-screen Scalar API Reference, pointed at our live OpenAPI doc.
 *
 * We host this separately from the docs shell because Scalar takes
 * over the page body (scroll, sidebar, search) — nesting it inside
 * the Fumadocs DocsLayout causes double-sidebar UX.  The MDX at
 * /docs/api-reference deep-links here with a "Launch API reference"
 * button for humans; agents skip this and pull the raw spec at
 * /api/openapi.json.
 */

import '@scalar/api-reference-react/style.css';

import { ApiReferenceReact } from '@scalar/api-reference-react';

export default function ApiViewerPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>
      <ApiReferenceReact
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
