/**
 * Core privacy-compliance analysis: scan one source file line-by-line for the
 * concrete, deterministic signals that protect the local-first / governed-egress
 * guarantee — network destinations, secret handling, and the telemetry seam.
 * Pure and deterministic — `analyzeSource` is unit-tested directly.
 *
 * Line scanning (not the TS AST) is deliberate: these are textual facts (a URL,
 * an env-var name, a `posthog.capture(` call). It keeps the analyzer dependency-
 * free and trivially correct, and lets it cover `.mjs` config/scripts too.
 */

const URL_RE = /\bhttps?:\/\/([a-z0-9.-]+)/gi;
const ENV_RE = /(?:import\s*\.\s*meta\s*\.\s*env|process\s*\.\s*env)\s*(?:\.\s*([A-Z0-9_]+)|\[\s*['"]([A-Z0-9_]+)['"]\s*\])/g;

/** Is this file server-side (Node/serverless) code, where secrets are safe? */
export function isServer(file, config) {
  return config.serverScope.test(file);
}

/**
 * Blank out comment text (so a URL in a `//` or `/* *​/` comment or a doc link
 * isn't mistaken for an egress target) while preserving line count and columns.
 * The `//` of a `://` scheme is kept, so real URL literals survive. Heuristic,
 * not a full parser — a `//` inside a string literal is treated as a comment,
 * which at worst skips a contrived URL embedded after `// ` inside a string. */
export function stripComments(lines) {
  let inBlock = false;
  return lines.map((s) => {
    let out = '';
    let i = 0;
    while (i < s.length) {
      if (inBlock) {
        const end = s.indexOf('*/', i);
        if (end === -1) return out;
        i = end + 2;
        inBlock = false;
        continue;
      }
      const block = s.indexOf('/*', i);
      let lc = -1;
      for (let j = i; j < s.length - 1; j++) {
        if (s[j] === '/' && s[j + 1] === '/' && s[j - 1] !== ':') {
          lc = j;
          break;
        }
      }
      const starts = [block, lc].filter((x) => x !== -1);
      if (starts.length === 0) return out + s.slice(i);
      const next = Math.min(...starts);
      out += s.slice(i, next);
      if (next === lc) return out; // rest of line is a // comment
      inBlock = true; // block comment opened
      i = next + 2;
    }
    return out;
  });
}

function finding(line, rule, severity, message, value) {
  return { line, rule, severity, message, value: value ?? null };
}

/** Egress: every http(s) host literal, classified against the allowlist.
 *  Operates on comment-stripped lines so only real code URLs are considered. */
function scanEgress(file, lines, scope, config) {
  const out = [];
  const allow = new Map(config.egressAllowlist.map((e) => [e.host, e]));
  const ignore = new Set(config.egressIgnoreHosts ?? []);
  stripComments(lines).forEach((text, i) => {
    const line = i + 1;
    for (const m of text.matchAll(URL_RE)) {
      const host = m[1].toLowerCase().replace(/[.,)'"`;]+$/, '');
      if (ignore.has(host)) continue;
      const entry = allow.get(host);
      if (!entry) {
        out.push(
          finding(line, 'unsanctioned-egress', 'violation',
            `Egress to un-allowlisted host "${host}". Add it to the egress allowlist (config.mjs) with its data category + lawful basis, or remove the call.`,
            host),
        );
        continue;
      }
      if (scope === 'client' && entry.scope === 'server') {
        out.push(
          finding(line, 'server-host-in-client', 'medium',
            `"${host}" (${entry.service}) is a server-only destination but is contacted from client code — route it through a server proxy so the browser never talks to it directly.`,
            host),
        );
      } else if (scope === 'client' && entry.clientSeverity) {
        const sev = entry.clientSeverity;
        const rule = entry.ipLeak ? 'ip-leaking-egress' : 'client-egress';
        out.push(finding(line, rule, sev, `Browser contacts ${entry.service} directly — ${entry.note}.`, host));
      }
    }
  });
  return out;
}

/** Secrets: env-var leaks into the client bundle + hardcoded credentials. */
function scanSecrets(file, lines, scope, config) {
  const out = [];
  const { serverOnlySecrets, publicEnvPrefix, publicEnvNames } = config;
  lines.forEach((text, i) => {
    const line = i + 1;

    // Env-var references (only a concern in client code — server env is fine).
    if (scope === 'client') {
      for (const m of text.matchAll(ENV_RE)) {
        const name = m[1] ?? m[2];
        if (serverOnlySecrets.includes(name)) {
          out.push(
            finding(line, 'server-secret-in-client', 'violation',
              `Server-only secret "${name}" is referenced from client code — it would be inlined into the browser bundle. Move this access to api/ or src/server/.`,
              name),
          );
        } else if (!publicEnvPrefix.test(name) && !publicEnvNames.has(name)) {
          out.push(
            finding(line, 'non-public-env-in-client', 'medium',
              `Client code reads env "${name}" which is not a public (VITE_*) var — it will not be defined in the browser and may indicate a secret leak. Prefix public config with VITE_ or move secret access server-side.`,
              name),
          );
        }
      }
    }

    // Hardcoded credentials — never acceptable, client or server.
    for (const { id, re } of config.secretPatterns) {
      if (re.test(text)) {
        out.push(
          finding(line, 'hardcoded-secret', 'violation',
            `Possible hardcoded credential (${id}) in source. Secrets must come from environment variables, never literals.`,
            id),
        );
      }
    }
  });
  return out;
}

/** Telemetry must only leave through the sanitiser seam (doc 12 §9). */
function scanTelemetrySeam(file, lines, config) {
  if (file.startsWith(config.analytics.seamDir)) return [];
  const out = [];
  lines.forEach((text, i) => {
    if (config.analytics.vendorCapture.test(text)) {
      out.push(
        finding(i + 1, 'telemetry-outside-seam', 'violation',
          'Direct vendor telemetry call outside the analytics sanitiser seam — it bypasses the never-send privacy guard. Emit events through the Analytics port instead.'),
      );
    }
  });
  return out;
}

/**
 * Analyze one source file. Returns `{ file, scope, findings }` where each
 * finding is `{ line, rule, severity, message, value }`. Pure.
 */
export function analyzeSource(file, source, config) {
  const scope = isServer(file, config) ? 'server' : 'client';
  const lines = source.split('\n');
  const findings = [
    ...scanEgress(file, lines, scope, config),
    ...scanSecrets(file, lines, scope, config),
    ...scanTelemetrySeam(file, lines, config),
  ].sort((a, b) => a.line - b.line);
  return { file, scope, findings };
}

/** Score band label for a 0-100 score (good ≥85, moderate ≥65, else poor). */
export function band(score, bands) {
  if (score >= bands.good) return 'good';
  if (score >= bands.moderate) return 'moderate';
  return 'poor';
}
