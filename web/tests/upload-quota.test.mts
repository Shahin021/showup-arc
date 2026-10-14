import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { BlobError, BlobPreconditionFailedError } from "@vercel/blob";

/**
 * Tests the upload quota leases against an in-memory model of the Vercel
 * Blob operations they rely on: put without overwrite, put/del conditioned
 * on an ETag, list (with size, ETag and upload time), head and reads.
 * This is a model of the API, not the live service.
 */

process.env.SHOWUP_MAX_TOTAL_VIDEOS = "20";
process.env.SHOWUP_MAX_TOTAL_EVENT_UPLOADS = "5";

const guard = await import("../src/lib/upload-guard");
const {
  finalizeQuotaLease,
  finalizeUploadReservation,
  findOrphanedMedia,
  LEASE_TTL_MS,
  readCoveredMediaPaths,
  releaseUploadReservation,
  reserveUploadQuota,
  setBlobApiForTesting,
  UploadLimitError,
  UploadTransaction,
} = guard;

let now = 1_800_000_000_000;
Date.now = () => now;

type Stored = { etag: string; uploadedAt: Date; body: string };
let store: Map<string, Stored>;
let etagCounter = 0;
let failDeletes = false;
let failReads = false;
// Simulated CDN: when on, content reads return the version captured in
// `cdnCache` (with that version's ETag), whatever the query string says.
let staleCdn = false;
let omitEtagHeader = false;
const cdnCache = new Map<string, { body: string; etag: string }>();

// Each storage call waits a pseudo-random number of event-loop turns, so
// concurrent requests interleave in different orders (deterministic seed).
let seed = 42;
function random() {
  seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
  return seed / 2_147_483_648;
}
async function tick() {
  const turns = 1 + Math.floor(random() * 4);
  for (let turn = 0; turn < turns; turn++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function fakeBlobApi() {
  return {
    async list({ prefix }: { prefix?: string }) {
      await tick();
      const blobs = [...store.entries()]
        .filter(([pathname]) => pathname.startsWith(prefix ?? ""))
        .map(([pathname, value]) => ({
          pathname,
          url: `https://blob.test/${pathname}`,
          downloadUrl: "",
          size: Buffer.byteLength(value.body),
          etag: value.etag,
          uploadedAt: value.uploadedAt,
        }));
      return { blobs, hasMore: false, cursor: undefined };
    },
    async put(
      pathname: string,
      body: string,
      options: { allowOverwrite?: boolean; ifMatch?: string },
    ) {
      // Yield first so concurrent callers interleave like real requests.
      await tick();
      const existing = store.get(pathname);
      if (options.ifMatch !== undefined) {
        if (!existing || existing.etag !== options.ifMatch) {
          throw new BlobPreconditionFailedError();
        }
      } else if (existing && !options.allowOverwrite) {
        throw new BlobError("This blob already exists");
      }
      const value = { etag: `e${++etagCounter}`, uploadedAt: new Date(now), body: String(body) };
      store.set(pathname, value);
      return { pathname, url: `https://blob.test/${pathname}`, etag: value.etag };
    },
    async del(target: string | string[], options?: { ifMatch?: string }) {
      await tick();
      if (failDeletes) {
        throw new BlobError("Service unavailable");
      }
      for (const item of Array.isArray(target) ? target : [target]) {
        const pathname = item.replace("https://blob.test/", "");
        const existing = store.get(pathname);
        if (options?.ifMatch !== undefined && existing?.etag !== options.ifMatch) {
          throw new BlobPreconditionFailedError();
        }
        store.delete(pathname);
      }
    },
    async head(pathname: string) {
      const existing = store.get(pathname);
      if (!existing) {
        throw new BlobError("The requested blob does not exist");
      }
      return {
        pathname,
        url: `https://blob.test/${pathname}`,
        size: Buffer.byteLength(existing.body),
        ...existing,
      };
    },
    async fetch(url: string, init?: { headers?: Record<string, string> }) {
      await tick();
      if (failReads) {
        return new Response("unavailable", { status: 503 });
      }
      const pathname = url.replace("https://blob.test/", "").split("?")[0];
      const current = store.get(pathname);
      const served =
        staleCdn && cdnCache.has(pathname)
          ? cdnCache.get(pathname)!
          : current
            ? { body: current.body, etag: current.etag }
            : null;
      if (!served) {
        return new Response("not found", { status: 404 });
      }
      const range = init?.headers?.Range;
      const body = range ? served.body.slice(0, 16) : served.body;
      const headers: Record<string, string> = omitEtagHeader ? {} : { etag: `"${served.etag}"` };
      return new Response(body, { status: range ? 206 : 200, headers });
    },
  };
}

const keysUnder = (prefix: string) => [...store.keys()].filter((key) => key.startsWith(prefix));
const usedUnder = (prefix: string) =>
  keysUnder(prefix).filter((key) => store.get(key)!.body.startsWith("U:"));

beforeEach(() => {
  store = new Map();
  failDeletes = false;
  failReads = false;
  staleCdn = false;
  omitEtagHeader = false;
  cdnCache.clear();
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
      const reservation = await reserveUploadQuota("videos", "wallet-b");
      assert.equal(await finalizeUploadReservation(reservation, `showup/videos/b/${index}.mp4`), true);
    }
    now += LEASE_TTL_MS.videos * 10;
    await assert.rejects(reserveUploadQuota("videos", "wallet-b"), UploadLimitError);
    assert.equal(usedUnder("showup/quota/videos/wallet/wallet-b/").length, 3);
  });

  it("never gives the same slot to concurrent requests", async () => {
    // App-wide event limit is 5; 12 wallets race for it.
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, index) => reserveUploadQuota("events", `racer-${index}`)),
    );
    const granted = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
    assert.equal(granted.length, 5);
    assert.equal(new Set(granted.map((r) => r.globalLease.pathname)).size, 5);
    // Losing wallets got their wallet slot back.
    assert.equal(keysUnder("showup/quota/events/wallet/").length, 5);
  });

  it("lets only one request take over an expired slot", async () => {
    for (let index = 0; index < 5; index++) {
      await reserveUploadQuota("events", `old-${index}`);
    }
    now += LEASE_TTL_MS.events + 1;
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) => reserveUploadQuota("events", `new-${index}`)),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 5);
  });

  it("cannot finalize a slot after another request took it over", async () => {
    const stale = await reserveUploadQuota("events", "slow-wallet");
    for (let index = 0; index < 4; index++) {
      await reserveUploadQuota("events", `filler-${index}`);
    }
    now += LEASE_TTL_MS.events + 1;
    const fresh = await reserveUploadQuota("events", "fresh-wallet");

    // Whatever slot the fresh request took, the stale request can only
    // finalize a slot that is still its own.
    const staleResult = await finalizeUploadReservation(stale, "showup/events/slow/");
    const freshResult = await finalizeUploadReservation(fresh, "showup/events/fresh/");
    assert.equal(freshResult, true);
    if (stale.globalLease.pathname === fresh.globalLease.pathname) {
      assert.equal(staleResult, false);
    }
    const freshSlot = store.get(fresh.globalLease.pathname)!;
    assert.equal(freshSlot.body, "U:showup/events/fresh/");
  });

  it("never lets a stale finalize overwrite a takeover that happens at the same time", async () => {
    // One slot, lease expired; the stale owner finalizes while a newcomer
    // takes over. Run many interleavings.
    let oldWins = 0;
    let newWins = 0;
    for (let round = 0; round < 45; round++) {
      store = new Map();
      setBlobApiForTesting(fakeBlobApi() as never);
      const lease = (await reserveUploadQuota("events", "old")).globalLease;
      now += LEASE_TTL_MS.events + 1;
      // Fill the other four app-wide slots so the newcomer must take over.
      for (let index = 0; index < 4; index++) {
        await reserveUploadQuota("events", `fill-${round}-${index}`);
      }
      // Start the stale finalize at a varying point during the takeover.
      const delayTurns = round % 15;
      const [finalized, takeover] = await Promise.allSettled([
        (async () => {
          for (let turn = 0; turn < delayTurns; turn++) {
            await new Promise((resolve) => setImmediate(resolve));
          }
          return finalizeQuotaLease(lease, "showup/events/old/");
        })(),
        reserveUploadQuota("events", `new-${round}`),
      ]);
      const oldWon = finalized.status === "fulfilled" && finalized.value !== null;
      const newWon =
        takeover.status === "fulfilled" && takeover.value.globalLease.pathname === lease.pathname;
      assert.ok(!(oldWon && newWon), "both requests own the same slot");
      oldWins += oldWon ? 1 : 0;
      newWins += newWon ? 1 : 0;
      const record = store.get(lease.pathname)!;
      if (oldWon) {
        assert.equal(record.body, "U:showup/events/old/");
      }
      if (newWon) {
        assert.equal(record.body, "R");
      }
    }
    // Both orders must actually have happened for the test to mean anything.
    assert.ok(oldWins > 0 && newWins > 0, `old ${oldWins}, new ${newWins}`);
  });

  it("treats a repeated completion callback for the same file as success", async () => {
    const reservation = await reserveUploadQuota("videos", "wallet-r");
    const path = "showup/videos/wallet-r/clip-abc123.mp4";
    assert.equal(await finalizeUploadReservation(reservation, path), true);
    // The webhook is delivered again with the same token payload.
    assert.equal(await finalizeUploadReservation(reservation, path), true);
    assert.equal(store.get(reservation.globalLease.pathname)!.body, `U:${path}`);
  });

  it("treats concurrent completion callbacks for the same file as success", async () => {
    for (let round = 0; round < 20; round++) {
      store = new Map();
      setBlobApiForTesting(fakeBlobApi() as never);
      const reservation = await reserveUploadQuota("videos", "wallet-c2");
      const path = `showup/videos/wallet-c2/clip-${round}.mp4`;
      const results = await Promise.all([
        finalizeUploadReservation(reservation, path),
        finalizeUploadReservation(reservation, path),
        finalizeUploadReservation(reservation, path),
      ]);
      assert.deepEqual(results, [true, true, true]);
      assert.equal(store.get(reservation.walletLease.pathname)!.body, `U:${path}`);
      assert.equal(store.get(reservation.globalLease.pathname)!.body, `U:${path}`);
    }
  });

  it("does not count a slot finalized for a different file as ours", async () => {
    const reservation = await reserveUploadQuota("videos", "wallet-x");
    assert.equal(
      await finalizeUploadReservation(reservation, "showup/videos/wallet-x/one.mp4"),
      true,
    );
    assert.equal(
      await finalizeUploadReservation(reservation, "showup/videos/wallet-x/two.mp4"),
      false,
    );
  });

  it("throws instead of reporting a lost lease when the slot cannot be read", async () => {
    const reservation = await reserveUploadQuota("videos", "wallet-f");
    const path = "showup/videos/wallet-f/clip.mp4";
    await finalizeUploadReservation(reservation, path);
    failReads = true;
    await assert.rejects(finalizeUploadReservation(reservation, path));
  });

  it("rolls back the wallet slot when the app-wide slot was lost", async () => {
    const reservation = await reserveUploadQuota("events", "wallet-c");
    // Simulate losing the app-wide lease to a takeover.
    store.set(reservation.globalLease.pathname, {
      etag: "someone-else",
      uploadedAt: new Date(now),
      body: "R",
    });
    assert.equal(await finalizeUploadReservation(reservation, "showup/events/c/"), false);
    assert.equal(keysUnder("showup/quota/events/wallet/wallet-c/").length, 0);
  });

  it("releases the wallet slot when the app-wide quota is full", async () => {
    for (let index = 0; index < 5; index++) {
      await reserveUploadQuota("events", `fill-${index}`);
    }
    await assert.rejects(reserveUploadQuota("events", "extra"), UploadLimitError);
    assert.equal(keysUnder("showup/quota/events/wallet/extra/").length, 0);
  });
});

const VIDEO_BYTES = "\u0000\u0000\u0000\u0018ftypmp42-rest-of-the-video";

/** Stores a video file and returns what the completion callback receives. */
async function storeVideo(wallet: string, name: string) {
  const reservation = await reserveUploadQuota("videos", wallet);
  const pathname = `showup/videos/${wallet}/${name}.mp4`;
  await fakeBlobApi().put(pathname, VIDEO_BYTES, {});
  return { url: `https://blob.test/${pathname}`, pathname, reservation };
}

describe("video completion callback", () => {
  it("keeps a valid video and finalizes its slots", async () => {
    const upload = await storeVideo("wallet-v", "clip-a1");
    assert.equal(await guard.completeVideoUpload(upload), "kept");
    assert.ok(store.has(upload.pathname));
    assert.equal(store.get(upload.reservation.globalLease.pathname)!.body, `U:${upload.pathname}`);
  });

  it("keeps the video when a repeated callback sees fresh metadata but stale CDN content", async () => {
    const upload = await storeVideo("wallet-s", "clip-s1");
    // The CDN cached the slots while they were still reserved ("R").
    for (const lease of [upload.reservation.walletLease, upload.reservation.globalLease]) {
      const record = store.get(lease.pathname)!;
      cdnCache.set(lease.pathname, { body: record.body, etag: record.etag });
    }
    assert.equal(await guard.completeVideoUpload(upload), "kept");

    // Redelivered webhook: head() is fresh (used), the CDN still serves "R".
    staleCdn = true;
    const second = await guard.completeVideoUpload(upload);
    assert.equal(second, "kept-unknown");
    assert.ok(store.has(upload.pathname), "the successful video was deleted");
    assert.equal(store.get(upload.reservation.globalLease.pathname)!.body, `U:${upload.pathname}`);
  });

  it("keeps the video when the CDN serves the right bytes without a verifiable ETag", async () => {
    const upload = await storeVideo("wallet-n", "clip-n1");
    assert.equal(await guard.completeVideoUpload(upload), "kept");
    omitEtagHeader = true;
    assert.equal(await guard.completeVideoUpload(upload), "kept-unknown");
    assert.ok(store.has(upload.pathname));
  });

  it("never deletes a successful video under repeated, concurrent callbacks with a stale CDN", async () => {
    for (let round = 0; round < 20; round++) {
      store = new Map();
      cdnCache.clear();
      setBlobApiForTesting(fakeBlobApi() as never);
      staleCdn = round % 2 === 0;
      const upload = await storeVideo("wallet-cc", `clip-${round}`);
      for (const lease of [upload.reservation.walletLease, upload.reservation.globalLease]) {
        const record = store.get(lease.pathname)!;
        cdnCache.set(lease.pathname, { body: record.body, etag: record.etag });
      }
      const outcomes = await Promise.all([
        guard.completeVideoUpload(upload),
        guard.completeVideoUpload(upload),
        guard.completeVideoUpload(upload),
      ]);
      assert.ok(store.has(upload.pathname), `round ${round}: video deleted (${outcomes})`);
      assert.ok(outcomes.includes("kept"), `round ${round}: never finalized (${outcomes})`);
      assert.ok(
        outcomes.every((outcome) => outcome === "kept" || outcome === "kept-unknown"),
        `round ${round}: ${outcomes}`,
      );
      assert.equal(store.get(upload.reservation.walletLease.pathname)!.body, `U:${upload.pathname}`);
    }
  });

  it("deletes the video only on verified evidence that its slot is someone else's", async () => {
    const upload = await storeVideo("wallet-l", "clip-l1");
    // The global lease was verifiably taken over (a different "R" record).
    store.set(upload.reservation.globalLease.pathname, {
      etag: "takeover",
      uploadedAt: new Date(now),
      body: "R",
    });
    assert.equal(await guard.completeVideoUpload(upload), "deleted-lost-quota");
    assert.ok(!store.has(upload.pathname));
  });

  it("keeps the video when its bytes cannot be read", async () => {
    const upload = await storeVideo("wallet-u", "clip-u1");
    failReads = true;
    assert.equal(await guard.completeVideoUpload(upload), "kept-unknown");
    assert.ok(store.has(upload.pathname));
  });

  it("deletes a file whose bytes were read and are not a video", async () => {
    const reservation = await reserveUploadQuota("videos", "wallet-i");
    const pathname = "showup/videos/wallet-i/fake.mp4";
    await fakeBlobApi().put(pathname, "this is not a video file at all", {});
    const outcome = await guard.completeVideoUpload({
      url: `https://blob.test/${pathname}`,
      pathname,
      reservation,
    });
    assert.equal(outcome, "deleted-invalid");
    assert.ok(!store.has(pathname));
  });
});

describe("upload rollback and cleanup", () => {
  it("aborts the cleanup when the CDN serves stale used records", async () => {
    const reservation = await reserveUploadQuota("events", "wallet-cdn");
    const record = store.get(reservation.globalLease.pathname)!;
    cdnCache.set(reservation.globalLease.pathname, { body: record.body, etag: record.etag });
    await finalizeUploadReservation(reservation, "showup/events/wallet-cdn/kept/");
    staleCdn = true;
    await assert.rejects(readCoveredMediaPaths("events"), guard.QuotaReadError);
  });

  it("removes every file of a failed upload", async () => {
    const api = fakeBlobApi();
    const transaction = new UploadTransaction();
    for (const name of ["event-image.png", "organizer-avatar.png"]) {
      const blob = await api.put(`showup/events/w/1/${name}`, "x", {});
      transaction.record(blob.url);
    }
    await transaction.rollback();
    assert.equal(keysUnder("showup/events/").length, 0);
  });

  it("does not throw when deletion fails, leaving the files to the cleanup job", async () => {
    const api = fakeBlobApi();
    const transaction = new UploadTransaction();
    transaction.record((await api.put("showup/events/w/2/event-image.png", "x", {})).url);
    failDeletes = true;
    const originalError = console.error;
    console.error = () => undefined;
    await transaction.rollback();
    console.error = originalError;
    assert.equal(keysUnder("showup/events/").length, 1);
  });

  it("aborts instead of treating an unreadable used record as missing", async () => {
    const reservation = await reserveUploadQuota("events", "wallet-e");
    await finalizeUploadReservation(reservation, "showup/events/wallet-e/kept/");
    failReads = true;
    await assert.rejects(readCoveredMediaPaths("events"), guard.QuotaReadError);
  });

  it("aborts on a used record with invalid content", async () => {
    const reservation = await reserveUploadQuota("events", "wallet-g");
    await finalizeUploadReservation(reservation, "showup/events/wallet-g/kept/");
    store.get(reservation.globalLease.pathname)!.body = "U:garbage";
    await assert.rejects(readCoveredMediaPaths("events"), guard.QuotaReadError);
  });

  it("finds media not covered by a used slot, but leaves recent uploads alone", async () => {
    const api = fakeBlobApi();
    const reservation = await reserveUploadQuota("events", "wallet-d");
    await finalizeUploadReservation(reservation, "showup/events/wallet-d/kept/");
    const covered = await readCoveredMediaPaths("events");

    const media = [
      { pathname: "showup/events/wallet-d/kept/metadata.json", uploadedAt: new Date(now - 3_600_000) },
      { pathname: "showup/events/wallet-d/orphan/event-image.png", uploadedAt: new Date(now - 3_600_000) },
      { pathname: "showup/events/wallet-d/in-flight/event-image.png", uploadedAt: new Date(now - 1_000) },
    ].map((file) => ({ ...file, url: `https://blob.test/${file.pathname}` }));
    await api.put("unused", "x", {});

    const orphans = findOrphanedMedia(media, covered, now, 60 * 60 * 1000 - 1);
    assert.deepEqual(
      orphans.map((file) => file.pathname),
      ["showup/events/wallet-d/orphan/event-image.png"],
    );
  });
});
