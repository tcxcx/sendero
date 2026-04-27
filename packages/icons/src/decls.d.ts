/**
 * Static-asset module declarations. Next.js apps get these from
 * `next-env.d.ts` automatically; workspace packages don't, so the
 * package needs its own to compile when `tsc --noEmit` runs.
 *
 * The `StaticImageData` shape mirrors next/image's runtime contract:
 * `{ src, width, height, blurDataURL? }`.
 */
declare module '*.png' {
  const value: import('next/image').StaticImageData;
  export default value;
}
declare module '*.webp' {
  const value: import('next/image').StaticImageData;
  export default value;
}
declare module '*.jpg' {
  const value: import('next/image').StaticImageData;
  export default value;
}
declare module '*.svg' {
  const value: string;
  export default value;
}
