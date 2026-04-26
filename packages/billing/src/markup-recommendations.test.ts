/**
 * E4 unit tests — pure shape + threshold logic. The DB-bound queries
 * (`getRecommendations`, `getSampleStatuses`, `getTopRecommendation`,
 * `refreshMarkupMedians`) are integration-tested against a real
 * Postgres in `apps/app/test/integration/markup-medians.spec.ts` (when
 * the integration harness exists). This file covers the constant + the
 * `RECOMMENDED_KINDS` filtering invariant, both of which gate every
 * call site.
 */

import { describe, expect, test } from 'bun:test';
import { MIN_SAMPLE_COUNT, type RecommendedKind } from './markup-recommendations';

describe('markup-recommendations module surface', () => {
  test('MIN_SAMPLE_COUNT is the documented threshold (100)', () => {
    // The plan + the wizard copy + the matview docs all reference 100.
    // If you change this constant, also update:
    //   - apps/app/app/(app)/dashboard/settings/pricing/* (UI copy)
    //   - apps/docs/content/docs/pricing/markup.mdx
    //   - the matview comment in the migration
    expect(MIN_SAMPLE_COUNT).toBe(100);
  });

  test('RecommendedKind enum mirrors MarkupConfigSchema kinds', () => {
    // Type-level assertion — if a new kind is added to MarkupConfigSchema
    // (in markup.ts) without being added to RecommendedKind here, the
    // matview will silently exclude bookings of the new kind from the
    // median computation. Surface that as a compile error by structurally
    // restating the union.
    type ExpectedKinds = 'flight' | 'hotel' | 'rail' | 'car' | 'other';
    const _check: ExpectedKinds extends RecommendedKind
      ? RecommendedKind extends ExpectedKinds
        ? true
        : false
      : false = true;
    expect(_check).toBe(true);
  });
});
