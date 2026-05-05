/**
 * trip-ancillaries pure-function tests. No Prisma — these helpers are
 * deliberately deps-free so book_flight, select_seat, and add_baggage
 * can compose them without a circular dep on the DB layer.
 */

import { describe, expect, test } from 'bun:test';

import {
  mergeServices,
  readPendingAncillaries,
  stageBag,
  stageSeat,
  stagedAncillariesToServices,
  writePendingAncillaries,
} from './trip-ancillaries';

describe('readPendingAncillaries', () => {
  test('returns empty arrays when metadata is null', () => {
    const r = readPendingAncillaries(null, 'off_1');
    expect(r).toEqual({ seats: [], bags: [] });
  });

  test('returns empty arrays when offer is unknown', () => {
    const r = readPendingAncillaries(
      { pendingAncillaries: { flight: { off_other: { seats: [], bags: [] } } } } as never,
      'off_1'
    );
    expect(r).toEqual({ seats: [], bags: [] });
  });

  test('reads stored entry', () => {
    const r = readPendingAncillaries(
      {
        pendingAncillaries: {
          flight: {
            off_1: {
              seats: [{ passengerId: 'p', serviceId: 's', stagedAt: 'x' }],
              bags: [],
            },
          },
        },
      } as never,
      'off_1'
    );
    expect(r.seats).toHaveLength(1);
  });
});

describe('stageSeat', () => {
  test('adds new seat', () => {
    const next = stageSeat(
      { seats: [], bags: [] },
      { passengerId: 'p1', serviceId: 's1', designator: '12A', stagedAt: 'x' }
    );
    expect(next.seats).toHaveLength(1);
  });

  test('replaces existing (passenger, designator)', () => {
    const start = stageSeat(
      { seats: [], bags: [] },
      { passengerId: 'p1', serviceId: 'old', designator: '12A', stagedAt: 'x' }
    );
    const next = stageSeat(start, {
      passengerId: 'p1',
      serviceId: 'new',
      designator: '12A',
      stagedAt: 'y',
    });
    expect(next.seats).toHaveLength(1);
    expect(next.seats[0]?.serviceId).toBe('new');
  });

  test('keeps separate seats for separate passengers at same designator slot', () => {
    const start = stageSeat(
      { seats: [], bags: [] },
      { passengerId: 'p1', serviceId: 's1', designator: '12A', stagedAt: 'x' }
    );
    const next = stageSeat(start, {
      passengerId: 'p2',
      serviceId: 's2',
      designator: '12A',
      stagedAt: 'y',
    });
    expect(next.seats).toHaveLength(2);
  });
});

describe('stageBag', () => {
  test('replaces same (passenger, serviceId)', () => {
    const start = stageBag(
      { seats: [], bags: [] },
      { passengerId: 'p1', serviceId: 'b1', quantity: 1, stagedAt: 'x' }
    );
    const next = stageBag(start, {
      passengerId: 'p1',
      serviceId: 'b1',
      quantity: 2,
      stagedAt: 'y',
    });
    expect(next.bags).toHaveLength(1);
    expect(next.bags[0]?.quantity).toBe(2);
  });
});

describe('writePendingAncillaries', () => {
  test('preserves unrelated metadata + other offers', () => {
    const out = writePendingAncillaries(
      {
        unrelated: 'keep',
        pendingAncillaries: {
          flight: {
            off_other: {
              seats: [],
              bags: [{ passengerId: 'p', serviceId: 'b', quantity: 1, stagedAt: 'x' }],
            },
          },
        },
      } as never,
      'off_1',
      { seats: [{ passengerId: 'p', serviceId: 's', stagedAt: 'y' }], bags: [] }
    );
    const obj = out as unknown as Record<string, unknown> & {
      pendingAncillaries: { flight: Record<string, unknown> };
    };
    expect(obj.unrelated).toBe('keep');
    expect(Object.keys(obj.pendingAncillaries.flight).sort()).toEqual(['off_1', 'off_other']);
  });
});

describe('stagedAncillariesToServices', () => {
  test('seats become qty=1, bags use their quantity', () => {
    const services = stagedAncillariesToServices({
      seats: [
        { passengerId: 'p', serviceId: 'sea_a', stagedAt: 'x' },
        { passengerId: 'p', serviceId: 'sea_b', stagedAt: 'x' },
      ],
      bags: [{ passengerId: 'p', serviceId: 'bag_a', quantity: 2, stagedAt: 'x' }],
    });
    expect(services).toEqual([
      { id: 'sea_a', quantity: 1 },
      { id: 'sea_b', quantity: 1 },
      { id: 'bag_a', quantity: 2 },
    ]);
  });
});

describe('mergeServices', () => {
  test('explicit-only when nothing is staged', () => {
    const out = mergeServices([{ id: 's_explicit', quantity: 1 }], { seats: [], bags: [] });
    expect(out).toEqual([{ id: 's_explicit', quantity: 1 }]);
  });

  test('staged-only when explicit is empty/undefined', () => {
    const out = mergeServices(undefined, {
      seats: [{ passengerId: 'p', serviceId: 's_staged', stagedAt: 'x' }],
      bags: [],
    });
    expect(out).toEqual([{ id: 's_staged', quantity: 1 }]);
  });

  test('explicit wins on id conflict, staged merges in for new ids', () => {
    const out = mergeServices([{ id: 'shared', quantity: 5 }], {
      seats: [{ passengerId: 'p', serviceId: 'shared', stagedAt: 'x' }],
      bags: [{ passengerId: 'p', serviceId: 'staged_only', quantity: 2, stagedAt: 'x' }],
    });
    expect(out).toEqual([
      { id: 'shared', quantity: 5 },
      { id: 'staged_only', quantity: 2 },
    ]);
  });
});
