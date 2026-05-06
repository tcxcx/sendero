#!/usr/bin/env bun
/**
 * Smoke: visual_aesthetic_scorer (Vertex multimodal → Gateway fallback).
 *
 *   bun run scripts/_smoke-aesthetic.ts
 *   bun run scripts/_smoke-aesthetic.ts cafe "Mameya Kakeru" \
 *     https://images.example.com/img1.jpg https://images.example.com/img2.jpg
 *
 * Default exercise scores three public Wikimedia café images.
 * Env: GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS_JSON
 *      OR AI_GATEWAY_API_KEY.
 */

import 'dotenv/config';

import { runVisualAestheticScorer } from '../packages/tools/src/anticipation/visual-aesthetic-scorer';
import type { ToolContext } from '../packages/tools/src/types';

const args = process.argv.slice(2);
const category = (args[0] ?? 'cafe') as
  | 'cafe'
  | 'restaurant'
  | 'bar'
  | 'hotel'
  | 'museum'
  | 'date_spot'
  | 'shop';
const placeName = args[1] ?? 'Sample Specialty Café';
const cliImages = args.slice(2);

// Default fallback images: three public Wikimedia photos of cafés.
const DEFAULT_IMAGES = [
  'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Cafe_with_a_terrace.jpg/1024px-Cafe_with_a_terrace.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/6/65/Coffee_house_interior.jpg/1024px-Coffee_house_interior.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d9/Espresso_cafe_minimal.jpg/1024px-Espresso_cafe_minimal.jpg',
];
const imageUrls = cliImages.length > 0 ? cliImages : DEFAULT_IMAGES;

const ctx: ToolContext = {
  traveler: { tenantId: 'org_smoke', userId: 'usr_smoke' },
  caller: { effectiveKeyType: 'sandbox', keyType: 'sandbox', scopes: ['*'] },
};

console.log(
  `\n› visual_aesthetic_scorer({ placeName: "${placeName}", category: "${category}", images: ${imageUrls.length} })\n`
);

const r = await runVisualAestheticScorer(
  {
    placeName,
    category,
    imageUrls,
    visitContext: 'date',
    locale: 'en-US',
  } as never,
  ctx
);

if (r.status !== 'ok') {
  console.log(`status: ${r.status}`);
  if (r.status === 'unavailable') console.log(`reason: ${r.reason}`);
  console.log(`message: ${r.message}`);
  process.exit(0);
}

const rep = r.report;
console.log(`via: ${r.via}`);
console.log(`aesthetic score: ${rep.aestheticScore.toFixed(2)}`);
console.log(`confidence:      ${rep.confidence}`);
console.log(`tags:            ${rep.visualTags.join(', ')}`);
if (rep.warnings.length) console.log(`warnings:        ${rep.warnings.join(' / ')}`);
if (rep.bestFor.length) console.log(`best for:        ${rep.bestFor.join(', ')}`);
if (rep.notFor.length) console.log(`not for:         ${rep.notFor.join(', ')}`);
console.log(`\n${r.message}`);
