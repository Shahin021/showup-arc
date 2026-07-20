"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ChangeEvent } from "react";

const CIRCLE_USER_ID_KEY = "showup_circle_user_id";
const CIRCLE_WALLET_READY_KEY = "showup_circle_wallet_ready";
const CIRCLE_WALLET_ADDRESS_KEY = "showup_circle_wallet_address";
const CIRCLE_WALLET_ID_KEY = "showup_circle_wallet_id";
const CIRCLE_WALLET_CHANGED_EVENT = "showup-circle-wallet-changed";
const PAGE_SIZE = 20;

type SessionResponse = {
  userToken?: string;
  encryptionKey?: string;
  error?: string;
};

type ChallengeResponse = {
  challengeId?: string;
  error?: string;
};

type AttendeeDetails = {
  attendee: string;
  status: number;
  label: string;
  reservedAt: string;
  updatedAt: string;
  active: boolean;
  attended: boolean;
};

type AttendeesResponse = {
  organizer?: string;
  deposit?: {
    amount: string;
    formatted: string;
  };
  timing?: {
    eventStart: string;
    eventEnd: string;
    resolutionDeadline: string;
    attendanceWindowOpen: boolean;
    noShowWindowOpen: boolean;
  };
  attendeeCount?: string;
  filteredCount?: string;
  page?: number;
  pageSize?: number;
  totalPages?: number;
  hasPrevious?: boolean;
  hasNext?: boolean;
  attendees?: AttendeeDetails[];
  error?: string;
};

type PrintExportResponse = {
  generatedAt?: string;
  event?: {
    id: string;
    title: string;
    organizer: string;
    deposit: {
      amount: string;
      formatted: string;
    };
    timing: {
      eventStart: string;
      eventEnd: string;
      resolutionDeadline: string;
    };
  };
  attendeeCount?: string;
  attendees?: AttendeeDetails[];
  error?: string;
};

type OrganizerAttendancePanelProps = {
  eventId: string;
  organizer: string;
  depositFormatted: string;
  eventStart: string;
  resolutionDeadline: string;
  onAttendanceConfirmed?: (attendee: string) => void;
};

type ConnectedOrganizerWallet = {
  circleUserId: string;
  walletId: string;
  walletAddress: string;
};

type StatusFilter =
  | "all"
  | "reserved"
  | "cancelled"
  | "attended"
  | "no-show"
  | "fallback-refunded"
  | "event-cancelled-refunded";

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, milliseconds);
  });
}

function shortenAddress(address: string) {
  if (!address || address.length <= 14) {
    return address || "Unknown";
  }

  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function formatTimestamp(timestamp: string) {
  const seconds = Number(timestamp);

  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "Not available";
  }

  return new Date(seconds * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return "Unable to complete this organizer action.";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getStatusClass(status: number) {
  if (status === 1) {
    return "border-[#74f2c2]/25 bg-[#74f2c2]/10 text-[#b7ffe3]";
  }

  if (status === 3) {
    return "border-sky-300/25 bg-sky-300/10 text-sky-100";
  }

  if (status === 4) {
    return "border-red-300/25 bg-red-300/10 text-red-100";
  }

  return "border-white/10 bg-white/[0.04] text-white/50";
}

function getConnectedOrganizerWallet(
  organizer: string,
): ConnectedOrganizerWallet {
  const circleUserId =
    window.localStorage.getItem(CIRCLE_USER_ID_KEY)?.trim() ?? "";
  const walletReady =
    window.localStorage.getItem(CIRCLE_WALLET_READY_KEY) === "true";
  const walletAddress =
    window.localStorage.getItem(CIRCLE_WALLET_ADDRESS_KEY)?.trim() ?? "";
  const walletId =
    window.localStorage.getItem(CIRCLE_WALLET_ID_KEY)?.trim() ?? "";

  if (!circleUserId || !walletReady || !walletAddress || !walletId) {
    throw new Error("Connect the organizer Circle wallet first.");
  }

  if (walletAddress.toLowerCase() !== organizer.toLowerCase()) {
    throw new Error("Only the organizer wallet can use these controls.");
  }

  return {
    circleUserId,
    walletId,
    walletAddress,
  };
}

async function requestCircleSession(
  userId: string,
): Promise<{
  userToken: string;
  encryptionKey: string;
}> {
  const response = await fetch("/api/circle/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    cache: "no-store",
    body: JSON.stringify({ userId }),
  });
  const data = (await response.json()) as SessionResponse;

  if (!response.ok || !data.userToken || !data.encryptionKey) {
    throw new Error(
      data.error ?? "Unable to create a secure Circle session.",
    );
  }

  return {
    userToken: data.userToken,
    encryptionKey: data.encryptionKey,
  };
}

async function executeCircleChallenge(
  challengeId: string,
  userToken: string,
  encryptionKey: string,
) {
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID;

  if (!appId) {
    throw new Error("Circle App ID is not configured.");
  }

  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  const circleSdk = new W3SSdk({
    appSettings: {
      appId,
    },
  });

  await circleSdk.getDeviceId();
  circleSdk.setAuthentication({
    userToken,
    encryptionKey,
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      reject(
        new Error(
          "Circle approval timed out. No transaction was submitted.",
        ),
      );
    }, 10 * 60 * 1000);

    circleSdk.execute(challengeId, (error, result) => {
      window.clearTimeout(timeout);

      if (error) {
        reject(
          new Error(
            error.message ||
              `Circle authorization failed${
                error.code ? ` (${error.code})` : ""
              }.`,
          ),
        );
        return;
      }

      if (!result) {
        reject(new Error("Circle did not return an authorization result."));
        return;
      }

      if (result.status === "FAILED" || result.status === "EXPIRED") {
        reject(
          new Error(
            `Circle authorization ended with status: ${result.status}.`,
          ),
        );
        return;
      }

      resolve();
    });
  });
}

async function requestAttendees(input: {
  eventId: string;
  organizer: string;
  page: number;
  search: string;
  status: StatusFilter;
}) {
  const connectedWallet = getConnectedOrganizerWallet(input.organizer);
  const session = await requestCircleSession(connectedWallet.circleUserId);
  const query = new URLSearchParams({
    page: String(input.page),
    search: input.search,
    status: input.status,
  });
  const response = await fetch(
    `/api/events/${encodeURIComponent(input.eventId)}/attendees?${query.toString()}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken: session.userToken,
        walletId: connectedWallet.walletId,
      }),
    },
  );
  const data = (await response.json()) as AttendeesResponse;

  if (!response.ok) {
    throw new Error(data.error ?? "Unable to load attendees.");
  }

  return data;
}

async function requestExport(input: {
  eventId: string;
  organizer: string;
  format: "csv" | "json";
}) {
  const connectedWallet = getConnectedOrganizerWallet(input.organizer);
  const session = await requestCircleSession(connectedWallet.circleUserId);
  const response = await fetch(
    `/api/events/${encodeURIComponent(input.eventId)}/attendees/export?format=${input.format}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify({
        userToken: session.userToken,
        walletId: connectedWallet.walletId,
      }),
    },
  );

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(data.error ?? "Unable to export attendees.");
  }

  return response;
}

function createPrintDocument(data: PrintExportResponse) {
  const event = data.event;
  const attendees = data.attendees ?? [];
  const title = event?.title || `ShowUp Event #${event?.id ?? ""}`;
  const generatedAt = data.generatedAt
    ? new Date(data.generatedAt).toLocaleString()
    : new Date().toLocaleString();
  const attendeeRows = attendees
    .map(
      (attendee, index) => `
        <tr>
          <td>${index + 1}</td>
          <td class="wallet">${escapeHtml(attendee.attendee)}</td>
          <td>${escapeHtml(attendee.label)}</td>
          <td>${escapeHtml(formatTimestamp(attendee.reservedAt))}</td>
          <td>${escapeHtml(formatTimestamp(attendee.updatedAt))}</td>
        </tr>
      `,
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)} — Attendee Report</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; padding: 32px; color: #111; font-family: Arial, Helvetica, sans-serif; }
    h1 { margin: 0 0 8px; font-size: 24px; }
    .meta { margin: 0 0 24px; color: #555; font-size: 12px; line-height: 1.7; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; }
    th, td { border: 1px solid #d7d7d7; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #f2f2f2; }
    .wallet { font-family: Consolas, Menlo, monospace; overflow-wrap: anywhere; }
    @page { size: auto; margin: 14mm; }
    @media print { body { padding: 0; } }
  </style>
</head>
<body>
  <h1>${escapeHtml(title)}</h1>
  <div class="meta">
    Event ID: ${escapeHtml(event?.id ?? "")}<br />
    Organizer: ${escapeHtml(event?.organizer ?? "")}<br />
    Deposit: ${escapeHtml(event?.deposit?.formatted ?? "0")} USDC<br />
    Total attendees: ${escapeHtml(data.attendeeCount ?? String(attendees.length))}<br />
    Generated: ${escapeHtml(generatedAt)}
  </div>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Wallet address</th>
        <th>Status</th>
        <th>Reserved at</th>
        <th>Updated at</th>
      </tr>
    </thead>
    <tbody>
      ${
        attendeeRows ||
        '<tr><td colspan="5">No attendees found for this event.</td></tr>'
      }
    </tbody>
  </table>
  <script>
    window.addEventListener("load", function () {
      window.setTimeout(function () { window.print(); }, 150);
    });
  </script>
</body>
</html>`;
}

export default function OrganizerAttendancePanel({
  eventId,
  organizer,
  depositFormatted,
  eventStart,
  resolutionDeadline,
  onAttendanceConfirmed,
}: OrganizerAttendancePanelProps) {
  const [isOrganizer, setIsOrganizer] = useState(false);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [busyAttendee, setBusyAttendee] = useState("");
  const [busyAction, setBusyAction] = useState<"attendance" | "no-show" | "">("");
  const [attendees, setAttendees] = useState<AttendeeDetails[]>([]);
  const [attendanceWindowOpen, setAttendanceWindowOpen] = useState(false);
  const [noShowWindowOpen, setNoShowWindowOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [attendeeCount, setAttendeeCount] = useState(0);
  const [filteredCount, setFilteredCount] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [walletSearch, setWalletSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const loadAttendees = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const data = await requestAttendees({
        eventId,
        organizer,
        page,
        search: walletSearch,
        status: statusFilter,
      });

      setAttendees(data.attendees ?? []);
      setAttendanceWindowOpen(Boolean(data.timing?.attendanceWindowOpen));
      setNoShowWindowOpen(Boolean(data.timing?.noShowWindowOpen));
      setAttendeeCount(Number(data.attendeeCount ?? "0"));
      setFilteredCount(Number(data.filteredCount ?? data.attendeeCount ?? "0"));
      setTotalPages(Math.max(1, data.totalPages ?? 1));

      if (data.page && data.page !== page) {
        setPage(data.page);
      }
    } catch (loadError) {
      setError(getErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, [eventId, organizer, page, statusFilter, walletSearch]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setPage(1);
      setWalletSearch(searchInput.trim());
    }, 350);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchInput]);

  useEffect(() => {
    function refreshOrganizerState() {
      const walletReady =
        window.localStorage.getItem(CIRCLE_WALLET_READY_KEY) === "true";
      const walletAddress =
        window.localStorage.getItem(CIRCLE_WALLET_ADDRESS_KEY) ?? "";
      const organizerConnected =
        walletReady &&
        walletAddress.toLowerCase() === organizer.toLowerCase();

      setIsOrganizer(organizerConnected);
      setError("");
      setMessage("");

      if (!organizerConnected) {
        setAttendees([]);
        setAttendanceWindowOpen(false);
        setNoShowWindowOpen(false);
        setBusyAttendee("");
        setBusyAction("");
        setPage(1);
        setTotalPages(1);
        setAttendeeCount(0);
        setFilteredCount(0);
      }
    }

    refreshOrganizerState();
    window.addEventListener(
      CIRCLE_WALLET_CHANGED_EVENT,
      refreshOrganizerState,
    );

    return () => {
      window.removeEventListener(
        CIRCLE_WALLET_CHANGED_EVENT,
        refreshOrganizerState,
      );
    };
  }, [organizer]);

  useEffect(() => {
    if (isOrganizer) {
      void loadAttendees();
    }
  }, [isOrganizer, loadAttendees]);

  const showingFrom = useMemo(() => {
    if (filteredCount === 0) {
      return 0;
    }

    return (page - 1) * PAGE_SIZE + 1;
  }, [filteredCount, page]);

  const showingTo = useMemo(() => {
    if (filteredCount === 0) {
      return 0;
    }

    return Math.min(page * PAGE_SIZE, filteredCount);
  }, [filteredCount, page]);

  async function handleConfirmAttendance(attendee: string) {
    if (busyAttendee) {
      return;
    }

    setBusyAttendee(attendee);
    setBusyAction("attendance");
    setError("");
    setMessage("Creating a secure Circle session...");

    try {
      const connectedWallet = getConnectedOrganizerWallet(organizer);
      const session = await requestCircleSession(connectedWallet.circleUserId);

      setMessage("Preparing attendance confirmation...");

      const response = await fetch(
        "/api/circle/events/confirm-attendance",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            userToken: session.userToken,
            walletId: connectedWallet.walletId,
            eventId,
            attendee,
          }),
        },
      );
      const data = (await response.json()) as ChallengeResponse;

      if (!response.ok || !data.challengeId) {
        throw new Error(
          data.error ?? "Unable to prepare attendance confirmation.",
        );
      }

      setMessage(
        `Enter your Circle PIN to confirm ${shortenAddress(attendee)}. Their ${depositFormatted} USDC deposit will be refunded.`,
      );

      await executeCircleChallenge(
        data.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage("Waiting for attendance confirmation on Arc Testnet...");

      let confirmed = false;

      for (let attempt = 0; attempt < 45; attempt += 1) {
        const currentData = await requestAttendees({
          eventId,
          organizer,
          page: 1,
          search: attendee,
          status: "all",
        });
        const updatedAttendee = currentData.attendees?.find(
          (item) => item.attendee.toLowerCase() === attendee.toLowerCase(),
        );

        if (updatedAttendee?.attended) {
          confirmed = true;
          break;
        }

        await wait(2000);
      }

      if (!confirmed) {
        throw new Error(
          "The transaction was submitted but attendance has not been confirmed yet. Refresh shortly.",
        );
      }

      setMessage(
        `Attendance confirmed. ${depositFormatted} USDC was returned to ${shortenAddress(attendee)}.`,
      );
      onAttendanceConfirmed?.(attendee);
      await loadAttendees();
    } catch (confirmError) {
      console.error("ShowUp attendance confirmation failed:", confirmError);
      setError(getErrorMessage(confirmError));
      setMessage("");
    } finally {
      setBusyAttendee("");
      setBusyAction("");
    }
  }

  async function handleSettleNoShow(attendee: string) {
    if (busyAttendee) {
      return;
    }

    setBusyAttendee(attendee);
    setBusyAction("no-show");
    setError("");
    setMessage("Creating a secure Circle session...");

    try {
      const connectedWallet = getConnectedOrganizerWallet(organizer);
      const session = await requestCircleSession(connectedWallet.circleUserId);

      setMessage("Preparing no-show settlement...");

      const response = await fetch(
        "/api/circle/events/settle-no-show",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            userToken: session.userToken,
            walletId: connectedWallet.walletId,
            eventId,
            attendee,
          }),
        },
      );

      const data = (await response.json()) as ChallengeResponse;

      if (!response.ok || !data.challengeId) {
        throw new Error(
          data.error ?? "Unable to prepare no-show settlement.",
        );
      }

      setMessage(
        `Enter your Circle PIN to mark ${shortenAddress(attendee)} as a no-show. Their ${depositFormatted} USDC deposit will be transferred to the organizer.`,
      );

      await executeCircleChallenge(
        data.challengeId,
        session.userToken,
        session.encryptionKey,
      );

      setMessage("Waiting for no-show settlement on Arc Testnet...");

      let settled = false;

      for (let attempt = 0; attempt < 45; attempt += 1) {
        const currentData = await requestAttendees({
          eventId,
          organizer,
          page: 1,
          search: attendee,
          status: "all",
        });

        const updatedAttendee = currentData.attendees?.find(
          (item) =>
            item.attendee.toLowerCase() === attendee.toLowerCase(),
        );

        if (updatedAttendee?.status === 4) {
          settled = true;
          break;
        }

        await wait(2000);
      }

      if (!settled) {
        throw new Error(
          "The transaction was submitted but the no-show settlement is not confirmed yet. Refresh shortly.",
        );
      }

      setMessage(
        `${shortenAddress(attendee)} was marked as a no-show. ${depositFormatted} USDC was transferred to the organizer.`,
      );

      await loadAttendees();
    } catch (settleError) {
      console.error("ShowUp no-show settlement failed:", settleError);
      setError(getErrorMessage(settleError));
      setMessage("");
    } finally {
      setBusyAttendee("");
      setBusyAction("");
    }
  }

  async function handleCsvExport() {
    if (exporting || printing) {
      return;
    }

    setExporting(true);
    setError("");
    setMessage("Preparing the complete attendee CSV...");

    try {
      const response = await requestExport({
        eventId,
        organizer,
        format: "csv",
      });
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition") ?? "";
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/i);
      const filename =
        filenameMatch?.[1] ?? `showup-event-${eventId}-attendees.csv`;
      const objectUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(objectUrl);

      setMessage(
        "The complete attendee CSV was exported for Excel.",
      );
    } catch (exportError) {
      setError(getErrorMessage(exportError));
      setMessage("");
    } finally {
      setExporting(false);
    }
  }

  async function handlePrintReport() {
    if (printing || exporting) {
      return;
    }

    const printWindow = window.open("", "_blank");

    if (!printWindow) {
      setError("Allow pop-ups to create the printable attendee report.");
      return;
    }

    printWindow.document.write(
      "<!doctype html><title>Preparing ShowUp report...</title><p style='font-family:Arial;padding:24px'>Preparing the complete attendee report...</p>",
    );

    setPrinting(true);
    setError("");
    setMessage("Preparing the complete printable report...");

    try {
      const response = await requestExport({
        eventId,
        organizer,
        format: "json",
      });
      const data = (await response.json()) as PrintExportResponse;

      printWindow.document.open();
      printWindow.document.write(createPrintDocument(data));
      printWindow.document.close();
      setMessage("The complete report is ready for Print / Save as PDF.");
    } catch (printError) {
      printWindow.close();
      setError(getErrorMessage(printError));
      setMessage("");
    } finally {
      setPrinting(false);
    }
  }

  async function handleCopyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setMessage(`Copied ${shortenAddress(address)}.`);
      setError("");
    } catch {
      setError("Unable to copy the wallet address.");
    }
  }

  if (!isOrganizer) {
    return null;
  }

  return (
    <section className="mt-6 rounded-[26px] border border-[#74f2c2]/20 bg-[#74f2c2]/[0.055] p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#74f2c2]">
            Organizer controls
          </p>
          <h3 className="mt-2 text-lg font-semibold">Attendance check-in</h3>
          <p className="mt-2 text-sm leading-6 text-white/45">
            Confirm attendance to return each attendee&apos;s {depositFormatted}{" "}
            USDC commitment deposit.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              void loadAttendees();
            }}
            disabled={loading || Boolean(busyAttendee)}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-wait disabled:opacity-50"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
          <button
            type="button"
            onClick={() => {
              void handleCsvExport();
            }}
            disabled={exporting || printing || Boolean(busyAttendee)}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-wait disabled:opacity-50"
          >
            {exporting ? "Exporting..." : "Export CSV"}
          </button>
          <button
            type="button"
            onClick={() => {
              void handlePrintReport();
            }}
            disabled={printing || exporting || Boolean(busyAttendee)}
            className="rounded-xl border border-white/10 px-3 py-2 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-wait disabled:opacity-50"
          >
            {printing ? "Preparing..." : "Print / PDF"}
          </button>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-white/10 bg-black/10 px-4 py-3 text-xs leading-5 text-white/45">
        {attendanceWindowOpen ? (
          <>
            Check-in is open until {formatTimestamp(resolutionDeadline)}.
          </>
        ) : (
          <>
            Check-in is available from {formatTimestamp(eventStart)} until{" "}
            {formatTimestamp(resolutionDeadline)}.
          </>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="sr-only">Search wallet address</span>
          <input
            type="search"
            value={searchInput}
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              setSearchInput(event.target.value);
            }}
            placeholder="Search wallet address..."
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none transition placeholder:text-white/25 focus:border-[#74f2c2]/35"
          />
        </label>

        <label className="w-full sm:w-[210px] sm:flex-none">
          <span className="sr-only">Filter attendance status</span>
          <select
            value={statusFilter}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              setPage(1);
              setStatusFilter(event.target.value as StatusFilter);
            }}
            className="w-full rounded-2xl border border-white/10 bg-[#0b1714] px-4 py-3 text-sm text-white/75 outline-none transition focus:border-[#74f2c2]/35"
          >
            <option value="all">All statuses</option>
            <option value="reserved">Reserved</option>
            <option value="attended">Attended</option>
            <option value="cancelled">Cancelled</option>
            <option value="no-show">No-show</option>
            <option value="fallback-refunded">Fallback refunded</option>
            <option value="event-cancelled-refunded">
              Event cancelled refunded
            </option>
          </select>
        </label>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-white/35">
        <p>
          Showing {showingFrom}-{showingTo} of {filteredCount} matching
          attendees
        </p>
        <p>Total attendee wallets: {attendeeCount}</p>
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-100/80">
          {error}
        </div>
      ) : null}

      {message ? (
        <div className="mt-4 rounded-2xl border border-[#74f2c2]/20 bg-[#74f2c2]/10 px-4 py-3 text-sm leading-6 text-[#caffeb]">
          {message}
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {loading && attendees.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-5 text-sm text-white/40">
            Loading attendee page...
          </div>
        ) : null}

        {!loading && attendees.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-black/10 px-4 py-5 text-sm text-white/40">
            No attendee wallets match this search and status filter.
          </div>
        ) : null}

        {attendees.map((attendee) => {
          const processing =
            busyAttendee.toLowerCase() === attendee.attendee.toLowerCase();

          return (
            <div
              key={attendee.attendee}
              className="rounded-2xl border border-white/10 bg-black/10 p-4"
            >
              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      title={attendee.attendee}
                      onClick={() => {
                        void handleCopyAddress(attendee.attendee);
                      }}
                      className="max-w-full rounded-lg font-mono text-sm font-medium text-white/80 transition hover:text-[#b7ffe3]"
                    >
                      {shortenAddress(attendee.attendee)}
                    </button>
                    <span
                      className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${getStatusClass(attendee.status)}`}
                    >
                      {attendee.label}
                    </span>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-white/35">
                    Reserved {formatTimestamp(attendee.reservedAt)}
                  </p>
                </div>

                {attendee.active ? (
                  <div className="grid w-full grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        void handleConfirmAttendance(attendee.attendee);
                      }}
                      disabled={
                        !attendanceWindowOpen || Boolean(busyAttendee)
                      }
                      className="w-full rounded-xl bg-[#74f2c2] px-4 py-2.5 text-xs font-semibold text-[#07110f] transition hover:bg-[#8ff6cf] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {processing && busyAction === "attendance"
                        ? "Confirming..."
                        : "Confirm attendance"}
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleSettleNoShow(attendee.attendee);
                      }}
                      disabled={
                        !noShowWindowOpen || Boolean(busyAttendee)
                      }
                      className="w-full rounded-xl border border-red-300/25 bg-red-300/10 px-4 py-2.5 text-xs font-semibold text-red-100 transition hover:border-red-300/40 hover:bg-red-300/15 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {processing && busyAction === "no-show"
                        ? "Settling..."
                        : "Mark as no-show"}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => {
            setPage((currentPage) => Math.max(1, currentPage - 1));
          }}
          disabled={page <= 1 || loading || Boolean(busyAttendee)}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Previous
        </button>

        <p className="text-center text-xs text-white/40">
          Page {page} of {totalPages}
        </p>

        <button
          type="button"
          onClick={() => {
            setPage((currentPage) =>
              Math.min(totalPages, currentPage + 1),
            );
          }}
          disabled={page >= totalPages || loading || Boolean(busyAttendee)}
          className="rounded-xl border border-white/10 px-4 py-2.5 text-xs font-medium text-white/55 transition hover:border-[#74f2c2]/25 hover:bg-[#74f2c2]/10 hover:text-[#b7ffe3] disabled:cursor-not-allowed disabled:opacity-35"
        >
          Next
        </button>
      </div>
    </section>
  );
}
