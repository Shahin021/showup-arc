import "server-only";

import {
  BlobPreconditionFailedError,
  del,
  head,
  list,
  put,
} from "@vercel/blob";

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

// Indirection so the lease logic can be tested against an in-memory store
// (see web/tests/upload-quota.test.ts).
let blobApi = { list, put, del, head };

export function setBlobApiForTesting(api: typeof blobApi) {
  blobApi = api;
}

/**
 * How long an unconfirmed reservation holds its slot. A video reservation
 * must outlive the client upload token (10 minutes) plus the time to upload
 * 25 MB; an event upload happens inside a single request.
 */
export const LEASE_TTL_MS = {
  videos: 40 * 60 * 1000,
  events: 5 * 60 * 1000,
} as const;

/**
 * A reserved quota slot. Slots work as leases on a Blob store, which has no
 * transactions, using only fresh metadata (never cached file contents):
 *
 * - `slot-N` exists: the slot is reserved; its upload time is the lease start.
 * - `slot-N.used` exists too: the upload succeeded and the slot is final.
 * - A reserved slot without `.used` whose lease is older than the TTL has
 *   expired and can be taken over.
 *
 * Taking a free slot is a write without overwrite; taking over an expired
 * one is a write conditioned on the old ETag. Either way only one request
 * can win a slot. Releasing deletes the marker only if it is still ours.
 */
export type QuotaLease = {
  pathname: string;
  etag: string;
};

// Matched by message and name as well as class, so detection does not
// depend on which build of the SDK module threw the error.
function isAlreadyExists(error: unknown) {
  return error instanceof Error && /already exists/i.test(error.message);
}

function isPreconditionFailed(error: unknown) {
  return (
    error instanceof BlobPreconditionFailedError ||
    (error instanceof Error &&
      (error.name === "BlobPreconditionFailedError" ||
        /precondition/i.test(error.message)))
  );
}

function isLostRace(error: unknown) {
  return isPreconditionFailed(error) || isAlreadyExists(error);
}

function slotPath(prefix: string, index: number) {
  return `${prefix}slot-${String(index).padStart(5, "0")}`;
}

async function claimSlot(
  prefix: string,
  limit: number,
  ttlMs: number,
): Promise<QuotaLease | null> {
  // One listing gives every marker's ETag and upload time.
  const markers = new Map<string, { etag: string; uploadedAt: Date }>();
  let cursor: string | undefined;
  do {
    const page = await blobApi.list({ prefix, cursor, limit: 1000 });
    for (const blob of page.blobs) {
      markers.set(blob.pathname, { etag: blob.etag, uploadedAt: blob.uploadedAt });
    }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const now = Date.now();
  const free: number[] = [];
  const expired: { index: number; etag: string }[] = [];

  // Consider every slot, not just those after the current count, so a slot
  // released in the middle is found again.
  for (let index = 0; index < limit; index++) {
    const pathname = slotPath(prefix, index);
    const marker = markers.get(pathname);
    if (!marker) {
      free.push(index);
    } else if (
      !markers.has(`${pathname}.used`) &&
      now - marker.uploadedAt.getTime() > ttlMs
    ) {
      expired.push({ index, etag: marker.etag });
    }
  }

  const attempts = [
    ...free.map((index) => ({ index, ifMatch: undefined as string | undefined })),
    ...expired.map(({ index, etag }) => ({ index, ifMatch: etag })),
  ];

  for (const { index, ifMatch } of attempts) {
    const pathname = slotPath(prefix, index);
    try {
      const marker = await blobApi.put(pathname, String(now), {
        access: "public",
        addRandomSuffix: false,
        contentType: "text/plain",
        ...(ifMatch ? { allowOverwrite: true, ifMatch } : { allowOverwrite: false }),
      });
      return { pathname, etag: marker.etag };
    } catch (error) {
      if (isLostRace(error)) {
        continue; // Another request took it first; try the next slot.
      }
      throw error; // Unknown failure: deny rather than allow.
    }
  }

  return null;
}

/** Gives a reservation back, unless someone else has taken the slot over. */
export async function releaseQuotaLease(lease: QuotaLease) {
  try {
    await blobApi.del(lease.pathname, { ifMatch: lease.etag });
  } catch {
    // Already taken over or deleted; nothing to release.
  }
}

/**
 * Marks a reservation as used once its upload has succeeded. If the lease
 * expired and another request took the slot over meanwhile, the slot is
 * not finalized here (the other request owns it).
 */
export async function finalizeQuotaLease(lease: QuotaLease) {
  try {
    const current = await blobApi.head(lease.pathname);
    if (current.etag !== lease.etag) {
      return;
    }
    await blobApi.put(`${lease.pathname}.used`, "1", {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: false,
      contentType: "text/plain",
    });
  } catch (error) {
    if (!isAlreadyExists(error)) {
      console.error("ShowUp could not finalize an upload quota slot:", error);
    }
  }
}

export type UploadReservation = {
  walletLease: QuotaLease;
  globalLease: QuotaLease;
};

/**
 * Reserves a per-wallet slot and an app-wide slot for one upload. Call
 * `finalizeUploadReservation` after the upload succeeds and
 * `releaseUploadReservation` if it fails; an abandoned reservation expires
 * after LEASE_TTL_MS and its slots become available again.
 */
export async function reserveUploadQuota(
  kind: "videos" | "events",
  walletKey: string,
): Promise<UploadReservation> {
  const perWallet =
    kind === "videos" ? UPLOAD_LIMITS.videosPerWallet : UPLOAD_LIMITS.eventUploadsPerWallet;
  const total =
    kind === "videos" ? UPLOAD_LIMITS.totalVideos : UPLOAD_LIMITS.totalEventUploads;
  const ttl = LEASE_TTL_MS[kind];

  const walletLease = await claimSlot(
    `${QUOTA_ROOT}/${kind}/wallet/${walletKey.toLowerCase()}/`,
    perWallet,
    ttl,
  );

  if (!walletLease) {
    throw new UploadLimitError(
      kind === "videos"
        ? `This wallet has reached the limit of ${perWallet} uploaded videos. Link an external video instead.`
        : `This wallet has reached the limit of ${perWallet} event uploads.`,
    );
  }

  const globalLease = await claimSlot(`${QUOTA_ROOT}/${kind}/all/`, total, ttl);

  if (!globalLease) {
    await releaseQuotaLease(walletLease);
    throw new UploadLimitError(
      kind === "videos"
        ? "Video uploads are full for now. Link an external video (for example YouTube) instead."
        : "Event uploads are temporarily full. Please try again later.",
    );
  }

  return { walletLease, globalLease };
}

export async function finalizeUploadReservation(reservation: UploadReservation) {
  await Promise.all([
    finalizeQuotaLease(reservation.walletLease),
    finalizeQuotaLease(reservation.globalLease),
  ]);
}

export async function releaseUploadReservation(reservation: UploadReservation) {
  await Promise.all([
    releaseQuotaLease(reservation.walletLease),
    releaseQuotaLease(reservation.globalLease),
  ]);
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
