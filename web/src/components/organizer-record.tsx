"use client";

import { useEffect, useState } from "react";

type Stats = {
  eventsCreated: string;
  eventsCancelled: string;
  attendanceConfirmed: string;
  selfCheckIns: string;
  noShowsSettled: string;
  noShowAmountCollected: string;
};

/**
 * Shows the organizer's on-chain track record before someone reserves, so
 * an organizer who marks many no-shows is visible to attendees.
 */
export default function OrganizerRecord({ organizer }: { organizer: string }) {
  const [stats, setStats] = useState<Stats | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organizers/${organizer}/stats`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: Stats | null) => {
        if (!cancelled && data) {
          setStats(data);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [organizer]);

  if (!stats) {
    return null;
  }

  const attended =
    Number(stats.attendanceConfirmed) + Number(stats.selfCheckIns);

  return (
    <div className="mt-6 rounded-[24px] border border-[#79b7ff]/12 bg-[#0b1025]/60 p-5">
      <p className="text-sm font-semibold text-white/80">Organizer record on chain</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-white/40">Events created</dt>
          <dd className="text-white">{stats.eventsCreated}</dd>
        </div>
        <div>
          <dt className="text-white/40">Cancelled</dt>
          <dd className="text-white">{stats.eventsCancelled}</dd>
        </div>
        <div>
          <dt className="text-white/40">Attendances (self check-ins)</dt>
          <dd className="text-white">
            {attended} ({stats.selfCheckIns})
          </dd>
        </div>
        <div>
          <dt className="text-white/40">No-shows settled</dt>
          <dd className="text-white">
            {stats.noShowsSettled} ({stats.noShowAmountCollected} USDC)
          </dd>
        </div>
      </dl>
    </div>
  );
}
