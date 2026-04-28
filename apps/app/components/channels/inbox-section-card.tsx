import type { ReactNode } from 'react';

/**
 * InboxSectionCard — shared shell for /dashboard/channels/{slack,whatsapp}/inbox
 * sections. Mirrors the Channel-routing card in `SlackConnectedPanel` so the
 * audit pages pair visually with the connected-workspace surface and don't
 * drift between channels.
 *
 *   <article class="sd-card-raised">
 *     <header padding 18px 24px, hairline bottom>
 *       <title (t-h3)>          <meta (t-meta)>
 *       <description (t-body)>
 *     </header>
 *     {children — typically a <table> with the audit-table look-and-feel}
 *   </article>
 */
export function InboxSectionCard({
  id,
  title,
  description,
  meta,
  children,
}: {
  id?: string;
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article
      className="sd-card-raised"
      style={{
        padding: 0,
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          padding: '18px 24px',
          borderBottom: '1px solid var(--hairline-color)',
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div className="t-h3" id={id}>
            {title}
          </div>
          {description ? (
            <div className="t-body ink-70" style={{ marginTop: 4, fontSize: 13 }}>
              {description}
            </div>
          ) : null}
        </div>
        {meta ? (
          <div className="t-meta" style={{ whiteSpace: 'nowrap' }}>
            {meta}
          </div>
        ) : null}
      </div>
      {children}
    </article>
  );
}
