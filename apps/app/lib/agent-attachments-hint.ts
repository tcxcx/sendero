/**
 * Detect attachment parts on the latest user UIMessage and produce a
 * hint string that nudges the agent toward `scan_document_auto`.
 *
 * The AI SDK passes file parts to the model natively, so the model can
 * "see" the image. But it doesn't always know what to *do* — without
 * this nudge it tends to describe the image in prose. The hint sets
 * the expectation: image arrived → call `scan_document_auto` first to
 * detect kind + extract structured fields, then act on the extraction.
 *
 * Returns `undefined` when there are no attachments so the prompt
 * builder skips the section entirely.
 */

type MaybePart = {
  type?: string;
  mediaType?: string;
  url?: string;
  filename?: string;
};

type MaybeMessage = {
  role?: string;
  parts?: MaybePart[];
};

const MIME_TO_KIND_HINT: ReadonlyArray<{ test: (mt: string) => boolean; label: string }> = [
  { test: mt => mt.startsWith('image/'), label: 'image' },
  { test: mt => mt === 'application/pdf', label: 'PDF' },
];

export function detectAttachmentsHint(messages: unknown): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  const last = [...messages].reverse().find((m): m is MaybeMessage => {
    const msg = m as MaybeMessage;
    return msg?.role === 'user' && Array.isArray(msg.parts);
  });
  if (!last?.parts) return undefined;

  const fileParts = last.parts.filter(
    p => p?.type === 'file' && typeof p.mediaType === 'string' && p.mediaType.length > 0
  );
  if (fileParts.length === 0) return undefined;

  const lines = fileParts.map((p, i) => {
    const mt = p.mediaType ?? 'application/octet-stream';
    const label = MIME_TO_KIND_HINT.find(m => m.test(mt))?.label ?? 'file';
    const name = p.filename ? ` (${p.filename})` : '';
    return `  ${i + 1}. ${label} · ${mt}${name}`;
  });

  return [
    `The user attached ${fileParts.length} file${fileParts.length === 1 ? '' : 's'}:`,
    ...lines,
    '',
    'Default behavior:',
    "- Call `scan_document_auto` on each attachment to detect kind (passport / invoice / receipt / boarding pass) and extract structured fields. The tool runs Gemini classification + extraction in one shot. Pass the file via the `data` + `mediaType` fields when no URL is available, or `documentUrl` when it is.",
    "- If `detectedKind === 'id_document'` and the user is signed in, the tool also writes to their PassportVault automatically — no extra call needed.",
    "- If `detectedKind === 'unknown'` or `classifierConfidence < 0.55`, ask the user to clarify what the document is rather than guessing.",
    "- Never describe the image in prose without first running `scan_document_auto`. The user did not attach the file just to chat about it.",
  ].join('\n');
}
