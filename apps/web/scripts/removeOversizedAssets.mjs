#!/usr/bin/env node
/**
 * Strips oversized onnxruntime-web WASM binaries from the built dist/assets — Vite/Rollup
 * auto-copies EVERY wasm variant onnxruntime-web ships (including the SIMD-threaded "jsep"
 * build, ~25.6MiB) into the output directory because the package references them all via
 * `new URL(...)` for its own dynamic runtime-selection logic, even though this app never lets
 * that logic run: faceEmbeddingOnnx.ts explicitly sets `ort.env.wasm.wasmPaths` to a CDN URL
 * before creating any session, so onnxruntime-web always fetches its actual WASM binary from
 * jsdelivr at runtime and NEVER touches these locally-bundled copies.
 *
 * Cloudflare Pages hard-caps individual static asset files at 25MiB (see
 * https://developers.cloudflare.com/pages/platform/limits/#file-size) — the unused 25.6MiB
 * jsep wasm file alone was enough to fail EVERY deploy since it started being pulled in
 * (2026-08-04, when onnxruntime-web was added for the ArcFace face-recognition embedding
 * pipeline), silently blocking every subsequent fix from ever going live even though `git push`
 * succeeded and CI/tests passed — deploys were failing in a step this repo had no visibility
 * into until directly inspecting Cloudflare Pages' build log.
 *
 * Deleting these dead files post-build is safe specifically BECAUSE nothing in the shipped
 * bundle ever fetches them at runtime (confirmed via the explicit wasmPaths override above) —
 * if that ever changes (e.g. removing the CDN override to self-host WASM instead), this script
 * would need to be removed/updated accordingly.
 */
import { readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

const ASSETS_DIR = join(import.meta.dirname, '..', 'dist', 'assets');
const MAX_SAFE_SIZE_BYTES = 25 * 1024 * 1024; // Cloudflare Pages' per-file limit

let removedCount = 0;
try {
  for (const name of readdirSync(ASSETS_DIR)) {
    if (!name.endsWith('.wasm')) continue;
    const fullPath = join(ASSETS_DIR, name);
    const { size } = statSync(fullPath);
    if (size > MAX_SAFE_SIZE_BYTES) {
      unlinkSync(fullPath);
      console.log(`[removeOversizedAssets] Removed unused oversized asset: ${name} (${(size / 1024 / 1024).toFixed(1)}MiB)`);
      removedCount++;
    }
  }
} catch (err) {
  console.error('[removeOversizedAssets] Failed to scan dist/assets:', err);
  process.exit(1);
}

if (removedCount === 0) {
  console.log('[removeOversizedAssets] No oversized assets found — nothing to remove.');
}
