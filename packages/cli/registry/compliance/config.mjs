/**
 * OWNED FILE — gatekit scaffolds this once; edit freely. Fill in your
 * real egress allowlist, server scope, secrets, and analytics seam. The engine
 * (analyze.mjs / index.mjs) is managed by gatekit and updated via
 * `npx gatekit update` — do NOT edit those files here.
 *
 * Privacy-compliance analyzer configuration — the machine-readable privacy
 * policy for this repository. Every threshold, allowlist, and penalty lives
 * here so the gate is transparent and tunable.
 *
 * Keeping the policy as data (not scattered `if`s) is itself the GDPR Art. 30 /
 * ISO 27701 "records of processing & sub-processors" artefact — see controls.mjs.
 *
 * Two severity tiers:
 *   - `violation` — an undeclared egress host, a server secret bundled to the
 *     browser, a hardcoded credential, or telemetry outside the analytics seam.
 *     These FAIL the gate (index.mjs exits non-zero). Pass `--no-fail` to run
 *     informational-only while the allowlist is being settled.
 *   - `finding` (high/medium/low) — tracked privacy risk/drift that does not
 *     break the guarantee. Scored, surfaced in the report, never blocks.
 */

export const config = {
  /** Files to scan / skip (matched against the repo-relative POSIX path). */
  include: /\.(ts|tsx|mjs|js)$/,

  /**
   * Skipped paths. Adjust for your project layout. The defaults skip build
   * artefacts, test files, type declarations, and common generated directories.
   */
  exclude:
    /(\.test\.|\.spec\.|\.stories\.|\.d\.ts$|node_modules\/|\/dist\/|\/\.next\/|\/build\/|\/coverage\/|\/__tests__\/|\/tests\/|\/test\/)/,

  /**
   * Roots scanned for egress/secret leaks. Set to your actively-deployed
   * source directories — the engine walks them recursively.
   */
  roots: ['src'],

  /**
   * Hosts that are never an egress target even when they appear as a URL
   * literal: XML/JSON-schema namespaces, loopback/example placeholders, and
   * the product's own first-party origin. Add your own domain here.
   */
  egressIgnoreHosts: [
    // spec namespaces / placeholders
    'www.w3.org', 'w3.org', 'schema.org', 'json-schema.org',
    'localhost', '127.0.0.1', '0.0.0.0', 'example.com', 'example.org',
    // placeholder base used only to parse a relative path via `new URL(path, base)`
    'n',
  ],

  /**
   * A file is "server" code (Node/serverless — secrets are safe, third parties
   * may be contacted directly) when its path matches this regex.
   *
   * Examples:
   *   /^(src\/server\/|src\/api\/|.*\.server\.)/ — Next.js / Vite convention
   *   /^(api\/|server\/)/ — plain Node project
   *
   * Tune this so only browser-bundled files are treated as "client" scope.
   */
  serverScope: /^(src\/server\/|src\/api\/|.*\.server\.)/,

  /**
   * The egress allowlist — the COMPLETE set of network destinations data may
   * reach, and under what terms. This IS the sub-processor / data-flow register
   * (GDPR Art. 30, ISO 27701 §7.2.6). Any http(s) host found in source that is
   * not listed here (and not ignored above) is an `unsanctioned-egress`
   * violation.
   *
   *   scope: 'server' — must only be contacted from server code. Seeing the
   *     host in client code is a `server-host-in-client` finding.
   *   scope: 'client' — allowed from the browser. `clientSeverity` grades the
   *     residual privacy risk (IP exposure, etc.).
   *
   * Fill this in with every real destination your codebase contacts.
   *
   * Example entry shape:
   *   {
   *     host: 'api.example.com',
   *     service: 'Example API (what it is used for)',
   *     scope: 'server',
   *     data: 'what personal/sensitive data reaches this host',
   *     lawfulBasis: 'contract / consent / legitimate interest',
   *     note: 'any relevant caveats',
   *   }
   */
  egressAllowlist: [
    // ← Add your destinations here.
  ],

  /**
   * Env var names that must NEVER be referenced from client (browser-bundled)
   * code. A reference outside server scope is a `server-secret-in-client`
   * violation.
   *
   * Example: ['ANTHROPIC_API_KEY', 'DATABASE_URL', 'STRIPE_SECRET_KEY']
   */
  serverOnlySecrets: [
    // ← Add your server-only env var names here.
  ],

  /**
   * Client env reads are only safe when the bundler treats them as public.
   * Adjust the prefix for your framework:
   *   Next.js: /^NEXT_PUBLIC_/
   *   Vite:    /^VITE_/
   *   CRA:     /^REACT_APP_/
   */
  publicEnvPrefix: /^VITE_/,
  publicEnvNames: new Set(['NODE_ENV']),

  /**
   * Hardcoded-credential literal patterns. A match anywhere (client or server)
   * is a `hardcoded-secret` violation — secrets belong in env, never in source.
   * These universal patterns cover the most common API key formats.
   */
  secretPatterns: [
    { id: 'anthropic-key',    re: /sk-ant-[A-Za-z0-9_-]{12,}/ },
    { id: 'openrouter-key',   re: /sk-or-v1-[A-Za-z0-9]{12,}/ },
    { id: 'openai-key',       re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/ },
    { id: 'aws-access-key',   re: /\bAKIA[0-9A-Z]{16}\b/ },
    { id: 'private-key-block',re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
    { id: 'jwt-literal',      re: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/ },
    { id: 'resend-key',       re: /\bre_[A-Za-z0-9]{20,}/ },
  ],

  /**
   * Telemetry should leave through a single analytics seam so a never-send
   * guard can strip personal/free-text properties before the vendor sees them.
   * Adjust `seamDir` to the directory that owns all analytics calls, and
   * `vendorCapture` to match your analytics SDK's capture method.
   */
  analytics: {
    /** Files under this prefix are the authorised seam — no violation is raised
     *  for vendor calls found here. Everything outside the seam is flagged. */
    seamDir: 'src/analytics/',

    /** Regex matching a direct vendor telemetry call (any analytics SDK). */
    vendorCapture: /\bposthog\s*\.\s*(?:capture|identify|register|setPersonProperties)\s*\(/,

    /**
     * Property-name fragments that telemetry should never send.
     * (Documentation artefact / KPI — enforced only if you add a runtime sanitiser.)
     */
    forbiddenKeyFragments: [
      'name', 'email', 'phone', 'address', 'password', 'secret', 'token',
    ],
  },

  /**
   * Structural privacy mechanisms that must exist in your codebase.
   * Each entry checks that a specific file contains a required string.
   * Leave empty `[]` until you have concrete mechanisms to assert.
   *
   * Example entry shape:
   *   { id: 'CONSENT-GATE', file: 'src/lib/consent.ts', mustContain: 'hasConsent', desc: 'Consent gate' }
   */
  structuralChecks: [],

  /** Penalty per severity (start at 100, subtract). Tune to taste. */
  points: { violation: 25, high: 8, medium: 4, low: 2 },

  /** Score bands for the report label. */
  bands: { good: 85, moderate: 65 },
};
