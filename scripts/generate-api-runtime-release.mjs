#!/usr/bin/env node
// Regenerate src/generated/RuntaraRuntimeApi.ts from the openapi.json of the
// runtara release this console builds against: the version of the
// runtara-validation-wasm package it depends on (see package.json), so the
// client and the validator always come from the same runtara release.
// RUNTARA_VERSION=<x.y.z> picks another release.
//
// With --check, nothing is written: the client is generated aside and compared
// with the one checked in, and a difference fails. That is how CI tells that
// the checked-in client is not the pinned release's.
//
// The client may be ahead of the pinned release for a while: generated from a
// server whose changes are merged and not yet released. What it has beyond
// the release is then recorded in scripts/api-runtime.pending.patch, which
// --check applies to the release's client before comparing, so the known
// difference passes and any other fails. --write-pending records the current
// difference. Delete the patch with the bump to the release that carries it:
// --check fails on a patch that no longer applies.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pinned = JSON.parse(
  readFileSync(
    path.join(root, 'node_modules/runtara-validation-wasm/package.json'),
    'utf8'
  )
).version;
const version = process.env.RUNTARA_VERSION || pinned;
const url = `https://github.com/runtarahq/runtara/releases/download/v${version}/openapi.json`;

const writePending = process.argv.includes('--write-pending');
const check = process.argv.includes('--check') || writePending;
const pendingPatch = path.join(root, 'scripts/api-runtime.pending.patch');
const generated = 'src/generated';
const name = 'RuntaraRuntimeApi.ts';

const response = await fetch(url);
if (!response.ok) {
  console.error(`${url}: ${response.status} ${response.statusText}`);
  process.exit(1);
}
const scratch = mkdtempSync(path.join(tmpdir(), 'runtara-openapi-'));
const spec = path.join(scratch, 'openapi.json');
writeFileSync(spec, Buffer.from(await response.arrayBuffer()));
console.log(`openapi.json of runtara v${version}`);

const result = spawnSync(
  'npx',
  [
    'swagger-typescript-api',
    'generate',
    '--axios',
    '--generate-union-enums',
    '-p',
    spec,
    '-o',
    check ? scratch : generated,
    '-n',
    name,
  ],
  { cwd: root, stdio: 'inherit' }
);
if (result.status !== 0 || !check) process.exit(result.status ?? 1);

const released = path.join(scratch, name);
const checkedIn = path.join(root, generated, name);

if (writePending) {
  // `diff` exits 1 when the files differ, which is the case worth recording.
  const pending = spawnSync(
    'diff',
    ['-u', '--label', name, '--label', name, released, checkedIn],
    { encoding: 'utf8' }
  );
  if (pending.status === 0) {
    rmSync(pendingPatch, { force: true });
    console.log(`${generated}/${name} is the client of runtara v${version}`);
    process.exit(0);
  }
  if (pending.status !== 1) {
    console.error(pending.stderr);
    process.exit(pending.status ?? 1);
  }
  writeFileSync(pendingPatch, pending.stdout);
  console.log(
    `Recorded what the client has beyond v${version} in ${pendingPatch}`
  );
  process.exit(0);
}

if (existsSync(pendingPatch)) {
  const applied = spawnSync('patch', ['--quiet', released, pendingPatch], {
    stdio: 'inherit',
  });
  if (applied.status !== 0) {
    console.error(
      `scripts/api-runtime.pending.patch does not apply to the client of runtara v${version}: ` +
        'delete it if this release carries what it recorded, or record the difference again with --write-pending.'
    );
    process.exit(1);
  }
  console.log(`Applied the pending difference to the client of v${version}`);
}

// `git diff --no-index` exits 1 when the two files differ, and prints how.
// `git diff --no-index` exits 1 when the two files differ, and prints how.
const diff = spawnSync(
  'git',
  [
    'diff',
    '--no-index',
    '--stat',
    '--patch',
    path.join(generated, name),
    released,
  ],
  { cwd: root, stdio: 'inherit' }
);
if (diff.status === 0) {
  console.log(
    `${generated}/${name} is the client of runtara v${version}` +
      (existsSync(pendingPatch) ? ', with the pending difference' : '')
  );
} else {
  console.error(
    `${generated}/${name} is not the client of runtara v${version}: ` +
      'regenerate it with `npm run generate-api-runtime-release`, or pin the ' +
      'runtara release it was generated from (runtara-validation-wasm in package.json).'
  );
}
process.exit(diff.status ?? 1);
