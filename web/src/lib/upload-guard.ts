import "server-only";

import { BlobError, del, list, put } from "@vercel/blob";

/**
 * Upload limits for a free (Hobby) Vercel Blob store.
 *
 * On Hobby, exceeding the included storage, operations or transfer pauses
 * Blob for 30 days instead of billing, so these limits protect availability.
 * Three layers, because wallets are free to create:
 *
 * 1. Per-wallet quotas, reserved atomically before an upload is authorized.
 * 2. App-wide quotas that cap the total stored media regardless of how many
 *    wallets exist (the real protection against filling the store).
 * 3. A per-IP rate limit on upload authorizations (best effort, see below).
 */

function envLimit(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export const UPLOAD_LIMITS = {
  maxVideoBytes: 25_000_000,
  videosPerWallet: 3,
  eventUploadsPerWallet: 25,
  // Defaults keep worst-case media under ~900 MB of the 1 GB Hobby store:
  // 20 videos x 25 MB + 100 events x (3 MB image + 0.75 MB avatar).
  totalVideos: envLimit("SHOWUP_MAX_TOTAL_VIDEOS", 20),
  totalEventUploads: envLimit("SHOWUP_MAX_TOTAL_EVENT_UPLOADS", 100),
  // Per IP, per server instance.
  authorizationsPerWindow: 10,
  windowMs: 10 * 60 * 1000,
} as const;

export class UploadLimitError extends Error {}

const QUOTA_ROOT = "showup/quota";

function isAlreadyExists(error: unknown) {
  return error instanceof BlobError && /already exists/i.test(error.message);
}

/**
 * Atomically reserves one of `limit` numbered slots under `prefix`.
 * A slot is a tiny marker blob written without overwrite, so two concurrent
 * requests can never take the same slot: the second write is rejected and
 * moves on to the next slot. Returns the marker's URL so it can be released.
 */
async function claimSlot(prefix: string, limit: number) {
  const existing = await list({ prefix, limit: Math.min(limit, 1000) });
  const start = existing.blobs.length;

  for (let index = start; index < limit; index++) {
    try {
      const marker = await put(`${prefix}slot-${String(index).padStart(5, "0")}`, "1", {
        access: "public",
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType: "text/plain",
      });
      return marker.url;
    } catch (error) {
      if (isAlreadyExists(error)) {
        continue; // Taken by a concurrent request; try the next slot.
      }
      throw error; // Unknown failure: deny rather than allow.
    }
  }

  return null;
}

/**
 * Reserves a per-wallet slot and an app-wide slot. If the app-wide quota is
 * full, the wallet slot is released again.
 */
export async function reserveUploadQuota(
  kind: "videos" | "events",
  walletKey: string,
) {
  const perWallet =
    kind === "videos" ? UPLOAD_LIMITS.videosPerWallet : UPLOAD_LIMITS.eventUploadsPerWallet;
  const total =
    kind === "videos" ? UPLOAD_LIMITS.totalVideos : UPLOAD_LIMITS.totalEventUploads;

  const walletSlot = await claimSlot(
    `${QUOTA_ROOT}/${kind}/wallet/${walletKey.toLowerCase()}/`,
    perWallet,
  );

  if (!walletSlot) {
    throw new UploadLimitError(
      kind === "videos"
        ? `This wallet has reached the limit of ${perWallet} uploaded videos. Link an external video instead.`
        : `This wallet has reached the limit of ${perWallet} event uploads.`,
    );
  }

  const globalSlot = await claimSlot(`${QUOTA_ROOT}/${kind}/all/`, total);

  if (!globalSlot) {
    await del(walletSlot).catch(() => undefined);
    throw new UploadLimitError(
      kind === "videos"
        ? "Video uploads are full for now. Link an external video (for example YouTube) instead."
        : "Event uploads are temporarily full. Please try again later.",
    );
  }
}

// In-memory sliding window per client IP. Serverless instances do not share
// memory, so this limits bursts per instance rather than globally; the
// quotas above are the hard limits.
const recentByIp = new Map<string, number[]>();

export function enforceUploadRateLimit(request: Request) {
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const now = Date.now();
  const recent = (recentByIp.get(ip) ?? []).filter(
    (time) => now - time < UPLOAD_LIMITS.windowMs,
  );

  if (recent.length >= UPLOAD_LIMITS.authorizationsPerWindow) {
    throw new UploadLimitError("Too many uploads. Please wait a few minutes and try again.");
  }

  recent.push(now);
  recentByIp.set(ip, recent);

  if (recentByIp.size > 10_000) {
    recentByIp.clear();
  }
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0) {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/**
 * Identifies the format from the file's leading bytes rather than the
 * declared content type. This rejects renamed or mislabelled files; it does
 * not prove the file is complete or decodes correctly.
 */
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
 * Client uploads go straight to Blob, so their leading bytes are checked
 * after the upload completes and the file is deleted if it is not an
 * MP4/WebM container. (A format check, not proof the video plays.)
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
