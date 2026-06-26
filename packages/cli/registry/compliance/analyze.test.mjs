/**
 * Config-agnostic engine self-test for analyze.mjs.
 *
 * Tests the ENGINE behaviour (analyzeSource, isServer, band) against a small
 * inline config defined here — NOT against the shipped config.mjs or any
 * app-specific policy. This keeps the test portable across any consumer project.
 *
 * Run: node --test packages/cli/registry/compliance/analyze.test.mjs
 *
 * This file is a self-test ONLY — it is NOT listed in registry.json and is
 * NOT vendored to consumer projects.
 */

import { strictEqual, ok, deepStrictEqual } from 'node:assert/strict';
import { describe, it } from 'node:test';
import { analyzeSource, isServer, band } from './analyze.mjs';

// ── Inline test config (never uses shipped config.mjs) ─────────────────────

const cfg = {
  include: /\.(ts|tsx|mjs|js)$/,
  exclude: /\.test\./,
  roots: ['src'],
  serverScope: /^(src\/server\/|src\/api\/|.*\.server\.)/,
  egressIgnoreHosts: ['localhost', '127.0.0.1', 'example.com'],
  egressAllowlist: [
    {
      host: 'api.allowlisted.com',
      service: 'Allowed server API',
      scope: 'server',
      data: 'user data',
      lawfulBasis: 'contract',
      note: 'server-only',
    },
    {
      host: 'cdn.public.com',
      service: 'Public CDN',
      scope: 'client',
      clientSeverity: 'low',
      data: 'no PII',
      lawfulBasis: 'legitimate interest',
      note: 'browser asset delivery',
    },
  ],
  serverOnlySecrets: ['SECRET_KEY', 'DATABASE_URL'],
  publicEnvPrefix: /^VITE_/,
  publicEnvNames: new Set(['NODE_ENV']),
  secretPatterns: [
    { id: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{12,}/ },
    { id: 'jwt-literal',   re: /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}/ },
  ],
  analytics: {
    seamDir: 'src/analytics/',
    vendorCapture: /\bposthog\s*\.\s*capture\s*\(/,
    forbiddenKeyFragments: ['email', 'name'],
  },
  structuralChecks: [],
  points: { violation: 25, high: 8, medium: 4, low: 2 },
  bands: { good: 85, moderate: 65 },
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('isServer', () => {
  it('classifies src/server/ files as server', () => {
    ok(isServer('src/server/handler.ts', cfg));
  });
  it('classifies src/api/ files as server', () => {
    ok(isServer('src/api/route.ts', cfg));
  });
  it('classifies src/components/App.tsx as client', () => {
    ok(!isServer('src/components/App.tsx', cfg));
  });
  it('classifies a .server. file as server', () => {
    ok(isServer('src/lib/db.server.ts', cfg));
  });
});

describe('unsanctioned egress', () => {
  it('flags an un-allowlisted host as violation', () => {
    const src = 'fetch("https://tracker.evil.com/pixel")';
    const { findings } = analyzeSource('src/client/app.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'unsanctioned-egress');
    strictEqual(v.length, 1);
    strictEqual(v[0].severity, 'violation');
    strictEqual(v[0].value, 'tracker.evil.com');
  });

  it('does not flag an ignored host', () => {
    const src = 'const base = "https://localhost:3000/api"';
    const { findings } = analyzeSource('src/client/app.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'unsanctioned-egress');
    strictEqual(v.length, 0);
  });

  it('does not flag an allowlisted server host contacted from server code', () => {
    const src = 'fetch("https://api.allowlisted.com/data")';
    const { findings } = analyzeSource('src/server/handler.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'unsanctioned-egress');
    strictEqual(v.length, 0);
  });
});

describe('server-host-in-client', () => {
  it('flags an allowlisted server-scope host contacted from client code', () => {
    const src = 'fetch("https://api.allowlisted.com/data")';
    const { findings } = analyzeSource('src/components/App.tsx', src, cfg);
    const v = findings.filter(f => f.rule === 'server-host-in-client');
    strictEqual(v.length, 1);
    strictEqual(v[0].severity, 'medium');
  });
});

describe('server-secret-in-client', () => {
  it('flags a server-only secret read from client code', () => {
    const src = 'const k = process.env.SECRET_KEY';
    const { findings } = analyzeSource('src/components/Login.tsx', src, cfg);
    const v = findings.filter(f => f.rule === 'server-secret-in-client');
    strictEqual(v.length, 1);
    strictEqual(v[0].severity, 'violation');
    strictEqual(v[0].value, 'SECRET_KEY');
  });

  it('does not flag a server-only secret in server code', () => {
    const src = 'const k = process.env.SECRET_KEY';
    const { findings } = analyzeSource('src/server/auth.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'server-secret-in-client');
    strictEqual(v.length, 0);
  });
});

describe('hardcoded-secret', () => {
  it('flags an Anthropic API key literal anywhere', () => {
    const src = 'const key = "sk-ant-api03-AAAAAAAAAAAAAAA"';
    const { findings } = analyzeSource('src/server/llm.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'hardcoded-secret');
    strictEqual(v.length, 1);
    strictEqual(v[0].severity, 'violation');
    strictEqual(v[0].value, 'anthropic-key');
  });

  it('flags a JWT literal anywhere', () => {
    // valid-looking JWT (header.payload.signature)
    const src = 'const tok = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abc123defghijk"';
    const { findings } = analyzeSource('src/client/auth.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'hardcoded-secret');
    strictEqual(v.length, 1);
    strictEqual(v[0].value, 'jwt-literal');
  });
});

describe('telemetry-outside-seam', () => {
  it('flags a vendor capture call outside the seam directory', () => {
    const src = 'posthog.capture("page_view", { name: "home" })';
    const { findings } = analyzeSource('src/components/Home.tsx', src, cfg);
    const v = findings.filter(f => f.rule === 'telemetry-outside-seam');
    strictEqual(v.length, 1);
    strictEqual(v[0].severity, 'violation');
  });

  it('does not flag a vendor capture call inside the seam directory', () => {
    const src = 'posthog.capture("page_view", {})';
    const { findings } = analyzeSource('src/analytics/tracker.ts', src, cfg);
    const v = findings.filter(f => f.rule === 'telemetry-outside-seam');
    strictEqual(v.length, 0);
  });
});

describe('band', () => {
  const bands = { good: 85, moderate: 65 };

  it('returns "good" for score >= 85', () => {
    strictEqual(band(100, bands), 'good');
    strictEqual(band(85, bands), 'good');
  });

  it('returns "moderate" for score >= 65 and < 85', () => {
    strictEqual(band(84, bands), 'moderate');
    strictEqual(band(65, bands), 'moderate');
  });

  it('returns "poor" for score < 65', () => {
    strictEqual(band(64, bands), 'poor');
    strictEqual(band(0, bands), 'poor');
  });
});

describe('scope classification in analyzeSource', () => {
  it('returns scope "server" for server files', () => {
    const { scope } = analyzeSource('src/server/handler.ts', '', cfg);
    strictEqual(scope, 'server');
  });

  it('returns scope "client" for client files', () => {
    const { scope } = analyzeSource('src/components/App.tsx', '', cfg);
    strictEqual(scope, 'client');
  });
});
