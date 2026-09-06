/**
 * Vendors the @vladmandic/human model weights into public/models at build
 * time so face recognition never needs a CDN at runtime. Keeping the models
 * local also lets the Content-Security-Policy stay locked to 'self'.
 *
 * Failure is non-fatal: if the download cannot complete, the app falls back
 * to the jsDelivr CDN at runtime (see NEXT_PUBLIC_HUMAN_MODEL_PATH).
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const BASE =
  process.env.HUMAN_MODELS_BASE ??
  "https://cdn.jsdelivr.net/npm/@vladmandic/human-models/models";

const OUT_DIR = path.join(process.cwd(), "public", "models");

// Only the models this application actually loads: face detection, mesh,
// iris (head pose for the liveness challenge), the 1024-d descriptor, plus
// anti-spoof and liveness.
const MODELS = [
  "blazeface.json",
  "blazeface.bin",
  "facemesh.json",
  "facemesh.bin",
  "iris.json",
  "iris.bin",
  "faceres.json",
  "faceres.bin",
  "antispoof.json",
  "antispoof.bin",
  "liveness.json",
  "liveness.bin",
  "emotion.json",
  "emotion.bin",
];

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(name) {
  const target = path.join(OUT_DIR, name);

  if (await exists(target)) {
    console.log(`  · ${name} (cached)`);
    return true;
  }

  const url = `${BASE}/${name}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60_000);

  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      console.warn(`  ! ${name} → HTTP ${res.status}`);
      return false;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(target, buf);
    console.log(`  ✓ ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
    return true;
  } catch (err) {
    console.warn(`  ! ${name} → ${err instanceof Error ? err.message : err}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  console.log("→ Vendoring face-recognition models into public/models…");
  await mkdir(OUT_DIR, { recursive: true });

  let okCount = 0;
  for (const name of MODELS) {
    // Sequential on purpose — jsDelivr rate-limits aggressive parallel pulls.
    if (await download(name)) okCount++;
  }

  const marker = path.join(OUT_DIR, "manifest.json");
  await writeFile(
    marker,
    JSON.stringify(
      { source: BASE, fetchedAt: new Date().toISOString(), files: MODELS, ok: okCount },
      null,
      2,
    ),
  );

  if (okCount < MODELS.length) {
    console.warn(
      `! ${MODELS.length - okCount} model file(s) missing. Face recognition will fall back to the CDN at runtime.`,
    );
  } else {
    console.log("✓ All face models vendored locally.");
  }
}

main().catch((err) => {
  console.warn("! Model vendoring skipped:", err?.message ?? err);
});
