// Re-uploads files from a backup made by blob-backup.mjs to the same
// pathnames. Restoring into the same Blob store gives the same public URLs,
// so the metadata URIs stored on-chain keep working.
//
// Usage: BLOB_READ_WRITE_TOKEN=... node scripts/blob-restore.mjs ./blob-backup
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { head, put } from "@vercel/blob";

const backupDir = process.argv[2] ?? "blob-backup";
const manifest = JSON.parse(readFileSync(join(backupDir, "manifest.json"), "utf8"));
let restored = 0;

for (const entry of manifest) {
  try {
    await head(entry.url);
    continue; // Still present.
  } catch {
    // Missing: restore below.
  }

  const bytes = readFileSync(join(backupDir, "files", entry.pathname));
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== entry.sha256) {
    console.error(`Hash mismatch for ${entry.pathname}; not restored.`);
    continue;
  }

  const blob = await put(entry.pathname, bytes, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
  });
  restored++;
  if (blob.url !== entry.url) {
    console.warn(`Restored ${entry.pathname} at a different URL: ${blob.url}`);
  }
}

console.log(`Restored ${restored} missing files.`);
