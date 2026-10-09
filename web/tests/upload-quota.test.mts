import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";

/**
 * Tests the upload quota leases against an in-memory model of the Vercel
 * Blob operations they rely on: put without overwrite, put/del conditioned
 * on an ETag, list and head.
 */

process.env.SHOWUP_MAX_TOTAL_VIDEOS = "20";
process.env.SHOWUP_MAX_TOTAL_EVENT_UPLOADS = "5";

const guard = await import("../src/lib/upload-guard");
const {
  finalizeUploadReservation,
  LEASE_TTL_MS,
  releaseUploadReservation,
  reserveUploadQuota,
  setBlobApiForTesting,
  UploadLimitError,
} = guard;

let now = 1_800_000_000_000;
Date.now = () => now;

type Stored = { etag: string; uploadedAt: Date };
let store: Map<string, Stored>;
let etagCounter = 0;

function fakeBlobApi() {
  return {
    async list({ prefix }: { prefix?: string }) {
      const blobs = [...store.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix ?? ""))
        .map(([pathname, value]) => ({
          pathname,
          url: `https://blob.test/${pathname}`,
          downloadUrl: "",
          size: 1,
          ...value,
        }));
      return { blobs, hasMore: false, cursor: undefined };
    },
    async put(
      pathname: string,
      _body: unknown,
      options: { allowOverwrite?: boolean; ifMatch?: string },
    ) {
      // Yield first so concurrent callers interleave like real requests.
      await new Promise((resolve) => setImmediate(resolve));
      const existing = store.get(pathname);
      if (options.ifMatch !== undefined) {
        if (!existing || existing.etag !== options.ifMatch) {
          throw new BlobPreconditionFailedError();
        }
      } else if (existing && !options.allowOverwrite) {
        throw new BlobError("This blob already exists");
      }
      const value = { etag: `e${++etagCounter}`, uploadedAt: new Date(now) };
      store.set(pathname, value);
      return { pathname, url: `https://blob.test/${pathname}`, etag: value.etag };
    },
    async del(pathname: string, options?: { ifMatch?: string }) {
      await new Promise((resolve) => setImmediate(resolve));
      const existing = store.get(pathname);
      if (options?.ifMatch !== undefined && existing?.etag !== options.ifMatch) {
        throw new BlobPreconditionFailedError();
      }
      store.delete(pathname);
    },
    async head(pathname: string) {
      const existing = store.get(pathname);
      if (!existing) {
        throw new BlobError("Not found");
      }
      return { pathname, ...existing };
    },
  };
}

function finalizedCount(prefix: string) {
  return [...store.keys()].filter((key) => key.startsWith(prefix) && key.endsWith(".used"))
    .length;
}

beforeEach(() => {
  store = new Map();
  setBlobApiForTesting(fakeBlobApi() as never);
});

describe("upload quota leases", () => {
  it("does not let abandoned reservations block uploads forever", async () => {
    // 20 authorizations that never upload fill the app-wide video quota...
    for (let index = 0; index < 20; index++) {
      await reserveUploadQuota("videos", `wallet-${index}`);
    }
    await assert.rejects(reserveUploadQuota("videos", "late-wallet"), UploadLimitError);

    // ...but only until their leases expire.
    now += LEASE_TTL_MS.videos + 1;
    await reserveUploadQuota("videos", "late-wallet");
  });

  it("finds a released slot even when later slots are still taken", async () => {
    const first = await reserveUploadQuota("videos", "wallet-a");
    await reserveUploadQuota("videos", "wallet-a");
    await reserveUploadQuota("videos", "wallet-a");
    await assert.rejects(reserveUploadQuota("videos", "wallet-a"), UploadLimitError);

    await releaseUploadReservation(first); // frees slot 0 of 3
    await reserveUploadQuota("videos", "wallet-a");
  });

  it("keeps finalized uploads counted after the lease time", async () => {
    for (let index = 0; index < 3; index++) {
      await finalizeUploadReservation(await reserveUploadQuota("videos", "wallet-b"));
    }
    now += LEASE_TTL_MS.videos * 10;
    await assert.rejects(reserveUploadQuota("videos", "wallet-b"), UploadLimitError);
    assert.equal(finalizedCount("showup/quota/videos/wallet/wallet-b/"), 3);
  });

  it("never gives the same slot to concurrent requests", async () => {
    // App-wide event limit is 5; 12 wallets race for it.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) => reserveUploadQuota("events", `racer-${index}`)),
    );
    const granted = results.filter((result) => result.status === "fulfilled");
    assert.equal(granted.length, 5);

    const slots = granted.map(
      (result) =>
        (result as PromiseFulfilledResult<Awaited<ReturnType<typeof reserveUploadQuota>>>)
          .value.globalLease.pathname,
    );
    assert.equal(new Set(slots).size, 5);

    // Losing wallets got their wallet slot back.
    const walletMarkers = [...store.keys()].filter((key) =>
      key.startsWith("showup/quota/events/wallet/"),
    );
    assert.equal(walletMarkers.length, 5);
  });

  it("lets only one request take over an expired slot", async () => {
    for (let index = 0; index < 5; index++) {
      await reserveUploadQuota("events", `old-${index}`);
    }
    now += LEASE_TTL_MS.events + 1;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => reserveUploadQuota("events", `new-${index}`)),
    );
    const granted = results.filter((result) => result.status === "fulfilled");
    assert.equal(granted.length, 5);
  });

  it("does not finalize a slot that another request took over", async () => {
    const stale = await reserveUploadQuota("events", "slow-wallet");
    for (let index = 0; index < 4; index++) {
      await reserveUploadQuota("events", `filler-${index}`);
    }
    now += LEASE_TTL_MS.events + 1;
    // All five expired; a new request takes one of them over.
    const fresh = await reserveUploadQuota("events", "fresh-wallet");
    await finalizeUploadReservation(stale);
    await finalizeUploadReservation(fresh);

    const usedGlobal = finalizedCount("showup/quota/events/all/");
    // Only the slot still owned by its finalizer is marked used.
    assert.equal(
      usedGlobal,
      stale.globalLease.pathname === fresh.globalLease.pathname ? 1 : 2,
    );
    assert.ok(store.has(`${fresh.globalLease.pathname}.used`));
  });

  it("releases the wallet slot when the app-wide quota is full", async () => {
    for (let index = 0; index < 5; index++) {
      await reserveUploadQuota("events", `fill-${index}`);
    }
    await assert.rejects(reserveUploadQuota("events", "extra"), UploadLimitError);
    assert.equal(
      [...store.keys()].filter((key) => key.startsWith("showup/quota/events/wallet/extra/"))
        .length,
      0,
    );
  });
});
