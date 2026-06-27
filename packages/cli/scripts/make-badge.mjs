#!/usr/bin/env node
/**
 * make-badge.mjs — zero-dep flat SVG badge generator (shields.io-style)
 * Usage: node scripts/make-badge.mjs <label> <value> <outfile>
 *
 * Color thresholds (numeric detection):
 *   green  >= 85
 *   yellow >= 65
 *   red     < 65
 */

import fs from 'node:fs';
import path from 'node:path';

const [,, label, value, outfile] = process.argv;
if (!label || !value || !outfile) {
  console.error('Usage: node scripts/make-badge.mjs <label> <value> <outfile>');
  process.exit(1);
}

/** Extract a numeric value from strings like "92%", "87/100", "73.4" */
function parseNumeric(v) {
  const m = v.match(/[\d.]+/);
  if (!m) return null;
  const n = parseFloat(m[0]);
  // "87/100" → use first number as-is (already out of 100)
  return n;
}

function pickColor(v) {
  const n = parseNumeric(v);
  if (n === null) return '#9f9f9f'; // gray for non-numeric
  if (n >= 85) return '#44cc11';   // green
  if (n >= 65) return '#dfb317';   // yellow
  return '#e05d44';                // red
}

/** Approximate character width for SVG text (DejaVu Sans 11px) */
function textWidth(str) {
  // Average ~6.5px per char; use 7 for safety
  return str.length * 7;
}

function makeSvg(label, value) {
  const color = pickColor(value);
  const leftW = textWidth(label) + 10;
  const rightW = textWidth(value) + 10;
  const totalW = leftW + rightW;
  const leftCx = leftW / 2;
  const rightCx = leftW + rightW / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${totalW}" height="20">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r">
    <rect width="${totalW}" height="20" rx="3" fill="#fff"/>
  </clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftW}" height="20" fill="#555"/>
    <rect x="${leftW}" width="${rightW}" height="20" fill="${color}"/>
    <rect width="${totalW}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="${leftCx}" y="15" fill="#010101" fill-opacity=".3">${label}</text>
    <text x="${leftCx}" y="14">${label}</text>
    <text x="${rightCx}" y="15" fill="#010101" fill-opacity=".3">${value}</text>
    <text x="${rightCx}" y="14">${value}</text>
  </g>
</svg>`;
}

const svg = makeSvg(label, value);
const outPath = path.resolve(outfile);
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, svg, 'utf8');
console.log(`Badge written → ${outPath}`);
