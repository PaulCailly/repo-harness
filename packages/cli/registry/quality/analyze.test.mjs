/**
 * Unit tests for the code-health analyzer. Run with `node --test scripts/health/`
 * (also wired as `pnpm health:test`). Uses the Node built-in test runner so the
 * tooling stays dependency-free and independent of the app's vitest projects.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { analyzeSource, physicalLoc, band } from './analyze.mjs';
import { config } from './config.mjs';

const find = (res, fn, rule) =>
  res.findings.find((f) => f.fn === fn && f.rule === rule);

test('physicalLoc counts non-blank lines', () => {
  assert.equal(physicalLoc('a\n\n b \n\nc'), 3);
  assert.equal(physicalLoc(''), 0);
});

test('cyclomatic complexity counts decision points (+1 base)', () => {
  let body = '';
  for (let i = 0; i < 12; i++) body += `  if (x === ${i}) y++;\n`;
  const src = `export function f(x){ let y = 0;\n${body}  return y; }\n`;
  const res = analyzeSource('f.ts', src, config);
  const cc = find(res, 'f', 'cyclomatic');
  assert.equal(cc.value, 13); // 1 + 12 ifs
  assert.equal(cc.points, 3); // 11–20 tier
});

test('&&, ||, ?? and ?: each add one branch', () => {
  const src = `export function f(a,b,c){ return a && b || c ?? (a ? 1 : 2); }\n`;
  // base 1 + && + || + ?? + ?: = 5 (below the 11 threshold, so no finding)
  const res = analyzeSource('f.ts', src, config);
  assert.equal(find(res, 'f', 'cyclomatic'), undefined);
});

test('nesting depth flags deep control flow', () => {
  const src = `export function g(a){
    if (a) { for (const x of a) { while (x) { if (x>1) { if (x>2) { return x; } } } } }
    return 0;
  }`;
  const res = analyzeSource('g.ts', src, config);
  const n = find(res, 'g', 'nesting');
  assert.equal(n.value, 5); // if>for>while>if>if
  assert.equal(n.points, 2);
});

test('a flat else-if chain is not counted as deep nesting', () => {
  let chain = 'export function f(x){\n';
  for (let i = 0; i < 8; i++) {
    chain += (i === 0 ? '  if' : '  else if') + ` (x === ${i}) { return ${i}; }\n`;
  }
  chain += '  return -1;\n}\n';
  const res = analyzeSource('f.ts', chain, config);
  // Structurally flat — the if-bodies sit at depth 1, so no nesting finding.
  assert.equal(find(res, 'f', 'nesting'), undefined);
});

test('try and catch are the same level, not stacked', () => {
  // try > if > if > if : the deepest if is at depth 3 (catch must not add +1).
  const src = `export function g(){
    try { a(); } catch (e) { if (e) { if (e.x) { if (e.y) { log(e); } } } }
  }`;
  const res = analyzeSource('g.ts', src, config);
  // depth 3 (catch=0, if=1, if=2, if=3) is below the 4 threshold → no finding.
  assert.equal(find(res, 'g', 'nesting'), undefined);
});

test('genuine nesting is still measured', () => {
  const src = `export function h(a){ if(a){ for(const x of a){ while(x){ if(x){ if(x>1){ return x; } } } } } }`;
  const res = analyzeSource('h.ts', src, config);
  assert.equal(find(res, 'h', 'nesting').value, 5); // if>for>while>if>if
});

test('parameter count is penalised', () => {
  const res = analyzeSource('p.ts', `export function f(a,b,c,d,e){ return a; }\n`, config);
  const p = find(res, 'f', 'params');
  assert.equal(p.value, 5);
  assert.equal(p.points, 1);
});

test('nested functions are measured independently', () => {
  const src = `export function outer(){
    function inner(){ return 1; }
    return inner();
  }`;
  const res = analyzeSource('n.ts', src, config);
  // outer is trivial (cc 1) despite containing inner — no findings at all
  assert.equal(res.findings.length, 0);
  assert.equal(res.score, 100);
});

test('a clean file scores 100; penalties subtract from 100', () => {
  const clean = analyzeSource('c.ts', `export const x = 1;\n`, config);
  assert.equal(clean.score, 100);
  assert.equal(clean.penalty, 0);

  let big = 'export function f(){\n';
  for (let i = 0; i < 60; i++) big += `  const v${i} = ${i};\n`;
  big += '  return 0;\n}\n';
  const res = analyzeSource('b.ts', big, config);
  // function >50 lines (-2). score = 100 - penalty.
  assert.ok(res.penalty >= 2);
  assert.equal(res.score, 100 - res.penalty);
});

test('duplication folds in, capped', () => {
  const res = analyzeSource('d.ts', `export const x = 1;\n`, config, 1000);
  const dup = res.findings.find((f) => f.rule === 'duplication');
  assert.equal(dup.points, config.duplication.cap);
});

test('band maps score to label', () => {
  assert.equal(band(90, config.bands), 'good');
  assert.equal(band(70, config.bands), 'moderate');
  assert.equal(band(40, config.bands), 'poor');
});
