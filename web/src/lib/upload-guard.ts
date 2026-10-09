import "server-only";

import { del, list } from "@vercel/blob";

/**
 * Limits that keep a free (Hobby) Vercel Blob store from being filled up.
 * On Hobby, exceeding the included 1 GB pauses Blob for 30 days instead of
 * billing, so the limits protect availability, not just cost.
 *
 * A valid wallet is required for every upload, but wallets are free to
 * create, so these limits are per wallet and deliberately small.
 */
export const UPLOAD_LIMITS = {
  /** Event videos per wallet, ever. */
  videosPerWallet: 3,
  /** Maximum event video size. */
  maxVideoBytes: 25_000_000,
  /** Event metadata uploads (one per created event) per wallet, ever. */
  metadataUploadsPerWallet: 25,
} as const;

/** Counts blobs under a prefix, stopping once `limit` is reached. */
export async function countBlobs(prefix: string, limit: number) {
  let count = 0;
  let cursor: string | undefined;

  do {
    const page = await list({ prefix, cursor, limit: Math.min(limit, 1000) });
    count += page.blobs.length;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor && count < limit);

  return count;
}

/** Counts distinct "folders" directly under a prefix (one per upload). */
export async function countFolders(prefix: string, limit: number) {
  const page = await list({ prefix, mode: "folded", limit: Math.min(limit + 1, 1000) });
  return page.folders.length;
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Checks the file's actual bytes, not just the declared content type. */
export function sniffImageType(bytes: Uint8Array) {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "image/jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return "image/webp";
  }
  return null;
}

export function sniffVideoType(bytes: Uint8Array) {
  // MP4/ISO-BMFF: "ftyp" box at offset 4.
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    return "video/mp4";
  }
  // WebM/Matroska: EBML header.
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return "video/webm";
  }
  return null;
}

/**
 * Client uploads go straight to Blob, so their bytes are checked after the
 * upload completes and the file is deleted if it is not a real video.
 */
export async function verifyUploadedVideo(url: string) {
  const response = await fetch(url, { headers: { Range: "bytes=0-15" } });
  const bytes = new Uint8Array(await response.arrayBuffer());

  if (sniffVideoType(bytes) === null) {
    await del(url);
    return false;
  }

  return true;
}
