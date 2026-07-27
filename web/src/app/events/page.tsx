"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import CircleWalletButton from "@/components/circle-wallet-button";

type OnchainEvent = {
  id: string;
  organizer: string;
  title: string;
  description: string;

  eventType: number;
  eventTypeLabel: string;

  accessMode?: number;
  accessModeLabel?: string;

  deposit: string;
  depositAmount: string;

  totalPrice: string;
  totalPriceAmount: string;

  capacity: string;
  reservedSeats: string;
  escrowedAmount: string;
  cancellationDeadline: string;
  eventStart: string;
  eventEnd: string;
  resolutionDeadline: string;
  cancelled: boolean;
};

type EventsResponse = {
  events?: OnchainEvent[];
  contractAddress?: string;
  error?: string;
};

type EventStatus =
  | "Open"
  | "Cancellation closed"
  | "Live"
  | "Resolving"
  | "Ended"
  | "Cancelled";

function shortenAddress(address: string) {
  if (address.length <= 14) {
    return address;
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function timestampToDate(timestamp: string) {
  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds)) {
    return null;
  }

  const date = new Date(seconds * 1000);

  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(timestamp: string) {
  const date = timestampToDate(timestamp);

  if (!date) {
    return {
      day: "--",
      month: "---",
    };
  }

  return {
    day: date.toLocaleString(undefined, {
      day: "2-digit",
    }),
    month: date
      .toLocaleString(undefined, {
        month: "short",
      })
      .toUpperCase(),
  };
}

function formatDateTime(timestamp: string) {
  const date = timestampToDate(timestamp);

  if (!date) {
    return "Unknown";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getEventStatus(event: OnchainEvent): EventStatus {
  if (event.cancelled) {
    return "Cancelled";
  }

  const now = Math.floor(Date.now() / 1000);
  const cancellationDeadline = Number(event.cancellationDeadline);
  const eventStart = Number(event.eventStart);
  const eventEnd = Number(event.eventEnd);
  const resolutionDeadline = Number(event.resolutionDeadline);

  if (now < cancellationDeadline) {
    return "Open";
  }

  if (now < eventStart) {
    return "Cancellation closed";
  }

  if (now < eventEnd) {
    return "Live";
  }

  if (now < resolutionDeadline) {
    return "Resolving";
  }

  return "Ended";
}

function getStatusClassName(status: EventStatus) {
  if (status === "Open") {
    return "border-[#72cfff]/25 bg-[#288cff]/10 text-[#a8e2ff]";
  }

  if (status === "Live") {
    return "border-[#73d8ff]/25 bg-[#40bfff]/10 text-[#b8ebff]";
  }

  if (
    status === "Cancellation closed" ||
    status === "Resolving"
  ) {
    return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  }

  if (status === "Cancelled") {
    return "border-red-300/20 bg-red-300/10 text-red-200";
  }

  return "border-white/10 bg-white/[0.04] text-white/50";
}

function getCapacityDetails(event: OnchainEvent) {
  const capacity = BigInt(event.capacity);
  const reserved = BigInt(event.reservedSeats);

  if (capacity === BigInt(0)) {
    return {
      remaining: "Unlimited",
      reservedLabel: `${reserved.toString()} reserved`,
      progress: 0,
      unlimited: true,
    };
  }

  const remaining =
    capacity > reserved
      ? capacity - reserved
      : BigInt(0);

  const progress = Math.min(
    100,
    Math.round(
      (Number(reserved) / Number(capacity)) * 100,
    ),
  );

  return {
    remaining: remaining.toString(),
    reservedLabel: `${reserved.toString()} of ${capacity.toString()} reserved`,
    progress,
    unlimited: false,
  };
}

export default function EventsPage() {
  const [events, setEvents] = useState<OnchainEvent[]>([]);
  const [contractAddress, setContractAddress] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadEvents = useCallback(async () => {
    try {
      setLoading(true);
      setError("");

      const response = await fetch("/api/events", {
        method: "GET",
        cache: "no-store",
      });

      const data = (await response.json()) as EventsResponse;

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Unable to load events from Arc Testnet.",
        );
      }

      setEvents(data.events ?? []);
      setContractAddress(data.contractAddress ?? "");
    } catch (loadError) {
      console.error(
        "Unable to load ShowUp events:",
        loadError,
      );

      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load events from Arc Testnet.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <main className="min-h-screen bg-[#050817] text-white">
      <header className="relative z-[100] overflow-visible border-b border-[#79b7ff]/12 bg-[#050817]/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#73d8ff] to-[#9285ff] text-lg font-black text-[#050817] shadow-lg shadow-[#4b9cff]/20">
              S
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight">
                ShowUp
              </p>

              <p className="text-xs text-white/45">
                Programmable commitment on Arc
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <Link
              href="/"
              className="transition hover:text-[#8fd8ff]"
            >
              Home
            </Link>

            <Link
              href="/events"
              className="font-medium text-[#82d3ff]"
            >
              Explore
            </Link>

            <Link
              href="/create"
              className="transition hover:text-[#8fd8ff]"
            >
              Create event
            </Link>
          </nav>

          <CircleWalletButton />
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-[#79b7ff]/12">
        <div className="pointer-events-none absolute left-[40%] top-[-260px] h-[650px] w-[760px] -translate-x-1/2 rounded-full bg-[#288cff]/15 blur-[180px]" />

        <div className="pointer-events-none absolute right-[-180px] top-[-60px] h-[440px] w-[440px] rounded-full bg-[#8d70ff]/10 blur-[160px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-16">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-[#72cfff]/25 bg-[#288cff]/10 px-4 py-2 text-sm text-[#a8e2ff]">
                <span className="h-2 w-2 rounded-full bg-[#75d7ff] shadow-[0_0_16px_rgba(117,215,255,0.95)]" />
                Live events from Arc Testnet
              </div>

              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                Reserve a seat.
                <span className="block bg-gradient-to-r from-[#75d7ff] via-[#70aaff] to-[#9b89ff] bg-clip-text text-transparent">
                  Make the commitment count.
                </span>
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/52">
                Explore public and invite-only events read directly from
                the deployed ShowUp V5 smart contract on Arc.
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="relative hidden h-14 w-14 overflow-hidden rounded-2xl border border-[#79cfff]/20 bg-[#061530] shadow-lg shadow-[#268cff]/15 sm:block">
                <Image
                  src="/arc-logo-glow.webp"
                  alt="Arc network logo"
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              </div>

              <Link
                href="/create"
                className="w-fit shrink-0 rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-7 py-3.5 text-center font-semibold text-[#050817] shadow-lg shadow-[#428fff]/15 transition hover:-translate-y-0.5 hover:brightness-110"
              >
                Create an event
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="relative mx-auto max-w-7xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="pointer-events-none absolute right-[-160px] top-[180px] h-[420px] w-[420px] rounded-full bg-[#725cff]/8 blur-[170px]" />

        <div className="relative">
          <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#82d3ff]">
                Onchain events
              </p>

              <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                Upcoming commitments
              </h2>
            </div>

            <div className="flex items-center gap-3">
              {!loading && !error ? (
                <p className="text-sm text-white/35">
                  {events.length}{" "}
                  {events.length === 1
                    ? "event"
                    : "events"}{" "}
                  found
                </p>
              ) : null}

              <button
                type="button"
                onClick={() => {
                  void loadEvents();
                }}
                disabled={loading}
                className="rounded-full border border-[#79b7ff]/15 bg-[#0a1025] px-4 py-2 text-sm text-white/60 transition hover:border-[#79cfff]/35 hover:text-white disabled:cursor-wait disabled:opacity-50"
              >
                {loading ? "Loading..." : "Refresh"}
              </button>
            </div>
          </div>

          {error ? (
            <div className="rounded-[28px] border border-red-400/20 bg-red-400/10 p-6 text-red-200">
              <p className="font-medium">
                Events could not be loaded.
              </p>

              <p className="mt-2 text-sm leading-6 text-red-200/70">
                {error}
              </p>
            </div>
          ) : null}

          {loading ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-[520px] animate-pulse rounded-[28px] border border-[#79b7ff]/12 bg-[#0a1025]"
                />
              ))}
            </div>
          ) : null}

          {!loading &&
          !error &&
          events.length === 0 ? (
            <div className="rounded-[30px] border border-[#79b7ff]/12 bg-[#0a1025] p-10 text-center">
              <h3 className="text-2xl font-semibold">
                No events have been created yet.
              </h3>

              <p className="mt-3 text-white/45">
                Create the first accountable event on Arc Testnet.
              </p>

              <Link
                href="/create"
                className="mt-7 inline-block rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-7 py-3.5 font-semibold text-[#050817]"
              >
                Create an event
              </Link>
            </div>
          ) : null}

          {!loading && !error && events.length > 0 ? (
            <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
              {events.map((event) => {
                const status = getEventStatus(event);
                const date = formatDate(event.eventStart);
                const capacity = getCapacityDetails(event);

                const accessModeLabel =
                  event.accessModeLabel ??
                  (event.accessMode === 1
                    ? "Invite-only"
                    : "Public");

                return (
                  <article
                    key={event.id}
                    className="group flex h-full flex-col rounded-[28px] border border-[#79b7ff]/14 bg-[#0a1025]/85 p-3 transition hover:-translate-y-1 hover:border-[#73caff]/30 hover:shadow-2xl hover:shadow-[#267cff]/10"
                  >
                    <div className="flex h-full flex-col rounded-[23px] border border-[#79b7ff]/10 bg-[#070c1d] p-6">
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
                            Event #{event.id}
                          </span>

                          <span
                            className={`rounded-full border px-3 py-1.5 text-xs ${getStatusClassName(
                              status,
                            )}`}
                          >
                            {status}
                          </span>
                        </div>

                        <div className="shrink-0 rounded-2xl bg-gradient-to-br from-[#73d8ff] to-[#8195ff] px-3 py-2 text-center text-[#050817] shadow-lg shadow-[#428fff]/15">
                          <p className="text-xs font-semibold">
                            {date.month}
                          </p>

                          <p className="text-xl font-black">
                            {date.day}
                          </p>
                        </div>
                      </div>

                      <div className="mt-5 flex flex-wrap gap-2">
                        <span className="rounded-full border border-[#72cfff]/18 bg-[#288cff]/8 px-3 py-1 text-xs text-[#a8e2ff]">
                          {event.eventTypeLabel}
                        </span>

                        <span className="rounded-full border border-[#9c8cff]/18 bg-[#8d70ff]/8 px-3 py-1 text-xs text-[#c3b9ff]">
                          {accessModeLabel}
                        </span>
                      </div>

                      <h3 className="mt-5 break-words text-2xl font-semibold leading-tight">
                        {event.title}
                      </h3>

                      <p className="mt-3 min-h-20 break-words text-sm leading-6 text-white/45">
                        {event.description ||
                          "No description was provided."}
                      </p>

                      <div className="mt-6 space-y-3 border-y border-[#79b7ff]/10 py-5">
                        <div className="flex items-start justify-between gap-4 text-sm">
                          <span className="text-white/35">
                            Starts
                          </span>

                          <span className="text-right font-medium text-white/70">
                            {formatDateTime(event.eventStart)}
                          </span>
                        </div>

                        <div className="flex items-start justify-between gap-4 text-sm">
                          <span className="text-white/35">
                            Ends
                          </span>

                          <span className="text-right font-medium text-white/70">
                            {formatDateTime(event.eventEnd)}
                          </span>
                        </div>

                        <div className="flex items-center justify-between gap-4 text-sm">
                          <span className="text-white/35">
                            Organizer
                          </span>

                          <span
                            title={event.organizer}
                            className="font-mono text-xs text-white/70"
                          >
                            {shortenAddress(event.organizer)}
                          </span>
                        </div>
                      </div>

                      <div
                        className={`mt-5 grid gap-3 ${
                          event.eventType === 1
                            ? "grid-cols-1 sm:grid-cols-3"
                            : "grid-cols-2"
                        }`}
                      >
                        <div className="rounded-2xl border border-[#79b7ff]/8 bg-[#0d142b] p-4">
                          <p className="min-h-10 text-xs leading-5 text-white/35">
                            {event.eventType === 1
                              ? "Upfront payment"
                              : "Refundable deposit"}
                          </p>

                          <p className="mt-2 text-lg font-semibold">
                            {event.deposit} USDC
                          </p>
                        </div>

                        {event.eventType === 1 ? (
                          <div className="rounded-2xl border border-[#9c8cff]/8 bg-[#0d142b] p-4">
                            <p className="min-h-10 text-xs leading-5 text-white/35">
                              Total price
                            </p>

                            <p className="mt-2 text-lg font-semibold">
                              {event.totalPrice} USDC
                            </p>
                          </div>
                        ) : null}

                        <div className="rounded-2xl border border-[#79b7ff]/8 bg-[#0d142b] p-4">
                          <p className="min-h-10 text-xs leading-5 text-white/35">
                            Seats remaining
                          </p>

                          <p className="mt-2 break-words text-lg font-semibold">
                            {capacity.remaining}
                          </p>
                        </div>
                      </div>

                      {!capacity.unlimited ? (
                        <div className="mt-5">
                          <div className="flex items-center justify-between text-xs text-white/35">
                            <span>
                              {capacity.reservedLabel}
                            </span>

                            <span>
                              {capacity.progress}%
                            </span>
                          </div>

                          <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff]"
                              style={{
                                width: `${capacity.progress}%`,
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-5 rounded-2xl border border-[#72cfff]/15 bg-[#288cff]/[0.06] px-4 py-3 text-sm text-[#a8e2ff]">
                          Unlimited capacity ·{" "}
                          {capacity.reservedLabel}
                        </div>
                      )}

                      <div className="mt-auto pt-6">
                        <Link
                          href={`/events/${event.id}`}
                          className="block rounded-2xl border border-[#72cfff]/22 bg-gradient-to-r from-[#288cff]/12 to-[#8d70ff]/12 px-4 py-3 text-center text-sm font-medium text-[#b8e8ff] transition hover:border-[#72cfff]/35 hover:brightness-110"
                        >
                          View event
                        </Link>

                        <p className="mt-3 text-center text-xs text-white/28">
                          Open full details, reservation rules, and attendance status.
                        </p>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : null}

          {contractAddress ? (
            <div className="mt-10 rounded-2xl border border-[#79b7ff]/12 bg-[#0a1025] px-5 py-4">
              <p className="text-xs text-white/30">
                ShowUp V5 contract on Arc Testnet
              </p>

              <p className="mt-2 break-all font-mono text-xs text-white/55">
                {contractAddress}
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="border-t border-[#79b7ff]/12">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/38 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>
            ShowUp. Programmable commitment on Arc.
          </p>

          <p>
            Live contract data · Circle wallets · USDC settlement
          </p>
        </div>
      </footer>
    </main>
  );
}
