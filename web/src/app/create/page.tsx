"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

const inputClassName =
  "mt-2 w-full rounded-2xl border border-white/10 bg-white/[0.045] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#74f2c2]/60 focus:bg-[#74f2c2]/[0.04]";

const labelClassName = "block text-sm font-medium text-white/75";

function formatDate(value: string) {
  if (!value) {
    return "Not set";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Not set";
  }

  return date.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default function CreateEventPage() {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [deposit, setDeposit] = useState("2");
  const [capacity, setCapacity] = useState("30");
  const [eventStart, setEventStart] = useState("");
  const [eventEnd, setEventEnd] = useState("");
  const [cancellationHours, setCancellationHours] = useState("24");
  const [resolutionHours, setResolutionHours] = useState("12");
  const [message, setMessage] = useState("");

  const availableSeats = useMemo(() => {
    const parsedCapacity = Number(capacity);

    if (!Number.isFinite(parsedCapacity) || parsedCapacity < 1) {
      return 0;
    }

    return Math.floor(parsedCapacity);
  }, [capacity]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (
      !title.trim() ||
      !deposit ||
      !capacity ||
      !eventStart ||
      !eventEnd
    ) {
      setMessage("Complete the required fields before continuing.");
      return;
    }

    if (new Date(eventEnd) <= new Date(eventStart)) {
      setMessage("Event end must be later than event start.");
      return;
    }

    setMessage(
      "Your event draft is ready. Wallet signing and Arc submission will be connected next.",
    );
  }

  return (
    <main className="min-h-screen bg-[#07110f] text-white">
      <header className="border-b border-white/10">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#74f2c2] text-lg font-black text-[#07110f]">
              S
            </div>

            <div>
              <p className="text-lg font-semibold tracking-tight">ShowUp</p>
              <p className="text-xs text-white/45">Built on Arc</p>
            </div>
          </Link>

          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="rounded-full border border-white/10 px-5 py-2.5 text-sm text-white/65 transition hover:border-white/25 hover:text-white"
            >
              Back home
            </Link>

            <button
              type="button"
              className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/10"
            >
              Connect wallet
            </button>
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute left-1/4 top-0 h-[500px] w-[500px] rounded-full bg-[#35d69e]/10 blur-[140px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-20">
          <div className="mb-12 max-w-3xl">
            <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#9dffda]">
              <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />
              Organizer workspace
            </div>

            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              Create an accountable event.
            </h1>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
              Set a refundable USDC commitment deposit, define the event
              timeline and publish transparent attendance rules on Arc.
            </p>
          </div>

          <div className="grid items-start gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <form
              onSubmit={handleSubmit}
              className="rounded-[30px] border border-white/10 bg-white/[0.035] p-6 sm:p-8"
            >
              <div className="flex items-center justify-between border-b border-white/10 pb-6">
                <div>
                  <h2 className="text-2xl font-semibold">Event details</h2>
                  <p className="mt-2 text-sm text-white/40">
                    Required information for your onchain event.
                  </p>
                </div>

                <div className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/45">
                  Draft
                </div>
              </div>

              <div className="mt-7">
                <label className={labelClassName}>
                  Event title
                  <span className="ml-1 text-[#74f2c2]">*</span>
                  <input
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    className={inputClassName}
                    placeholder="Arc Builders Workshop"
                    maxLength={80}
                  />
                </label>
              </div>

              <div className="mt-6">
                <label className={labelClassName}>
                  Short description
                  <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    className={`${inputClassName} min-h-28 resize-none`}
                    placeholder="Describe what attendees will experience."
                    maxLength={240}
                  />
                </label>

                <p className="mt-2 text-right text-xs text-white/30">
                  {description.length} / 240
                </p>
              </div>

              <div className="mt-6 grid gap-5 sm:grid-cols-2">
                <label className={labelClassName}>
                  Commitment deposit
                  <span className="ml-1 text-[#74f2c2]">*</span>

                  <div className="relative">
                    <input
                      type="number"
                      min="0.01"
                      step="0.01"
                      value={deposit}
                      onChange={(event) => setDeposit(event.target.value)}
                      className={`${inputClassName} pr-20`}
                    />

                    <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm font-medium text-[#74f2c2]">
                      USDC
                    </span>
                  </div>
                </label>

                <label className={labelClassName}>
                  Event capacity
                  <span className="ml-1 text-[#74f2c2]">*</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={capacity}
                    onChange={(event) => setCapacity(event.target.value)}
                    className={inputClassName}
                  />
                </label>
              </div>

              <div className="mt-8 border-t border-white/10 pt-7">
                <h3 className="text-lg font-semibold">Event timeline</h3>

                <p className="mt-2 text-sm text-white/40">
                  These values will determine cancellation and settlement
                  windows.
                </p>

                <div className="mt-6 grid gap-5 sm:grid-cols-2">
                  <label className={labelClassName}>
                    Event start
                    <span className="ml-1 text-[#74f2c2]">*</span>
                    <input
                      type="datetime-local"
                      value={eventStart}
                      onChange={(event) => setEventStart(event.target.value)}
                      className={inputClassName}
                    />
                  </label>

                  <label className={labelClassName}>
                    Event end
                    <span className="ml-1 text-[#74f2c2]">*</span>
                    <input
                      type="datetime-local"
                      value={eventEnd}
                      onChange={(event) => setEventEnd(event.target.value)}
                      className={inputClassName}
                    />
                  </label>
                </div>

                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <label className={labelClassName}>
                    Free cancellation period

                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={cancellationHours}
                        onChange={(event) =>
                          setCancellationHours(event.target.value)
                        }
                        className={`${inputClassName} pr-20`}
                      />

                      <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                        hours
                      </span>
                    </div>

                    <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                      Cancellation closes this many hours before the event.
                    </span>
                  </label>

                  <label className={labelClassName}>
                    Organizer resolution period

                    <div className="relative">
                      <input
                        type="number"
                        min="1"
                        step="1"
                        value={resolutionHours}
                        onChange={(event) =>
                          setResolutionHours(event.target.value)
                        }
                        className={`${inputClassName} pr-20`}
                      />

                      <span className="pointer-events-none absolute bottom-3.5 right-4 text-sm text-white/35">
                        hours
                      </span>
                    </div>

                    <span className="mt-2 block text-xs font-normal leading-5 text-white/30">
                      Unresolved reservations receive a fallback refund after
                      this period.
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-8 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                <p className="text-sm leading-6 text-[#c7ffea]">
                  Deposits remain inside the ShowUp contract until attendance,
                  cancellation or no show settlement determines their outcome.
                </p>
              </div>

              {message ? (
                <div className="mt-5 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm text-white/65">
                  {message}
                </div>
              ) : null}

              <button
                type="submit"
                className="mt-6 w-full rounded-2xl bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
              >
                Continue to wallet
              </button>

              <p className="mt-4 text-center text-xs text-white/30">
                No transaction will be sent before wallet confirmation.
              </p>
            </form>

            <aside className="lg:sticky lg:top-8">
              <div className="rounded-[30px] border border-white/10 bg-white/[0.045] p-4 shadow-2xl shadow-black/30">
                <div className="rounded-[24px] border border-white/10 bg-[#0b1916] p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
                        Live preview
                      </p>

                      <h2 className="mt-3 break-words text-2xl font-semibold">
                        {title.trim() || "Untitled event"}
                      </h2>

                      <p className="mt-2 break-words text-sm leading-6 text-white/45">
                        {description.trim() ||
                          "Your event description will appear here."}
                      </p>
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                      <p className="text-xs font-semibold uppercase">
                        {eventStart
                          ? new Date(eventStart).toLocaleString(undefined, {
                              month: "short",
                            })
                          : "DATE"}
                      </p>

                      <p className="text-xl font-black">
                        {eventStart
                          ? new Date(eventStart).getDate()
                          : "--"}
                      </p>
                    </div>
                  </div>

                  <div className="my-6 h-px bg-white/10" />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Commitment deposit
                      </p>

                      <p className="mt-2 text-xl font-semibold">
                        {deposit || "0"} USDC
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Available seats
                      </p>

                      <p className="mt-2 text-xl font-semibold">
                        {availableSeats}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 rounded-2xl border border-white/10 bg-white/[0.025] p-4">
                    <div>
                      <p className="text-xs text-white/30">Starts</p>
                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventStart)}
                      </p>
                    </div>

                    <div className="h-px bg-white/10" />

                    <div>
                      <p className="text-xs text-white/30">Ends</p>
                      <p className="mt-1 text-sm font-medium text-white/70">
                        {formatDate(eventEnd)}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                    <p className="text-sm font-medium leading-6 text-[#b7ffe3]">
                      Attend or cancel at least {cancellationHours || "0"} hours
                      before the event to receive your full deposit back.
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled
                    className="mt-6 w-full cursor-not-allowed rounded-2xl bg-[#74f2c2]/40 py-4 font-semibold text-[#07110f]/60"
                  >
                    Reserve with USDC
                  </button>

                  <p className="mt-4 text-center text-xs text-white/30">
                    Preview only
                  </p>
                </div>
              </div>

              <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.025] p-5">
                <p className="text-sm font-medium">What happens next?</p>

                <div className="mt-4 space-y-4 text-sm leading-6 text-white/45">
                  <p>
                    1. Connect the organizer wallet and confirm the Arc network.
                  </p>

                  <p>
                    2. Review the exact USDC amount and event timeline.
                  </p>

                  <p>
                    3. Sign the transaction to publish the event onchain.
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </section>
    </main>
  );
}