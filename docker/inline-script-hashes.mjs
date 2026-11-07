// Prints the CSP hash source of each inline <script> in an index.html, one
// per line: what the console image's script-src allows besides 'self'.
//
//   node docker/inline-script-hashes.mjs dist/index.html
//
// index.html has one, the pre-paint theme script; config.js is a file, so
// 'self' covers it. Fails on any other count, so a new inline script cannot
// ship without the policy being told about it.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: inline-script-hashes.mjs INDEX_HTML');
  process.exit(2);
}
const html = readFileSync(file, 'utf8');
const hashes = [
  ...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map(
  (match) =>
    `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`
);
if (hashes.length !== 1) {
  console.error(
    `${file} has ${hashes.length} inline scripts, not just the theme script`
  );
  process.exit(1);
}
console.log(hashes.join('\n'));
