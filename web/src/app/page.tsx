import Image from "next/image";
import Link from "next/link";
import CircleWalletButton from "@/components/circle-wallet-button";

const steps = [
  {
    number: "01",
    title: "Define the rules",
    description:
      "Create a free or paid event, choose public or invite-only access, and set capacity, payment, cancellation, and settlement rules.",
  },
  {
    number: "02",
    title: "Reserve with a wallet",
    description:
      "Attendees reserve through a Circle wallet using USDC. Private invitations remain bound to the wallet selected by the organizer.",
  },
  {
    number: "03",
    title: "Settle transparently",
    description:
      "Attendance, cancellations, refunds, remaining payments, and organizer settlements follow the rules recorded on Arc.",
  },
];

const features = [
  {
    title: "Free and paid",
    description: "Deposits, upfront payments, or full payment.",
  },
  {
    title: "Public or private",
    description: "Wallet-bound invite-only reservations.",
  },
  {
    title: "Built with Circle",
    description: "User-controlled wallets and USDC payments.",
  },
  {
    title: "Settled on Arc",
    description: "Transparent rules and onchain outcomes.",
  },
];

const flowItems = [
  {
    label: "Invitation",
    value: "Wallet verified",
  },
  {
    label: "Reservation",
    value: "Recorded on Arc",
  },
  {
    label: "Settlement",
    value: "Rules enforced",
  },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#050817] text-white">
      <header className="relative z-20 border-b border-[#73baff]/15 bg-[#050817]/85 backdrop-blur-xl">
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

          <nav className="hidden items-center gap-8 text-sm text-white/60 md:flex">
            <a
              href="#how-it-works"
              className="transition hover:text-[#8fd8ff]"
            >
              How it works
            </a>

            <Link
              href="/events"
              className="transition hover:text-[#8fd8ff]"
            >
              Explore
            </Link>

            <a
              href="#infrastructure"
              className="transition hover:text-[#8fd8ff]"
            >
              Infrastructure
            </a>
          </nav>

          <CircleWalletButton />
        </div>
      </header>

      <section className="relative">
        <div className="pointer-events-none absolute left-[38%] top-[-240px] h-[760px] w-[760px] -translate-x-1/2 rounded-full bg-[#288cff]/15 blur-[180px]" />

        <div className="pointer-events-none absolute right-[-180px] top-[180px] h-[520px] w-[520px] rounded-full bg-[#8d70ff]/12 blur-[170px]" />

        <div className="relative mx-auto grid max-w-7xl gap-14 px-6 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-20">
          <div className="flex flex-col justify-center">
            <div className="mb-6 flex w-fit items-center gap-2 rounded-full border border-[#72cfff]/25 bg-[#418cff]/10 px-4 py-2 text-sm text-[#9bddff]">
              <span className="h-2 w-2 rounded-full bg-[#75d7ff] shadow-[0_0_16px_rgba(117,215,255,0.95)]" />
              Live prototype on Arc Testnet
            </div>

            <h1 className="max-w-[680px] text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[70px]">
              Turn reservations into
              <span className="block bg-gradient-to-r from-[#75d7ff] via-[#70aaff] to-[#9b89ff] bg-clip-text text-transparent">
                accountable commitments.
              </span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-8 text-white/58">
              ShowUp coordinates free and paid events with USDC,
              programmable settlement, wallet-bound private invitations,
              and transparent attendance rules on Arc.
            </p>

            <div className="mt-8 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/events"
                className="rounded-full bg-gradient-to-r from-[#73d8ff] to-[#8195ff] px-7 py-3.5 text-center font-semibold text-[#050817] shadow-lg shadow-[#428fff]/20 transition hover:-translate-y-0.5 hover:brightness-110"
              >
                Explore live events
              </Link>

              <Link
                href="/create"
                className="rounded-full border border-[#82bcff]/20 bg-white/5 px-7 py-3.5 text-center font-semibold transition hover:-translate-y-0.5 hover:border-[#82bcff]/40 hover:bg-[#6c8cff]/10"
              >
                Create an event
              </Link>
            </div>

            <div className="mt-9 grid max-w-2xl gap-3 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-[#79b7ff]/12 bg-[#0a1025]/80 px-4 py-4 backdrop-blur"
                >
                  <p className="text-sm font-semibold text-white/88">
                    {feature.title}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-white/42">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center lg:items-stretch lg:justify-end">
            <div className="relative w-full max-w-[430px] lg:h-full">
              <div className="absolute inset-8 rounded-[36px] bg-gradient-to-br from-[#318cff]/20 to-[#8c72ff]/20 blur-3xl" />

              <div className="relative rounded-[32px] border border-[#79b7ff]/18 bg-[#0b1025]/80 p-3 shadow-2xl shadow-black/50 backdrop-blur-xl lg:h-full">
                <div className="flex rounded-[25px] border border-[#79b7ff]/14 bg-[#070c1d] p-5 lg:h-full lg:flex-col">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-[#72cfff]/25 bg-[#418cff]/10 px-3 py-1 text-xs font-medium text-[#a8e2ff]">
                          PROTOCOL FLOW
                        </span>

                        <span className="rounded-full border border-[#9e8dff]/20 bg-[#8a72ff]/10 px-3 py-1 text-xs text-[#c4baff]">
                          V5
                        </span>
                      </div>

                      <h2 className="mt-4 text-2xl font-semibold tracking-tight">
                        Private Builders Session
                      </h2>

                      <p className="mt-2 max-w-[270px] text-sm leading-6 text-white/45">
                        Paid, invite-only access secured by wallet ownership
                        and programmable USDC settlement.
                      </p>
                    </div>

                    <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-[#79cfff]/25 bg-[#061530] shadow-lg shadow-[#268cff]/20">
                      <Image
                        src="/arc-logo-glow.webp"
                        alt="Arc network logo"
                        fill
                        sizes="64px"
                        className="object-cover"
                        priority
                      />
                    </div>
                  </div>

                  <div className="my-5 h-px bg-gradient-to-r from-transparent via-[#72baff]/20 to-transparent" />

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-[#74baff]/10 bg-[#0d142b] p-3.5">
                      <p className="text-xs text-white/35">
                        Access
                      </p>

                      <p className="mt-1.5 text-base font-semibold">
                        Invite-only
                      </p>
                    </div>

                    <div className="rounded-2xl border border-[#9c8cff]/10 bg-[#0d142b] p-3.5">
                      <p className="text-xs text-white/35">
                        Commitment
                      </p>

                      <p className="mt-1.5 text-base font-semibold">
                        USDC
                      </p>
                    </div>
                  </div>

                  <div className="mt-3 space-y-2">
                    {flowItems.map((item, index) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-[#79b7ff]/10 bg-[#0b1228] px-4 py-3"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#72cfff]/25 bg-[#418cff]/10 text-xs font-semibold text-[#9bddff]">
                            {index + 1}
                          </div>

                          <span className="text-sm text-white/45">
                            {item.label}
                          </span>
                        </div>

                        <span className="text-sm font-medium text-white/80">
                          {item.value}
                        </span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#72cfff]/20 bg-gradient-to-r from-[#278cff]/10 to-[#8c72ff]/10 p-3.5">
                    <p className="text-sm leading-6 text-[#b7e7ff]">
                      Only the invited wallet can reserve. Attendance and
                      payment outcomes remain transparent onchain.
                    </p>
                  </div>

                  <Link
                    href="/events"
                    className="mt-auto block w-full rounded-2xl bg-gradient-to-r from-[#73d8ff] to-[#8195ff] py-3.5 text-center font-semibold text-[#050817] transition hover:brightness-110"
                  >
                    Open live application
                  </Link>

                  <p className="mt-3 text-center text-xs text-white/30">
                    Circle wallets · USDC · Arc Testnet
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section
        id="how-it-works"
        className="border-y border-[#79b7ff]/12 bg-[#080d20]"
      >
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#82d3ff]">
              How it works
            </p>

            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
              One commitment layer for the full event lifecycle.
            </h2>

            <p className="mt-5 max-w-2xl text-lg leading-8 text-white/50">
              From reservation to final settlement, ShowUp keeps each rule
              visible, verifiable, and connected to the attendee wallet.
            </p>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <article
                key={step.number}
                className="group rounded-[28px] border border-[#79b7ff]/12 bg-[#0b1127] p-7 transition hover:-translate-y-1 hover:border-[#73caff]/30"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#72cfff]/25 bg-[#418cff]/10 text-sm font-semibold text-[#91dcff]">
                  {step.number}
                </div>

                <h3 className="mt-8 text-2xl font-semibold">
                  {step.title}
                </h3>

                <p className="mt-4 leading-7 text-white/52">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section
        id="infrastructure"
        className="relative px-6 py-20 lg:px-10"
      >
        <div className="pointer-events-none absolute bottom-[-220px] left-1/2 h-[500px] w-[700px] -translate-x-1/2 rounded-full bg-[#625cff]/10 blur-[180px]" />

        <div className="relative mx-auto max-w-7xl">
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-[28px] border border-[#79b7ff]/12 bg-[#0a1025] p-7">
              <p className="text-sm font-medium text-[#7fd2ff]">
                Circle
              </p>

              <h3 className="mt-4 text-2xl font-semibold">
                User-controlled wallets
              </h3>

              <p className="mt-3 leading-7 text-white/48">
                Attendees create and use wallets through a familiar PIN-based
                experience while retaining onchain ownership.
              </p>
            </div>

            <div className="rounded-[28px] border border-[#79b7ff]/12 bg-[#0a1025] p-7">
              <p className="text-sm font-medium text-[#8bbcff]">
                USDC
              </p>

              <h3 className="mt-4 text-2xl font-semibold">
                Programmable payments
              </h3>

              <p className="mt-3 leading-7 text-white/48">
                Deposits, upfront payments, remaining balances, refunds, and
                organizer settlements use stable digital money.
              </p>
            </div>

            <div className="rounded-[28px] border border-[#9c8cff]/16 bg-[#0a1025] p-7">
              <div className="flex items-center justify-between gap-4">
                <p className="text-sm font-medium text-[#a99cff]">
                  Arc
                </p>

                <div className="relative h-10 w-10 overflow-hidden rounded-xl border border-[#79cfff]/20">
                  <Image
                    src="/arc-logo-glow.webp"
                    alt="Arc network logo"
                    fill
                    sizes="40px"
                    className="object-cover"
                  />
                </div>
              </div>

              <h3 className="mt-4 text-2xl font-semibold">
                Transparent settlement
              </h3>

              <p className="mt-3 leading-7 text-white/48">
                Event rules and financial outcomes are enforced by the
                deployed ShowUp smart contract on Arc Testnet.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col items-start justify-between gap-8 rounded-[32px] border border-[#79b7ff]/20 bg-gradient-to-r from-[#198cff]/12 to-[#846bff]/12 p-8 md:flex-row md:items-center lg:p-12">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#9bddff]">
                Live working prototype
              </p>

              <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Create the rules. Reserve the seat. Let programmable money
                handle the outcome.
              </h2>
            </div>

            <Link
              href="/create"
              className="shrink-0 rounded-full bg-white px-7 py-3.5 text-center font-semibold text-[#050817] transition hover:-translate-y-0.5 hover:bg-[#e6f5ff]"
            >
              Create an event
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-[#79b7ff]/12">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/38 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>
            ShowUp. Programmable commitment on Arc.
          </p>

          <p>
            Circle wallets · USDC settlement · Wallet-bound access
          </p>
        </div>
      </footer>
    </main>
  );
}
