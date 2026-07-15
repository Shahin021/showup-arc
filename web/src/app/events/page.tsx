import Link from "next/link";

const steps = [
  {
    number: "01",
    title: "Create an event",
    description:
      "The organizer sets the capacity, cancellation deadline and refundable USDC deposit.",
  },
  {
    number: "02",
    title: "Reserve with USDC",
    description:
      "Attendees lock a small commitment deposit when they reserve their seat.",
  },
  {
    number: "03",
    title: "Attend and get it back",
    description:
      "The deposit is refunded after attendance or a cancellation made before the deadline.",
  },
];

const features = [
  "Refundable USDC deposits",
  "Transparent rules on Arc",
  "Automatic fallback refunds",
  "No hidden booking fees",
];

export default function Home() {
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

          <nav className="hidden items-center gap-8 text-sm text-white/65 md:flex">
            <a href="#how-it-works" className="transition hover:text-white">
              How it works
            </a>

            <Link href="/events" className="transition hover:text-white">
              Explore
            </Link>

            <a href="#about" className="transition hover:text-white">
              About
            </a>
          </nav>

          <button
            type="button"
            className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/10"
          >
            Connect wallet
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="absolute left-1/2 top-0 h-[520px] w-[520px] -translate-x-1/2 rounded-full bg-[#35d69e]/15 blur-[140px]" />

        <div className="relative mx-auto grid max-w-7xl gap-16 px-6 py-20 lg:grid-cols-[1.1fr_0.9fr] lg:px-10 lg:py-28">
          <div className="flex flex-col justify-center">
            <div className="mb-7 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#9dffda]">
              <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />
              Programmable commitment on Arc
            </div>

            <h1 className="max-w-4xl text-5xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-6xl lg:text-7xl">
              Free events are easy to book.
              <span className="block text-[#74f2c2]">
                ShowUp makes them harder to ignore.
              </span>
            </h1>

            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/60">
              ShowUp turns refundable USDC deposits into a programmable
              commitment layer for events, workshops and reservations.
            </p>

            <div className="mt-9 flex flex-col gap-4 sm:flex-row">
              <Link
                href="/events"
                className="rounded-full bg-[#74f2c2] px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
              >
                Explore events
              </Link>

              <Link
                href="/create"
                className="rounded-full border border-white/15 bg-white/5 px-7 py-3.5 text-center font-semibold transition hover:border-white/30 hover:bg-white/10"
              >
                Create an event
              </Link>
            </div>

            <div className="mt-10 grid max-w-xl grid-cols-2 gap-3 sm:grid-cols-4">
              {features.map((feature) => (
                <div
                  key={feature}
                  className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-4 text-sm leading-5 text-white/65"
                >
                  {feature}
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-center">
            <div className="w-full max-w-md rounded-[32px] border border-white/10 bg-white/[0.055] p-4 shadow-2xl shadow-black/40 backdrop-blur">
              <div className="rounded-[26px] border border-white/10 bg-[#0b1916] p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
                      Featured event
                    </p>

                    <h2 className="mt-3 text-2xl font-semibold">
                      Arc Builders Workshop
                    </h2>

                    <p className="mt-2 text-sm text-white/50">
                      Build, connect and ship on Arc.
                    </p>
                  </div>

                  <div className="rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                    <p className="text-xs font-semibold">JUL</p>
                    <p className="text-xl font-black">17</p>
                  </div>
                </div>

                <div className="my-6 h-px bg-white/10" />

                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-2xl bg-white/[0.04] p-4">
                    <p className="text-xs text-white/40">Commitment deposit</p>
                    <p className="mt-2 text-xl font-semibold">2 USDC</p>
                  </div>

                  <div className="rounded-2xl bg-white/[0.04] p-4">
                    <p className="text-xs text-white/40">Available seats</p>
                    <p className="mt-2 text-xl font-semibold">18 / 30</p>
                  </div>
                </div>

                <div className="mt-4 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-4">
                  <p className="text-sm font-medium text-[#b7ffe3]">
                    Attend or cancel on time and your full deposit returns.
                  </p>
                </div>

                <Link
                  href="/events"
                  className="mt-6 block w-full rounded-2xl bg-[#74f2c2] py-4 text-center font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
                >
                  View events
                </Link>

                <p className="mt-4 text-center text-xs text-white/35">
                  Settlement secured transparently on Arc
                </p>
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
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#74f2c2]">
              How it works
            </p>

            <h2 className="mt-4 text-4xl font-semibold tracking-tight sm:text-5xl">
              Accountability without turning the event into a paid experience.
            </h2>
          </div>

          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {steps.map((step) => (
              <article
                key={step.number}
                className="rounded-[28px] border border-white/10 bg-[#0a1714] p-7"
              >
                <p className="text-sm font-semibold text-[#74f2c2]">
                  {step.number}
                </p>

                <h3 className="mt-8 text-2xl font-semibold">{step.title}</h3>

                <p className="mt-4 leading-7 text-white/55">
                  {step.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="about" className="px-6 py-20 lg:px-10">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-8 rounded-[32px] border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-8 md:flex-row md:items-center lg:p-12">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-[#9dffda]">
              Powered by programmable money
            </p>

            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Commit to the seat, not a booking fee.
            </h2>
          </div>

          <Link
            href="/create"
            className="shrink-0 rounded-full bg-white px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:bg-[#dfffee]"
          >
            Create your first event
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>ShowUp. Programmable commitment on Arc.</p>
          <p>USDC deposits. Transparent settlement. Real attendance.</p>
        </div>
      </footer>
    </main>
  );
}