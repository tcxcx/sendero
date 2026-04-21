// packages/invoicing/src/templates/html/components/note.tsx
import type { TemplateProps } from '../../types';

export function Note({ template }: TemplateProps) {
  const body = (template as { note_body?: string }).note_body?.trim();
  if (!body) return null;
  return (
    <div
      style={{
        marginTop: 32,
        paddingTop: 24,
        borderTop: '1px solid #e9e3da',
      }}
    >
      <span
        style={{
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 11,
          color: '#555',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          display: 'block',
          marginBottom: 8,
        }}
      >
        {template.note_label}
      </span>
      <p
        style={{
          fontSize: 13,
          color: '#0b0b0b',
          margin: 0,
          lineHeight: 1.5,
        }}
      >
        {body}
      </p>
    </div>
  );
}
