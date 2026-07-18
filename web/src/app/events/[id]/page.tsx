"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  useEffect,
  useMemo,
  useState,
} from "react";
import CircleWalletButton from "@/components/circle-wallet-button";
import ReserveSeatButton from "@/components/reserve-seat-button";
import OrganizerAttendancePanel from "@/components/organizer-attendance-panel";

type OnchainEvent = {
  id: string;
  organizer: string;
  title: string;
  description: string;
  metadataURI: string;
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

type EventMetadata = {
  eventImage?: string | null;
  fullDescription?: string | null;
  location?: string | null;

  organizer?: {
    name?: string | null;
    avatar?: string | null;
    bio?: string | null;
    website?: string | null;
    x?: string | null;
    walletAddress?: string | null;
  } | null;

  video?: {
    source?: "upload" | "external" | string;
    url?: string | null;
  } | null;

  rules?: string | null;
  createdAt?: string | null;
};

function shortenAddress(address: string) {
  if (!address || address.length < 12) {
    return address || "Unknown";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(timestamp: string) {
  const seconds = Number(timestamp);

  if (
    !Number.isFinite(seconds) ||
    seconds <= 0
  ) {
    return "Not available";
  }

  return new Date(
    seconds * 1000,
  ).toLocaleString(undefined, {
    dateStyle: "long",
    timeStyle: "short",
  });
}

function getEventStatus(event: OnchainEvent) {
  if (event.cancelled) {
    return {
      label: "Cancelled",
      className:
        "border-red-400/20 bg-red-400/10 text-red-200",
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const start = Number(event.eventStart);
  const end = Number(event.eventEnd);

  if (now < start) {
    return {
      label: "Open",
      className:
        "border-[#74f2c2]/25 bg-[#74f2c2]/10 text-[#b7ffe3]",
    };
  }

  if (now <= end) {
    return {
      label: "In progress",
      className:
        "border-amber-300/25 bg-amber-300/10 text-amber-100",
    };
  }

  return {
    label: "Ended",
    className:
      "border-white/10 bg-white/[0.04] text-white/45",
  };
}

function getXProfileUrl(value: string) {
  const normalized = value.trim();

  if (!normalized) {
    return "";
  }

  if (
    normalized.startsWith("https://") ||
    normalized.startsWith("http://")
  ) {
    return normalized;
  }

  return `https://x.com/${normalized.replace(/^@/, "")}`;
}

function getVideoPresentation(
  video: EventMetadata["video"],
) {
  const url = video?.url?.trim() ?? "";

  if (!url) {
    return {
      type: "none" as const,
      url: "",
    };
  }

  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    return {
      type: "link" as const,
      url,
    };
  }

  const host = parsed.hostname
    .toLowerCase()
    .replace(/^www\./, "");

  if (
    video?.source === "upload" ||
    /\.(mp4|webm)$/i.test(parsed.pathname)
  ) {
    return {
      type: "video" as const,
      url,
    };
  }

  if (
    host === "youtube.com" ||
    host === "m.youtube.com"
  ) {
    let videoId = "";

    if (parsed.pathname === "/watch") {
      videoId =
        parsed.searchParams.get("v") ?? "";
    } else if (
      parsed.pathname.startsWith("/shorts/")
    ) {
      videoId =
        parsed.pathname.split("/")[2] ?? "";
    } else if (
      parsed.pathname.startsWith("/embed/")
    ) {
      videoId =
        parsed.pathname.split("/")[2] ?? "";
    }

    if (videoId) {
      return {
        type: "embed" as const,
        url: `https://www.youtube.com/embed/${videoId}`,
      };
    }
  }

  if (host === "youtu.be") {
    const videoId =
      parsed.pathname.split("/")[1] ?? "";

    if (videoId) {
      return {
        type: "embed" as const,
        url: `https://www.youtube.com/embed/${videoId}`,
      };
    }
  }

  if (
    host === "vimeo.com" ||
    host === "player.vimeo.com"
  ) {
    const videoId = parsed.pathname
      .split("/")
      .filter(Boolean)
      .find((part) => /^\d+$/.test(part));

    if (videoId) {
      return {
        type: "embed" as const,
        url: `https://player.vimeo.com/video/${videoId}`,
      };
    }
  }

  return {
    type: "link" as const,
    url,
  };
}

export default function EventDetailsPage() {
  const params = useParams();
  const rawEventId = params?.id;

  const eventId = Array.isArray(rawEventId)
    ? rawEventId[0]
    : rawEventId;

  const [event, setEvent] =
    useState<OnchainEvent | null>(null);

  const [metadata, setMetadata] =
    useState<EventMetadata | null>(null);

  const [contractAddress, setContractAddress] =
    useState("");

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  useEffect(() => {
    if (!eventId) {
      return;
    }

    const controller =
      new AbortController();

    async function loadEvent() {
      setLoading(true);
      setError("");

      try {
        const eventsResponse = await fetch(
          "/api/events",
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );

        const eventsData =
          (await eventsResponse.json()) as EventsResponse;

        if (!eventsResponse.ok) {
          throw new Error(
            eventsData.error ??
              "Unable to load events.",
          );
        }

        const selectedEvent =
          eventsData.events?.find(
            (item) => item.id === eventId,
          );

        if (!selectedEvent) {
          throw new Error(
            "This event could not be found on Arc Testnet.",
          );
        }

        setEvent(selectedEvent);
        setContractAddress(
          eventsData.contractAddress ?? "",
        );

        if (selectedEvent.metadataURI) {
          const metadataResponse =
            await fetch(
              selectedEvent.metadataURI,
              {
                cache: "no-store",
                signal:
                  controller.signal,
              },
            );

          if (!metadataResponse.ok) {
            throw new Error(
              "The event was found, but its public metadata could not be loaded.",
            );
          }

          const metadataData =
            (await metadataResponse.json()) as EventMetadata;

          setMetadata(metadataData);
        }
      } catch (loadError) {
        if (
          loadError instanceof DOMException &&
          loadError.name === "AbortError"
        ) {
          return;
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : "Unable to load this event.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadEvent();

    return () => {
      controller.abort();
    };
  }, [eventId]);

  const capacityDetails = useMemo(() => {
    if (!event) {
      return {
        unlimited: false,
        reserved: "0",
        remaining: "0",
        progress: 0,
      };
    }

    const capacity =
      BigInt(event.capacity);
    const reserved =
      BigInt(event.reservedSeats);

    if (capacity === BigInt(0)) {
      return {
        unlimited: true,
        reserved:
          reserved.toString(),
        remaining: "Unlimited",
        progress: 0,
      };
    }

    const remaining =
      capacity > reserved
        ? capacity - reserved
        : BigInt(0);

    const progress =
      capacity > BigInt(0)
        ? Number(
            (reserved * BigInt(100)) /
              capacity,
          )
        : 0;

    return {
      unlimited: false,
      reserved:
        reserved.toString(),
      remaining:
        remaining.toString(),
      progress:
        Math.min(
          100,
          Math.max(0, progress),
        ),
    };
  }, [event]);

  const videoPresentation =
    useMemo(
      () =>
        getVideoPresentation(
          metadata?.video,
        ),
      [metadata?.video],
    );

  const status = event
    ? getEventStatus(event)
    : null;

  const organizerName =
    metadata?.organizer?.name?.trim() ||
    "Event organizer";

  const organizerXUrl =
    getXProfileUrl(
      metadata?.organizer?.x ?? "",
    );

  return (
    <main className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
          <Link
            href="/"
            className="flex items-center gap-3"
          >
            <div className="grid h-10 w-10 place-items-center rounded-2xl bg-[#74f2c2] font-black text-[#07110f]">
              S
            </div>

            <div>
              <p className="font-semibold">
                ShowUp
              </p>

              <p className="text-xs text-white/35">
                Built on Arc
              </p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/events"
              className="hidden text-sm text-white/45 transition hover:text-white sm:block"
            >
              All events
            </Link>

            <CircleWalletButton />
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-5 py-10 sm:px-8 lg:py-14">
        <Link
          href="/events"
          className="inline-flex items-center gap-2 text-sm text-white/40 transition hover:text-white/75"
        >
          ← Back to events
        </Link>

        {loading ? (
          <div className="mt-8 rounded-[30px] border border-white/10 bg-white/[0.035] p-10 text-center text-white/45">
            Loading event from Arc Testnet...
          </div>
        ) : null}

        {error ? (
          <div className="mt-8 rounded-[30px] border border-red-400/20 bg-red-400/10 p-8">
            <h1 className="text-xl font-semibold text-red-100">
              Event unavailable
            </h1>

            <p className="mt-3 text-sm leading-6 text-red-100/70">
              {error}
            </p>
          </div>
        ) : null}

        {!loading && !error && event ? (
          <div className="mt-8 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div className="space-y-7">
              <article className="overflow-hidden rounded-[30px] border border-white/10 bg-white/[0.035]">
                {metadata?.eventImage ? (
                  <div
                    className="h-64 bg-cover bg-center sm:h-96"
                    style={{
                      backgroundImage: `url("${metadata.eventImage}")`,
                    }}
                  />
                ) : (
                  <div className="grid h-56 place-items-center bg-gradient-to-br from-[#74f2c2]/15 to-transparent text-sm text-white/30">
                    ShowUp Event #{event.id}
                  </div>
                )}

                <div className="p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/50">
                      Event #{event.id}
                    </span>

                    {status ? (
                      <span
                        className={`rounded-full border px-3 py-1 text-xs font-medium ${status.className}`}
                      >
                        {status.label}
                      </span>
                    ) : null}

                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/40">
                      Arc Testnet
                    </span>
                  </div>

                  <h1 className="mt-6 break-words text-3xl font-semibold tracking-tight sm:text-5xl">
                    {event.title}
                  </h1>

                  {event.description ? (
                    <p className="mt-4 max-w-3xl text-base leading-7 text-white/50">
                      {event.description}
                    </p>
                  ) : null}

                  {metadata?.location ? (
                    <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-white/55">
                      📍 {metadata.location}
                    </div>
                  ) : null}
                </div>
              </article>

              <section className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                <h2 className="text-2xl font-semibold">
                  About this event
                </h2>

                <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-white/55 sm:text-base">
                  {metadata?.fullDescription ||
                    event.description ||
                    "No extended event description was provided."}
                </p>
              </section>

              {videoPresentation.type !==
              "none" ? (
                <section className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                  <h2 className="text-2xl font-semibold">
                    Promotional video
                  </h2>

                  {videoPresentation.type ===
                  "video" ? (
                    <video
                      src={
                        videoPresentation.url
                      }
                      controls
                      preload="metadata"
                      className="mt-6 aspect-video w-full rounded-2xl bg-black"
                    />
                  ) : null}

                  {videoPresentation.type ===
                  "embed" ? (
                    <iframe
                      src={
                        videoPresentation.url
                      }
                      title="Event promotional video"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      className="mt-6 aspect-video w-full rounded-2xl border-0 bg-black"
                    />
                  ) : null}

                  {videoPresentation.type ===
                  "link" ? (
                    <a
                      href={
                        videoPresentation.url
                      }
                      target="_blank"
                      rel="noreferrer"
                      className="mt-6 inline-flex rounded-2xl border border-[#74f2c2]/25 bg-[#74f2c2]/10 px-5 py-3 text-sm font-medium text-[#b7ffe3] transition hover:bg-[#74f2c2]/15"
                    >
                      Watch promotional video ↗
                    </a>
                  ) : null}
                </section>
              ) : null}

              {metadata?.rules ? (
                <section className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                  <h2 className="text-2xl font-semibold">
                    Attendance rules
                  </h2>

                  <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-white/55 sm:text-base">
                    {metadata.rules}
                  </p>
                </section>
              ) : null}

              <section className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8">
                <h2 className="text-2xl font-semibold">
                  Organizer
                </h2>

                <div className="mt-6 flex items-start gap-4">
                  {metadata?.organizer?.avatar ? (
                    <div
                      className="h-16 w-16 shrink-0 rounded-full bg-cover bg-center"
                      style={{
                        backgroundImage: `url("${metadata.organizer.avatar}")`,
                      }}
                    />
                  ) : (
                    <div className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-[#74f2c2]/10 text-xl font-semibold text-[#b7ffe3]">
                      {organizerName
                        .slice(0, 1)
                        .toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0">
                    <h3 className="text-lg font-semibold">
                      {organizerName}
                    </h3>

                    <p className="mt-1 break-all font-mono text-xs text-white/35">
                      {event.organizer}
                    </p>

                    {metadata?.organizer?.bio ? (
                      <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-white/50">
                        {
                          metadata.organizer
                            .bio
                        }
                      </p>
                    ) : null}

                    <div className="mt-4 flex flex-wrap gap-3">
                      {metadata?.organizer
                        ?.website ? (
                        <a
                          href={
                            metadata.organizer
                              .website
                          }
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:border-white/20 hover:text-white"
                        >
                          Website ↗
                        </a>
                      ) : null}

                      {organizerXUrl ? (
                        <a
                          href={organizerXUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-xl border border-white/10 px-4 py-2 text-sm text-white/55 transition hover:border-white/20 hover:text-white"
                        >
                          View on X ↗
                        </a>
                      ) : null}
                    </div>
                  </div>
                </div>
              </section>
            </div>

            <aside className="space-y-5 lg:sticky lg:top-8">
              <div className="rounded-[30px] border border-white/10 bg-white/[0.045] p-6 shadow-2xl shadow-black/25">
                <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#74f2c2]">
                  Commitment deposit
                </p>

                <p className="mt-3 text-4xl font-semibold">
                  {event.deposit}
                  <span className="ml-2 text-lg text-white/40">
                    USDC
                  </span>
                </p>

                <p className="mt-3 text-sm leading-6 text-white/40">
                  Attend or cancel before the deadline to receive the full deposit back.
                </p>

                <div className="my-6 h-px bg-white/10" />

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-2xl bg-white/[0.04] p-4">
                    <p className="text-xs text-white/35">
                      Remaining
                    </p>

                    <p className="mt-2 text-xl font-semibold">
                      {
                        capacityDetails.remaining
                      }
                    </p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.04] p-4">
                    <p className="text-xs text-white/35">
                      Reserved
                    </p>

                    <p className="mt-2 text-xl font-semibold">
                      {
                        capacityDetails.reserved
                      }
                    </p>
                  </div>
                </div>

                {!capacityDetails.unlimited ? (
                  <div className="mt-5">
                    <div className="flex justify-between text-xs text-white/35">
                      <span>
                        Reservation progress
                      </span>

                      <span>
                        {
                          capacityDetails.progress
                        }
                        %
                      </span>
                    </div>

                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[#74f2c2]"
                        style={{
                          width: `${capacityDetails.progress}%`,
                        }}
                      />
                    </div>
                  </div>
                ) : null}

                <ReserveSeatButton
                  eventId={event.id}
                  depositFormatted={event.deposit}
                  onReservationConfirmed={(
                    reservedSeats,
                  ) => {
                    setEvent(
                      (
                        currentEvent,
                      ) => {
                        if (
                          !currentEvent
                        ) {
                          return currentEvent;
                        }

                        const nextReservedSeats =
                          reservedSeats ||
                          (
                            BigInt(
                              currentEvent
                                .reservedSeats,
                            ) +
                            BigInt(1)
                          ).toString();

                        return {
                          ...currentEvent,
                          reservedSeats:
                            nextReservedSeats,
                          escrowedAmount:
                            (
                              BigInt(
                                currentEvent
                                  .escrowedAmount,
                              ) +
                              BigInt(
                                currentEvent
                                  .depositAmount,
                              )
                            ).toString(),
                        };
                      },
                    );
                  }}
                />

                <OrganizerAttendancePanel
                  eventId={event.id}
                  organizer={event.organizer}
                  depositFormatted={event.deposit}
                  eventStart={event.eventStart}
                  resolutionDeadline={
                    event.resolutionDeadline
                  }
                  onAttendanceConfirmed={() => {
                    setEvent(
                      (currentEvent) => {
                        if (
                          !currentEvent
                        ) {
                          return currentEvent;
                        }

                        const currentEscrow =
                          BigInt(
                            currentEvent
                              .escrowedAmount,
                          );

                        const depositAmount =
                          BigInt(
                            currentEvent
                              .depositAmount,
                          );

                        return {
                          ...currentEvent,
                          escrowedAmount:
                            currentEscrow >=
                            depositAmount
                              ? (
                                  currentEscrow -
                                  depositAmount
                                ).toString()
                              : "0",
                        };
                      },
                    );
                  }}
                />
              </div>

              <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6">
                <h2 className="font-semibold">
                  Event timeline
                </h2>

                <div className="mt-5 space-y-4">
                  <div>
                    <p className="text-xs text-white/30">
                      Free cancellation closes
                    </p>

                    <p className="mt-1 text-sm text-white/65">
                      {formatTimestamp(
                        event.cancellationDeadline,
                      )}
                    </p>
                  </div>

                  <div className="h-px bg-white/10" />

                  <div>
                    <p className="text-xs text-white/30">
                      Starts
                    </p>

                    <p className="mt-1 text-sm text-white/65">
                      {formatTimestamp(
                        event.eventStart,
                      )}
                    </p>
                  </div>

                  <div className="h-px bg-white/10" />

                  <div>
                    <p className="text-xs text-white/30">
                      Ends
                    </p>

                    <p className="mt-1 text-sm text-white/65">
                      {formatTimestamp(
                        event.eventEnd,
                      )}
                    </p>
                  </div>

                  <div className="h-px bg-white/10" />

                  <div>
                    <p className="text-xs text-white/30">
                      Resolution deadline
                    </p>

                    <p className="mt-1 text-sm text-white/65">
                      {formatTimestamp(
                        event.resolutionDeadline,
                      )}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6">
                <p className="text-xs text-white/30">
                  Organizer wallet
                </p>

                <p className="mt-2 font-mono text-sm text-white/60">
                  {shortenAddress(
                    event.organizer,
                  )}
                </p>

                {contractAddress ? (
                  <>
                    <div className="my-4 h-px bg-white/10" />

                    <p className="text-xs text-white/30">
                      ShowUp V2 contract
                    </p>

                    <p className="mt-2 break-all font-mono text-xs leading-5 text-white/50">
                      {contractAddress}
                    </p>
                  </>
                ) : null}

                <a
                  href={event.metadataURI}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-5 inline-flex text-xs text-[#74f2c2] transition hover:text-[#b7ffe3]"
                >
                  View public metadata ↗
                </a>
              </div>
            </aside>
          </div>
        ) : null}
      </section>
    </main>
  );
}
