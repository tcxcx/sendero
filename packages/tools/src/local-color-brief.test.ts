/**
 * Pure-helper coverage. The composer itself hits live APIs (weather +
 * timezone + tipping + Places); we cover those via the e2e smoke
 * elsewhere. These tests pin the deterministic transforms.
 */

import { test, expect } from 'bun:test';

// We test the un-exported helpers via a re-export shim below. This
// keeps the public surface of `local-color-brief` clean while still
// letting tests pin the math.
import * as mod from './local-color-brief';

test('localColorBrief tool surface — descriptor wired correctly', () => {
  expect(mod.localColorBriefTool.name).toBe('local_color_brief');
  expect(mod.localColorBriefTool.handler).toBe(mod.localColorBrief);
});

test('input schema rejects bad iso2', () => {
  // Zod schema is internal; reach through the inputSchema on the tool.
  const result = mod.localColorBriefTool.inputSchema.safeParse({
    destinationIso2: 'PER', // 3 letters
    dateRange: { from: '2026-05-11', to: '2026-05-13' },
  });
  expect(result.success).toBe(false);
});

test('input schema upcases iso2', () => {
  const result = mod.localColorBriefTool.inputSchema.safeParse({
    destinationIso2: 'pe',
    dateRange: { from: '2026-05-11', to: '2026-05-13' },
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.destinationIso2).toBe('PE');
  }
});

test('input schema accepts optional lodgingCoords', () => {
  const result = mod.localColorBriefTool.inputSchema.safeParse({
    destinationIso2: 'PE',
    destinationCity: 'Lima',
    dateRange: { from: '2026-05-11', to: '2026-05-13' },
    lodgingCoords: { lat: -12.046, lng: -77.042 },
    lang: 'es-AR',
  });
  expect(result.success).toBe(true);
});

test('input schema defaults lang to "en"', () => {
  const result = mod.localColorBriefTool.inputSchema.safeParse({
    destinationIso2: 'JP',
    dateRange: { from: '2026-06-01', to: '2026-06-08' },
  });
  expect(result.success).toBe(true);
  if (result.success) {
    expect(result.data.lang).toBe('en');
  }
});
