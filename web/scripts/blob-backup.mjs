// Downloads every file in the Vercel Blob store (event metadata, images and
// videos) into a local folder, with a manifest of pathnames and SHA-256
// hashes. Run it on a schedule (see .github/workflows/blob-backup.yml) so
// event metadata survives an accidental deletion or a paused store.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/blob-backup.mjs ./blob-backup
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { list } from "@vercel/blob";

const outDir = process.argv[2] ?? "blob-backup";
const manifest = [];
let cursor;

do {
  const page = await list({ cursor, limit: 1000 });
  for (const blob of page.blobs) {
    const response = await fetch(blob.url);
    if (!response.ok) {
      console.error(`Skipped ${blob.pathname}: HTTP ${response.status}`);
      continue;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const target = join(outDir, "files", blob.pathname);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
    manifest.push({
      pathname: blob.pathname,
      url: blob.url,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      uploadedAt: blob.uploadedAt,
    });
  }
  cursor = page.hasMore ? page.cursor : undefined;
} while (cursor);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`Backed up ${manifest.length} files to ${outDir}`);
