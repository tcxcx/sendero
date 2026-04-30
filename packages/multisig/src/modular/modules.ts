/**
 * Module type tags used by security tiers + templates.
 *
 * Ported from desk-v1 (Fantasmita LLC, internal reuse for Sendero).
 * Minimal subset — the Sendero port skips the DCW-SDK install paths for
 * SpendingLimit / SessionKey / MultiOwner modules (none of those Circle
 * modules exist yet; desk-v1 guarded behind feature flags that are always
 * `false` in this repo).
 */

export type ModuleType = 'weighted_multisig' | 'address_book';
