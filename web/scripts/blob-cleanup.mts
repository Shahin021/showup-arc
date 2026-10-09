// Removes media left behind by failed uploads: files under showup/events/
// and showup/videos/ that no used quota slot covers (a crash between upload
// and finalize, a lost lease, or a deletion that failed). Files younger
// than the grace period are never touched, so in-flight uploads are safe.
//
// Only files uploaded on or after SHOWUP_CLEANUP_SINCE (an ISO date, set to
// when this version was first deployed) are considered: media uploaded
// before quota slots existed has no slot and must not be treated as orphaned.
//
// Dry run (lists only):
//   BLOB_READ_WRITE_TOKEN=... npm run blob-cleanup
// Delete:
//   BLOB_READ_WRITE_TOKEN=... npm run blob-cleanup -- --delete
import { del, list } from "@vercel/blob";

import {
  findOrphanedMedia,
  LEASE_TTL_MS,
  readCoveredMediaPaths,
} from "../src/lib/upload-guard";

const GRACE_MS = LEASE_TTL_MS.videos + 60 * 60 * 1000;
const shouldDelete = process.argv.includes("--delete");
const since = Date.parse(process.env.SHOWUP_CLEANUP_SINCE ?? "");

if (!Number.isFinite(since)) {
  console.error(
    "Set SHOWUP_CLEANUP_SINCE to the date this version was first deployed (for example 2026-10-20).",
  );
  process.exit(1);
}

async function listAll(prefix: string) {
  const files: { pathname: string; url: string; uploadedAt: Date }[] = [];
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor, limit: 1000 });
    files.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return files;
}

const covered = [
  ...(await readCoveredMediaPaths("events")),
  ...(await readCoveredMediaPaths("videos")),
];
const media = [
  ...(await listAll("showup/events/")),
  ...(await listAll("showup/videos/")),
];
const orphans = findOrphanedMedia(
  media.filter((file) => file.uploadedAt.getTime() >= since),
  covered,
  Date.now(),
  GRACE_MS,
);

console.log(`${media.length} media files, ${covered.length} used quota slots, ${orphans.length} orphaned.`);
for (const file of orphans) {
  console.log(`  ${shouldDelete ? "deleting" : "would delete"} ${file.pathname}`);
}

if (shouldDelete && orphans.length > 0) {
  for (let index = 0; index < orphans.length; index += 100) {
    await del(orphans.slice(index, index + 100).map((file) => file.url));
  }
  console.log(`Deleted ${orphans.length} files.`);
}
