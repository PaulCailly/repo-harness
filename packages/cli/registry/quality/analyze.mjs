/**
 * Core code-health analysis: parse one TS/TSX source with the TypeScript
 * compiler API, measure per-function metrics (cyclomatic complexity, length,
 * nesting depth, parameter count) and per-file length, then turn threshold
 * violations into scored findings. Pure and deterministic — `analyzeSource` is
 * unit-tested directly.
 */

import ts from 'typescript';

/** Physical SLOC: non-blank lines (a simple, stable size proxy). */
export function physicalLoc(text) {
  return text.split('\n').filter((line) => line.trim() !== '').length;
}

const FUNCTION_KINDS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
]);

const isFunctionLike = (node) => FUNCTION_KINDS.has(node.kind);

/**
 * Control-flow nodes that add a level of structural nesting. CatchClause is
 * deliberately absent: the catch block is an alternative path to the try block
 * (a sibling), not a level deeper — TryStatement already accounts for the +1, so
 * counting CatchClause too would double-count code inside a catch.
 */
const NESTING_KINDS = new Set([
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.DoStatement,
  ts.SyntaxKind.SwitchStatement,
  ts.SyntaxKind.TryStatement,
]);

/** An `else if` — i.e. an IfStatement sitting in another IfStatement's `else`.
 *  Such a chain is structurally flat, so it must not add a nesting level. */
function isElseIf(node) {
  return (
    node.kind === ts.SyntaxKind.IfStatement &&
    node.parent !== undefined &&
    node.parent.kind === ts.SyntaxKind.IfStatement &&
    node.parent.elseStatement === node
  );
}

/** How many decision points `node` itself contributes to cyclomatic complexity. */
function decisionPoints(node) {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.CaseClause: // each `case` branches; `default` does not
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.ConditionalExpression: // ?:
      return 1;
    case ts.SyntaxKind.BinaryExpression: {
      const op = node.operatorToken.kind;
      return op === ts.SyntaxKind.AmpersandAmpersandToken ||
        op === ts.SyntaxKind.BarBarToken ||
        op === ts.SyntaxKind.QuestionQuestionToken
        ? 1
        : 0;
    }
    default:
      return 0;
  }
}

/** Cyclomatic complexity + max nesting of one function, NOT descending into any
 *  nested function (those are measured independently). */
function functionMetrics(fn) {
  let cyclomatic = 1;
  let maxDepth = 0;
  const visit = (node, depth) => {
    if (node !== fn && isFunctionLike(node)) {
      return; // a nested function is its own unit
    }
    cyclomatic += decisionPoints(node);
    const adds = NESTING_KINDS.has(node.kind) && !isElseIf(node) ? 1 : 0;
    const next = depth + adds;
    if (next > maxDepth) {
      maxDepth = next;
    }
    ts.forEachChild(node, (child) => visit(child, next));
  };
  visit(fn, 0);
  return { cyclomatic, maxDepth };
}

/** Best-effort readable name for a function-like node. */
function functionName(fn) {
  if (fn.name && ts.isIdentifier(fn.name)) {
    return fn.name.text;
  }
  if (fn.kind === ts.SyntaxKind.Constructor) {
    return 'constructor';
  }
  const parent = fn.parent;
  if (parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  if (parent && ts.isPropertyAssignment(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }
  return '(anonymous)';
}

/** First tier whose `over` is exceeded (tiers are largest-first), or undefined. */
function tier(value, tiers) {
  return tiers.find((t) => value > t.over);
}

/**
 * Analyze one source file. Returns its metrics, the scored findings, and the
 * resulting file score. `duplicatedLines` is folded in by the caller (jscpd).
 */
export function analyzeSource(file, source, config, duplicatedLines = 0) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const findings = [];
  const lineOf = (node) =>
    sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

  const add = (line, fn, rule, value, hit) => {
    if (hit) {
      findings.push({
        file,
        line,
        fn,
        rule,
        value,
        points: hit.points,
        severity: hit.severity,
      });
    }
  };

  const collect = (node) => {
    if (isFunctionLike(node)) {
      const name = functionName(node);
      const line = lineOf(node);
      const { cyclomatic, maxDepth } = functionMetrics(node);
      const loc = physicalLoc(node.getText(sourceFile));
      const params = node.parameters.length;
      add(line, name, 'cyclomatic', cyclomatic, tier(cyclomatic, config.cyclomatic));
      add(line, name, 'functionLoc', loc, tier(loc, config.functionLoc));
      add(line, name, 'nesting', maxDepth, tier(maxDepth, config.nesting));
      add(line, name, 'params', params, tier(params, config.params));
    }
    ts.forEachChild(node, collect);
  };
  collect(sourceFile);

  const sloc = physicalLoc(source);
  add(1, null, 'fileLoc', sloc, tier(sloc, config.fileLoc));

  if (duplicatedLines > 0) {
    const { perLines, points, cap } = config.duplication;
    const dupPoints = Math.min(cap, Math.ceil(duplicatedLines / perLines) * points);
    findings.push({
      file,
      line: 1,
      fn: null,
      rule: 'duplication',
      value: duplicatedLines,
      points: dupPoints,
      // Severity tracks magnitude (like the tiered rules) rather than being
      // fixed: a file at the cap is 'high', a little duplication is 'elevated'.
      severity: dupPoints >= cap ? 'high' : 'elevated',
    });
  }

  const penalty = findings.reduce((sum, f) => sum + f.points, 0);
  const score = Math.max(0, 100 - penalty);
  return { file, sloc, score, penalty, findings };
}

/** Score label for the report, by config bands. */
export function band(score, bands) {
  if (score >= bands.good) {
    return 'good';
  }
  return score >= bands.moderate ? 'moderate' : 'poor';
}
