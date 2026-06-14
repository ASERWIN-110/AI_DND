#!/usr/bin/env node
import { cp, mkdir, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = resolve(ROOT, 'dist');
const ASSETS = [
  'public',
  'manuals/examples'
];

await mkdir(DIST, { recursive: true });

for (const entry of ASSETS) {
  const source = resolve(ROOT, entry);
  const target = resolve(DIST, entry);
  await rm(target, { recursive: true, force: true });
  await cp(source, target, {
    recursive: true,
    filter: (path) => !path.endsWith('.DS_Store')
  });
}
