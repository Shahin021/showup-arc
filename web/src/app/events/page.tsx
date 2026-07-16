"use client";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useState,
} from "react";
import CircleWalletButton from "@/components/circle-wallet-button";

type OnchainEvent = {
  id: string;
  organizer: string;
  title: string;
  description: string;
  deposit: string;
  depositAmount: string;
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

function getEventStatus(
  event: OnchainEvent,
): EventStatus {
  if (event.cancelled) {
    return "Cancelled";
  }

  const now = Math.floor(Date.now() / 1000);
  const cancellationDeadline = Number(
    event.cancellationDeadline,
  );
  const eventStart = Number(event.eventStart);
  const eventEnd = Number(event.eventEnd);
  const resolutionDeadline = Number(
    event.resolutionDeadline,
  );

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
    return "border-[#74f2c2]/20 bg-[#74f2c2]/10 text-[#aaffdc]";
  }

  if (status === "Live") {
    return "border-blue-300/20 bg-blue-300/10 text-blue-200";
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
  const [events, setEvents] = useState<
    OnchainEvent[]
  >([]);

  const [contractAddress, setContractAddress] =
    useState("");

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

      const data =
        (await response.json()) as EventsResponse;

      if (!response.ok) {
        throw new Error(
          data.error ??
            "Unable to load events from Arc Testnet.",
        );
      }

      setEvents(data.events ?? []);
      setContractAddress(
        data.contractAddress ?? "",
      );
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
    <main className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#74f2c2] text-lg font-black text-[#07110f]">
              S
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight">
                ShowUp
              </p>

              <p className="text-xs text-white/45">
                Built on Arc
              </p>
            </div>
          </Link>

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <Link
              href="/"
              className="transition hover:text-white"
            >
              Home
            </Link>

            <Link
              href="/events"
              className="font-medium text-[#74f2c2]"
            >
              Explore
            </Link>

            <Link
              href="/create"
              className="transition hover:text-white"
            >
              Create event
            </Link>
          </nav>

          <CircleWalletButton />
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute left-1/2 top-0 h-[460px] w-[600px] -translate-x-1/2 rounded-full bg-[#35d69e]/10 blur-[150px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#9dffda]">
                <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />
                Live events from Arc Testnet
              </div>

              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                Reserve a seat.
                <span className="block text-[#74f2c2]">
                  Get your commitment back.
                </span>
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
                Every event shown here is read directly
                from the deployed ShowUp smart contract.
              </p>
            </div>

            <Link
              href="/create"
              className="w-fit shrink-0 rounded-full bg-[#74f2c2] px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
            >
              Create an event
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-20">
        <div className="mb-8 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#74f2c2]">
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
              className="rounded-full border border-white/10 bg-white/[0.035] px-4 py-2 text-sm text-white/60 transition hover:border-white/25 hover:text-white disabled:cursor-wait disabled:opacity-50"
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
          <div className="grid gap-6 lg:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-[520px] animate-pulse rounded-[28px] border border-white/10 bg-white/[0.035]"
              />
            ))}
          </div>
        ) : null}

        {!loading &&
        !error &&
        events.length === 0 ? (
          <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-10 text-center">
            <h3 className="text-2xl font-semibold">
              No events have been created yet.
            </h3>

            <p className="mt-3 text-white/45">
              Create the first accountable event on
              Arc Testnet.
            </p>

            <Link
              href="/create"
              className="mt-7 inline-block rounded-full bg-[#74f2c2] px-7 py-3.5 font-semibold text-[#07110f]"
            >
              Create an event
            </Link>
          </div>
        ) : null}

        {!loading && !error && events.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {events.map((event) => {
              const status = getEventStatus(event);
              const date = formatDate(
                event.eventStart,
              );

              const capacity =
                getCapacityDetails(event);

              return (
                <article
                  key={event.id}
                  className="group flex h-full flex-col rounded-[28px] border border-white/10 bg-white/[0.035] p-4 transition hover:-translate-y-1 hover:border-[#74f2c2]/25 hover:bg-white/[0.05]"
                >
                  <div className="flex h-full flex-col rounded-[23px] border border-white/10 bg-[#0b1916] p-6">
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

                      <div className="shrink-0 rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                        <p className="text-xs font-semibold">
                          {date.month}
                        </p>

                        <p className="text-xl font-black">
                          {date.day}
                        </p>
                      </div>
                    </div>

                    <h3 className="mt-6 break-words text-2xl font-semibold leading-tight">
                      {event.title}
                    </h3>

                    <p className="mt-3 min-h-20 break-words text-sm leading-6 text-white/45">
                      {event.description ||
                        "No description was provided."}
                    </p>

                    <div className="mt-6 space-y-3 border-y border-white/10 py-5">
                      <div className="flex items-start justify-between gap-4 text-sm">
                        <span className="text-white/35">
                          Starts
                        </span>

                        <span className="text-right font-medium text-white/70">
                          {formatDateTime(
                            event.eventStart,
                          )}
                        </span>
                      </div>

                      <div className="flex items-start justify-between gap-4 text-sm">
                        <span className="text-white/35">
                          Ends
                        </span>

                        <span className="text-right font-medium text-white/70">
                          {formatDateTime(
                            event.eventEnd,
                          )}
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
                          {shortenAddress(
                            event.organizer,
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-2xl bg-white/[0.04] p-4">
                        <p className="text-xs leading-5 text-white/35">
                          Refundable deposit
                        </p>

                        <p className="mt-2 text-lg font-semibold">
                          {event.deposit} USDC
                        </p>
                      </div>

                      <div className="rounded-2xl bg-white/[0.04] p-4">
                        <p className="text-xs leading-5 text-white/35">
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
                            className="h-full rounded-full bg-[#74f2c2]"
                            style={{
                              width: `${capacity.progress}%`,
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="mt-5 rounded-2xl border border-[#74f2c2]/15 bg-[#74f2c2]/[0.06] px-4 py-3 text-sm text-[#aaffdc]">
                        Unlimited capacity ·{" "}
                        {capacity.reservedLabel}
                      </div>
                    )}

                    <div className="mt-auto pt-6">
                      <div className="rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-3 text-center text-sm font-medium text-[#b7ffe3]">
                        Recorded on Arc Testnet
                      </div>

                      <p className="mt-3 text-center text-xs text-white/30">
                        Reservation and event details are
                        added next.
                      </p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}

        {contractAddress ? (
          <div className="mt-10 rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-4">
            <p className="text-xs text-white/30">
              ShowUp contract
            </p>

            <p className="mt-2 break-all font-mono text-xs text-white/55">
              {contractAddress}
            </p>
          </div>
        ) : null}
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>
            ShowUp. Programmable commitment on Arc.
          </p>

          <p>
            Live contract data. No sample events.
          </p>
        </div>
      </footer>
    </main>
  );
}
