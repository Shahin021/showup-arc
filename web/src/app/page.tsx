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
    <main className="min-h-screen overflow-hidden bg-[#07110f] text-white">
      <header className="relative z-20 border-b border-white/10 bg-[#07110f]/85 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-5 lg:px-10">
          <Link href="/" className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#74f2c2] text-lg font-black text-[#07110f] shadow-lg shadow-[#74f2c2]/10">
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
              className="transition hover:text-white"
            >
              How it works
            </a>

            <Link
              href="/events"
              className="transition hover:text-white"
            >
              Explore
            </Link>

            <a
              href="#infrastructure"
              className="transition hover:text-white"
            >
              Infrastructure
            </a>
          </nav>

          <CircleWalletButton />
        </div>
      </header>

      <section className="relative">
        <div className="pointer-events-none absolute left-1/2 top-[-180px] h-[720px] w-[720px] -translate-x-1/2 rounded-full bg-[#35d69e]/15 blur-[170px]" />

        <div className="pointer-events-none absolute right-[-220px] top-[240px] h-[480px] w-[480px] rounded-full bg-[#74f2c2]/5 blur-[150px]" />

        <div className="relative mx-auto grid max-w-7xl gap-16 px-6 py-20 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-28">
          <div className="flex flex-col justify-center">
            <div className="mb-7 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#aaffdc]">
              <span className="h-2 w-2 rounded-full bg-[#74f2c2] shadow-[0_0_16px_rgba(116,242,194,0.9)]" />
              Live prototype on Arc Testnet
            </div>

            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.045em] sm:text-6xl lg:text-[72px]">
              Turn reservations into
              <span className="block text-[#74f2c2]">
                accountable commitments.
              </span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/58">
              ShowUp coordinates free and paid events with USDC,
              programmable settlement, wallet-bound private invitations,
              and transparent attendance rules on Arc.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/events"
                className="rounded-full bg-[#74f2c2] px-7 py-3.5 text-center font-semibold text-[#07110f] shadow-lg shadow-[#74f2c2]/10 transition hover:-translate-y-0.5 hover:bg-[#9dffda]"
              >
                Explore live events
              </Link>

              <Link
                href="/create"
                className="rounded-full border border-white/15 bg-white/5 px-7 py-3.5 text-center font-semibold transition hover:-translate-y-0.5 hover:border-white/30 hover:bg-white/10"
              >
                Create an event
              </Link>
            </div>

            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
              {features.map((feature) => (
                <div
                  key={feature.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 backdrop-blur"
                >
                  <p className="text-sm font-semibold text-white/85">
                    {feature.title}
                  </p>

                  <p className="mt-1 text-xs leading-5 text-white/42">
                    {feature.description}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center lg:justify-end">
            <div className="relative w-full max-w-md">
              <div className="absolute inset-5 rounded-[36px] bg-[#74f2c2]/10 blur-3xl" />

              <div className="relative rounded-[34px] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/40 backdrop-blur-xl">
                <div className="rounded-[28px] border border-white/10 bg-[#0a1714] p-6">
                  <div className="flex items-start justify-between gap-5">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-3 py-1 text-xs font-medium text-[#aaffdc]">
                          PROTOCOL FLOW
                        </span>

                        <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/45">
                          V5
                        </span>
                      </div>

                      <h2 className="mt-5 text-2xl font-semibold tracking-tight">
                        Private Builders Session
                      </h2>

                      <p className="mt-2 text-sm leading-6 text-white/45">
                        A paid, invite-only event secured by wallet ownership
                        and programmable USDC settlement.
                      </p>
                    </div>

                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#74f2c2] text-sm font-black text-[#07110f]">
                      ARC
                    </div>
                  </div>

                  <div className="my-6 h-px bg-white/10" />

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-white/5 bg-white/[0.04] p-4">
                      <p className="text-xs text-white/35">
                        Access
                      </p>

                      <p className="mt-2 text-base font-semibold">
                        Invite-only
                      </p>
                    </div>

                    <div className="rounded-2xl border border-white/5 bg-white/[0.04] p-4">
                      <p className="text-xs text-white/35">
                        Commitment
                      </p>

                      <p className="mt-2 text-base font-semibold">
                        USDC
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 space-y-2">
                    {flowItems.map((item, index) => (
                      <div
                        key={item.label}
                        className="flex items-center justify-between gap-4 rounded-2xl border border-white/5 bg-white/[0.025] px-4 py-3.5"
                      >
                        <div className="flex items-center gap-3">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 text-xs font-semibold text-[#aaffdc]">
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

                  <div className="mt-5 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                    <p className="text-sm leading-6 text-[#b7ffe3]">
                      Only the invited wallet can reserve. Attendance and
                      payment outcomes remain transparent onchain.
                    </p>
                  </div>

                  <Link
                    href="/events"
                    className="mt-6 block w-full rounded-2xl bg-[#74f2c2] py-4 text-center font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
                  >
                    Open live application
                  </Link>

                  <p className="mt-4 text-center text-xs text-white/30">
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
        className="border-y border-white/10 bg-white/[0.025]"
      >
        <div className="mx-auto max-w-7xl px-6 py-20 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
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
                className="group rounded-[28px] border border-white/10 bg-[#0a1714] p-7 transition hover:-translate-y-1 hover:border-[#74f2c2]/20"
              >
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 text-sm font-semibold text-[#74f2c2]">
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
        className="px-6 py-20 lg:px-10"
      >
        <div className="mx-auto max-w-7xl">
          <div className="grid gap-5 md:grid-cols-3">
            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-7">
              <p className="text-sm font-medium text-[#74f2c2]">
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

            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-7">
              <p className="text-sm font-medium text-[#74f2c2]">
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

            <div className="rounded-[28px] border border-white/10 bg-white/[0.035] p-7">
              <p className="text-sm font-medium text-[#74f2c2]">
                Arc
              </p>

              <h3 className="mt-4 text-2xl font-semibold">
                Transparent settlement
              </h3>

              <p className="mt-3 leading-7 text-white/48">
                Event rules and financial outcomes are enforced by the
                deployed ShowUp smart contract on Arc Testnet.
              </p>
            </div>
          </div>

          <div className="mt-5 flex flex-col items-start justify-between gap-8 rounded-[32px] border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-8 md:flex-row md:items-center lg:p-12">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#9dffda]">
                Live working prototype
              </p>

              <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
                Create the rules. Reserve the seat. Let programmable money
                handle the outcome.
              </h2>
            </div>

            <Link
              href="/create"
              className="shrink-0 rounded-full bg-white px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:-translate-y-0.5 hover:bg-[#dfffee]"
            >
              Create an event
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10">
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
