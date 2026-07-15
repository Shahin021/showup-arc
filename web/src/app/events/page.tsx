import Link from "next/link";

type EventStatus = "Open" | "Almost full" | "Upcoming";

type EventItem = {
  id: number;
  title: string;
  description: string;
  date: string;
  month: string;
  time: string;
  location: string;
  deposit: string;
  reserved: number;
  capacity: number;
  status: EventStatus;
  category: string;
  organizer: string;
};

const events: EventItem[] = [
  {
    id: 1,
    title: "Arc Builders Workshop",
    description:
      "A hands-on session for builders exploring programmable money, USDC and applications on Arc.",
    date: "17",
    month: "JUL",
    time: "6:00 PM – 8:00 PM",
    location: "Online",
    deposit: "2 USDC",
    reserved: 12,
    capacity: 30,
    status: "Open",
    category: "Workshop",
    organizer: "Arc Community",
  },
  {
    id: 2,
    title: "Stablecoin Product Meetup",
    description:
      "Meet founders and developers building practical stablecoin products for everyday users.",
    date: "20",
    month: "JUL",
    time: "5:30 PM – 7:30 PM",
    location: "Milan, Italy",
    deposit: "3 USDC",
    reserved: 21,
    capacity: 25,
    status: "Almost full",
    category: "Meetup",
    organizer: "USDC Builders",
  },
  {
    id: 3,
    title: "Programmable Payments Demo Day",
    description:
      "A community showcase featuring applications that use programmable USDC settlement.",
    date: "24",
    month: "JUL",
    time: "7:00 PM – 9:00 PM",
    location: "Online",
    deposit: "1 USDC",
    reserved: 8,
    capacity: 40,
    status: "Upcoming",
    category: "Demo Day",
    organizer: "ShowUp Labs",
  },
];

function getStatusClassName(status: EventStatus) {
  if (status === "Almost full") {
    return "border-amber-300/20 bg-amber-300/10 text-amber-200";
  }

  if (status === "Upcoming") {
    return "border-blue-300/20 bg-blue-300/10 text-blue-200";
  }

  return "border-[#74f2c2]/20 bg-[#74f2c2]/10 text-[#aaffdc]";
}

export default function EventsPage() {
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

          <nav className="hidden items-center gap-7 text-sm text-white/60 md:flex">
            <Link href="/" className="transition hover:text-white">
              Home
            </Link>

            <Link href="/events" className="font-medium text-[#74f2c2]">
              Explore
            </Link>

            <Link href="/create" className="transition hover:text-white">
              Create event
            </Link>
          </nav>

          <button
            type="button"
            className="rounded-full border border-white/15 bg-white/5 px-5 py-2.5 text-sm font-medium transition hover:border-[#74f2c2]/60 hover:bg-[#74f2c2]/10"
          >
            Connect wallet
          </button>
        </div>
      </header>

      <section className="relative overflow-hidden border-b border-white/10">
        <div className="absolute left-1/2 top-0 h-[460px] w-[600px] -translate-x-1/2 rounded-full bg-[#35d69e]/10 blur-[150px]" />

        <div className="relative mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-20">
          <div className="flex flex-col justify-between gap-8 lg:flex-row lg:items-end">
            <div className="max-w-3xl">
              <div className="mb-5 flex w-fit items-center gap-2 rounded-full border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-2 text-sm text-[#9dffda]">
                <span className="h-2 w-2 rounded-full bg-[#74f2c2]" />
                Discover accountable events
              </div>

              <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
                Reserve a seat.
                <span className="block text-[#74f2c2]">
                  Get your commitment back.
                </span>
              </h1>

              <p className="mt-5 max-w-2xl text-lg leading-8 text-white/55">
                Explore events that use refundable USDC deposits to reduce
                no-shows without turning free experiences into paid ones.
              </p>
            </div>

            <Link
              href="/create"
              className="w-fit shrink-0 rounded-full bg-[#74f2c2] px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
            >
              Create an event
            </Link>
          </div>

          <div className="mt-10 flex flex-wrap gap-3">
            {["All events", "Workshops", "Meetups", "Demo days", "Online"].map(
              (filter, index) => (
                <button
                  key={filter}
                  type="button"
                  className={
                    index === 0
                      ? "rounded-full bg-white px-5 py-2.5 text-sm font-medium text-[#07110f]"
                      : "rounded-full border border-white/10 bg-white/[0.035] px-5 py-2.5 text-sm text-white/55 transition hover:border-white/25 hover:text-white"
                  }
                >
                  {filter}
                </button>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-14 lg:px-10 lg:py-20">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#74f2c2]">
              Available events
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Upcoming commitments
            </h2>
          </div>

          <p className="hidden text-sm text-white/35 sm:block">
            {events.length} events available
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {events.map((event) => {
            const remainingSeats = event.capacity - event.reserved;
            const progress = Math.min(
              100,
              Math.round((event.reserved / event.capacity) * 100),
            );

            return (
              <article
                key={event.id}
                className="group flex h-full flex-col rounded-[28px] border border-white/10 bg-white/[0.035] p-4 transition hover:-translate-y-1 hover:border-[#74f2c2]/25 hover:bg-white/[0.05]"
              >
                <div className="flex h-full flex-col rounded-[23px] border border-white/10 bg-[#0b1916] p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-white/50">
                        {event.category}
                      </span>

                      <span
                        className={`rounded-full border px-3 py-1.5 text-xs ${getStatusClassName(
                          event.status,
                        )}`}
                      >
                        {event.status}
                      </span>
                    </div>

                    <div className="shrink-0 rounded-2xl bg-[#74f2c2] px-3 py-2 text-center text-[#07110f]">
                      <p className="text-xs font-semibold">{event.month}</p>
                      <p className="text-xl font-black">{event.date}</p>
                    </div>
                  </div>

                  <h3 className="mt-6 text-2xl font-semibold leading-tight">
                    {event.title}
                  </h3>

                  <p className="mt-3 min-h-20 text-sm leading-6 text-white/45">
                    {event.description}
                  </p>

                  <div className="mt-6 space-y-3 border-y border-white/10 py-5">
                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-white/35">Time</span>
                      <span className="text-right font-medium text-white/70">
                        {event.time}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-white/35">Location</span>
                      <span className="text-right font-medium text-white/70">
                        {event.location}
                      </span>
                    </div>

                    <div className="flex items-center justify-between gap-4 text-sm">
                      <span className="text-white/35">Organizer</span>
                      <span className="text-right font-medium text-white/70">
                        {event.organizer}
                      </span>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Refundable deposit
                      </p>

                      <p className="mt-2 text-lg font-semibold">
                        {event.deposit}
                      </p>
                    </div>

                    <div className="rounded-2xl bg-white/[0.04] p-4">
                      <p className="text-xs leading-5 text-white/35">
                        Seats remaining
                      </p>

                      <p className="mt-2 text-lg font-semibold">
                        {remainingSeats}
                      </p>
                    </div>
                  </div>

                  <div className="mt-5">
                    <div className="flex items-center justify-between text-xs text-white/35">
                      <span>
                        {event.reserved} of {event.capacity} reserved
                      </span>
                      <span>{progress}%</span>
                    </div>

                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-[#74f2c2]"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-auto pt-6">
                    <button
                      type="button"
                      className="w-full rounded-2xl bg-[#74f2c2] py-4 font-semibold text-[#07110f] transition hover:bg-[#9dffda]"
                    >
                      View event
                    </button>

                    <p className="mt-3 text-center text-xs text-white/30">
                      Refundable commitment secured on Arc
                    </p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-14 rounded-[30px] border border-[#74f2c2]/20 bg-[#74f2c2]/10 p-8 lg:flex lg:items-center lg:justify-between lg:p-10">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.2em] text-[#9dffda]">
              Hosting something?
            </p>

            <h2 className="mt-3 text-3xl font-semibold tracking-tight">
              Fill your seats with people who intend to attend.
            </h2>

            <p className="mt-3 max-w-2xl leading-7 text-white/50">
              Create transparent cancellation, attendance and refund rules
              backed by programmable USDC.
            </p>
          </div>

          <Link
            href="/create"
            className="mt-7 inline-block shrink-0 rounded-full bg-white px-7 py-3.5 text-center font-semibold text-[#07110f] transition hover:bg-[#dfffee] lg:mt-0"
          >
            Create your event
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/40 sm:flex-row sm:items-center sm:justify-between lg:px-10">
          <p>ShowUp. Programmable commitment on Arc.</p>
          <p>Sample events will be replaced by onchain event data.</p>
        </div>
      </footer>
    </main>
  );
}