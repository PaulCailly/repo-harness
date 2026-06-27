/**
 * OWNED FILE — gatekit scaffolds this once; edit freely. This is the
 * compliance control register: the bridge between the deterministic checks
 * (analyze.mjs / config.mjs) and the privacy frameworks your project is held
 * to. Fill in real controls for your project; delete the placeholder below.
 *
 * The engine (index.mjs) imports exactly three names from this file:
 *   - `controls`         — array of control objects (see shape below)
 *   - `standardsCovered` — array of framework names (for the report header)
 *   - `subProcessors`    — array of sub-processor records (for register completeness)
 *
 * Control kinds:
 *   'rule'       — automated: passes when the engine reports zero findings of
 *                  the listed `evidence` rules across the scan.
 *   'structural' — automated: passes when a `structuralChecks` entry in
 *                  config.mjs finds its required string in the target file.
 *   'manual'     — attestation: cannot be proven from source (a signed DPA, a
 *                  retention job, a data-export endpoint). Record the latest
 *                  human attestation in `status`: 'attested' | 'documented' |
 *                  'partial' | 'gap'.
 */

export const controls = [
  // ── Egress governance ────────────────────────────────────────────────────────
  {
    id: 'EGRESS-01',
    family: 'Egress governance',
    title: 'All network destinations are allowlisted with a documented data category',
    kind: 'rule',
    evidence: ['unsanctioned-egress'],
    standards: {
      gdpr: ['Art. 30 (records of processing)', 'Art. 44 (transfers)'],
      iso27701: ['§7.2.6 (sub-processors)', '§7.5 (records)'],
    },
  },
  // ← Add your real controls here: secrets, minimisation, consent, data-subject rights, etc.
];

/** Distinct frameworks covered — shown in the report header and KPIs. */
export const standardsCovered = ['GDPR'];

/**
 * The authoritative sub-processor register (GDPR Art. 28 / Art. 30).
 * The index.mjs register-completeness check uses this to verify every vendor
 * here is covered by an entry in config.mjs `egressAllowlist`. Set
 * `appLevelEgress: false` for platform vendors reached only indirectly (e.g.
 * your hosting provider) — they are exempt from the allowlist check.
 *
 * Example entry shape:
 *   {
 *     vendor: 'Anthropic',
 *     appLevelEgress: true,
 *     host: 'api.anthropic.com',
 *     purpose: 'LLM inference',
 *     region: 'US (SCCs)',
 *     dpa: 'https://www.anthropic.com/legal/commercial-terms',
 *     signedAt: null,
 *   }
 */
export const subProcessors = [
  // ← Add your sub-processors here to complete the Art. 30 register.
];
