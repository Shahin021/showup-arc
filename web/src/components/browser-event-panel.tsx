"use client";

import { useCallback, useEffect, useState } from "react";
import { formatUnits, getAddress, isAddress, type Address, type Hex } from "viem";
import { arcPublicClient } from "@/lib/arc-public-client";
import { executeBrowserEventAction, type BrowserAction } from "@/lib/browser-event-actions";
import { connectBrowserWallet, findBrowserWalletProvider } from "@/lib/browser-wallet";
import { getViemInvitationTypedData, parseReservationInvitation } from "@/lib/showup-invitation";
import { SHOWUP_ABI } from "@/lib/showup-abi";
import { explorerTxUrl, ARC_NETWORK_LABEL, IS_MAINNET, SHOWUP_CONTRACT_ADDRESS } from "@/lib/showup-network";
import { readActiveWallet, SHOWUP_WALLET_CHANGED_EVENT, type ShowUpWallet } from "@/lib/showup-wallet";

type Event = Awaited<ReturnType<typeof readEvent>>;
type Reservation = Awaited<ReturnType<typeof readReservation>>;
function readEvent(id: bigint) {
  return arcPublicClient.readContract({ address: SHOWUP_CONTRACT_ADDRESS, abi: SHOWUP_ABI, functionName: "getEvent", args: [id] });
}
function readReservation(id: bigint, address: Address) {
  return arcPublicClient.readContract({ address: SHOWUP_CONTRACT_ADDRESS, abi: SHOWUP_ABI, functionName: "getReservation", args: [id, address] });
}
const statusLabels = ["No reservation", "Reserved", "Cancelled", "Attended", "No-show", "Fallback refunded", "Event cancellation refunded", "Payment due", "Fully paid", "Payment defaulted"];
const buttonClass = "rounded-xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-3 text-sm disabled:opacity-40";

export default function BrowserEventPanel({ eventId }: { eventId: string }) {
  const id = BigInt(eventId);
  const [wallet, setWallet] = useState<ShowUpWallet | null>(null);
  const [data, setData] = useState<{ event: Event; reservation: Reservation; rows: { address: Address; reservation: Reservation }[]; now: number } | null>(null);
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [hash, setHash] = useState<Hex | null>(null);
  const [attendee, setAttendee] = useState("");
  const [invite, setInvite] = useState("");
  const [inviteNonce, setInviteNonce] = useState<bigint | null>(null);
  const [confirmation, setConfirmation] = useState<{ action: BrowserAction; args: readonly unknown[]; amount: bigint; label: string } | null>(null);

  useEffect(() => {
    const sync = () => { setWallet(readActiveWallet()); setData(null); setPage(0); setConfirmation(null); setInvite(""); setInviteNonce(null); setError(""); setMessage(""); setHash(null); };
    const timer = window.setTimeout(sync, 0);
    window.addEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => { clearTimeout(timer); window.removeEventListener(SHOWUP_WALLET_CHANGED_EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);

  const refresh = useCallback(async () => {
    if (!wallet || wallet.kind !== "browser") return;
    const [event, reservation, block] = await Promise.all([readEvent(BigInt(eventId)), readReservation(BigInt(eventId), wallet.address), arcPublicClient.getBlock()]);
    const addresses = event.organizer.toLowerCase() === wallet.address.toLowerCase()
      ? await arcPublicClient.readContract({ address: SHOWUP_CONTRACT_ADDRESS, abi: SHOWUP_ABI, functionName: "getAttendees", args: [BigInt(eventId), BigInt(page * 20), BigInt(20)] }) : [];
    const rows = await Promise.all(addresses.map(async (address) => ({ address, reservation: await readReservation(BigInt(eventId), address) })));
    return { event, reservation, rows, now: Number(block.timestamp) };
  }, [wallet, eventId, page]);

  useEffect(() => {
    let cancelled = false;
    const load = () => void refresh().then((result) => { if (!cancelled && result) { setData(result); setError(""); } }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "Unable to load event state."); });
    load();
    const timer = window.setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [refresh]);

  async function execute() {
    if (!confirmation || !wallet || wallet.kind !== "browser" || busy) return;
    const operation = confirmation;
    setConfirmation(null); setBusy(true); setError(""); setHash(null);
    setMessage("Approve this action in your wallet. A payment may require a USDC approval first.");
    try {
      const result = await executeBrowserEventAction(wallet, operation.action, operation.args, operation.amount, operation.label, setHash);
      setHash(result); setMessage("Confirmed on-chain.");
      try {
        const updated = await refresh();
        if (updated && readActiveWallet()?.address.toLowerCase() === wallet.address.toLowerCase()) setData(updated);
      } catch {
        setError("Transaction confirmed, but event data could not be refreshed. Reload to retry the read.");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed. Check the receipt before retrying.");
      setMessage("");
    } finally { setBusy(false); }
  }

  function request(action: BrowserAction, args: readonly unknown[], amount: bigint, label: string) {
    if (!busy) { setError(""); setConfirmation({ action, args, amount, label }); }
  }
  function reserve(full: boolean) {
    if (!data || !wallet) return;
    try {
      const { event } = data;
      let args: readonly unknown[] = [id];
      let action: BrowserAction = full ? "reserveSeatAndPayFull" : "reserveSeat";
      if (event.accessMode === 1) {
        const query = new URLSearchParams(window.location.search);
        if (query.get("attendee")?.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Open the complete invitation link for this wallet.");
        const invitation = parseReservationInvitation({ nonce: query.get("nonce"), expiry: query.get("expiry"), signature: query.get("signature") });
        args = [id, invitation.nonce, invitation.expiry, invitation.signature];
        action = full ? "reserveSeatAndPayFullWithInvitation" : "reserveSeatWithInvitation";
      }
      request(action, args, full ? event.totalPrice : event.depositAmount, full ? "Reserve with full payment" : "Reserve seat");
    } catch (e) { setError(e instanceof Error ? e.message : "Invalid invitation."); }
  }

  async function signInvitation() {
    if (!data || !wallet || wallet.kind !== "browser" || !isAddress(attendee) || busy) return;
    setBusy(true); setError(""); setInvite(""); setInviteNonce(null);
    try {
      const provider = await findBrowserWalletProvider(wallet.providerRdns);
      const connection = await connectBrowserWallet(provider.provider);
      if (connection.address.toLowerCase() !== data.event.organizer.toLowerCase() || connection.address.toLowerCase() !== wallet.address.toLowerCase()) throw new Error("Reconnect the organizer account.");
      const bytes = window.crypto.getRandomValues(new Uint8Array(32));
      const nonce = BigInt(`0x${Array.from(bytes, (v) => v.toString(16).padStart(2, "0")).join("")}`);
      const payload = { eventId: id, attendee: getAddress(attendee), nonce, expiry: BigInt(data.event.eventStart) };
      const typedData = getViemInvitationTypedData(payload);
      const signature = await connection.walletClient.signTypedData({ account: connection.address, ...typedData });
      if (!await arcPublicClient.verifyTypedData({ address: connection.address, ...typedData, signature })) throw new Error("The invitation signature could not be verified.");
      const url = new URL(`/events/${eventId}`, window.location.origin);
      url.search = new URLSearchParams({ attendee: payload.attendee, nonce: nonce.toString(), expiry: payload.expiry.toString(), signature }).toString();
      setInvite(url.toString()); setInviteNonce(nonce);
    } catch (e) { setError(e instanceof Error ? e.message : "Signing failed."); }
    finally { setBusy(false); }
  }

  if (!wallet || wallet.kind !== "browser") return <p className="mt-5 text-sm text-white/60">Connect your browser wallet to reserve or manage this event.</p>;
  const event = data?.event;
  const status = data?.reservation.status ?? 0;
  const active = [1, 7, 8].includes(status);
  const organizer = event?.organizer.toLowerCase() === wallet.address.toLowerCase();
  const now = data?.now ?? 0;
  const open = event && !event.cancelled && now < Number(event.eventStart);
  const settlement = event && !event.cancelled && now >= Number(event.eventStart) && now <= Number(event.resolutionDeadline);
  const remaining = event ? event.totalPrice - event.depositAmount : BigInt(0);
  function button(label: string, action: BrowserAction, args: readonly unknown[] = [id], amount = BigInt(0)) {
    return <button key={label} className={buttonClass} disabled={busy} onClick={() => request(action, args, amount, label)}>{label}</button>;
  }
  return <section className="mt-5 space-y-4 text-sm">
    <h3 className="font-semibold">{organizer ? "Manage event" : "Your reservation"}</h3>
    {!data && !error && <p>Loading on-chain state…</p>}
    {data && <p>{statusLabels[status] ?? "Unknown status"}{event?.cancelled ? " · Event cancelled" : ""}</p>}
    <div className="flex flex-wrap gap-2">
      {!organizer && open && status === 0 && <>
        {(event.eventType === 0 || (event.depositAmount > BigInt(0) && now < Number(event.paymentDeadline))) && <button className={buttonClass} disabled={busy} onClick={() => reserve(false)}>Reserve · {formatUnits(event.depositAmount, 6)} USDC</button>}
        {event.eventType === 1 && <button className={buttonClass} disabled={busy} onClick={() => reserve(true)}>Pay full · {formatUnits(event.totalPrice, 6)} USDC</button>}
      </>}
      {!organizer && event && !event.cancelled && status === 7 && now <= Number(data?.reservation.paymentDeadline) && button("Pay remaining balance", "payRemainingBalance", [id], remaining)}
      {!organizer && event && active && !event.cancelled && now <= Number(event.cancellationDeadline) && button("Cancel reservation and refund", "cancelReservation")}
      {!organizer && event && active && event.cancelled && button("Claim cancelled-event refund", "claimCancelledEventRefund")}
      {!organizer && event && active && !event.cancelled && now > Number(event.resolutionDeadline) && button("Claim fallback refund", "claimFallbackRefund")}
      {organizer && open && button("Cancel event", "cancelEvent")}
    </div>
    {organizer && open && event.accessMode === 1 && <div className="space-y-3">
      <label className="block">Invited wallet<input value={attendee} onChange={(e) => { setAttendee(e.target.value); setInvite(""); setInviteNonce(null); }} placeholder="0x…" className="mt-2 w-full rounded-xl border border-white/20 bg-transparent p-3" /></label>
      <button className={buttonClass} disabled={busy || !isAddress(attendee)} onClick={() => void signInvitation()}>Sign invitation</button>
      {invite && <><textarea readOnly value={invite} aria-label="Invitation link" className="w-full rounded-xl bg-black/20 p-3" />{inviteNonce !== null && button("Revoke this invitation", "revokeInvitation", [id, getAddress(attendee), inviteNonce])}</>}
    </div>}
    {organizer && data && <div className="space-y-3">
      <h4>Attendees · page {page + 1}</h4>
      {data.rows.length === 0 && <p>No attendees on this page.</p>}
      {data.rows.map((row) => <div key={row.address} className="space-y-2 rounded-xl border border-white/10 p-3">
        <p className="break-all font-mono">{row.address}</p><p>{statusLabels[row.reservation.status]}</p>
        <div className="flex flex-wrap gap-2">
          {settlement && [1, 8].includes(row.reservation.status) && button(`Confirm attendance ${row.address.slice(-4)}`, "confirmAttendance", [id, row.address])}
          {settlement && now >= Number(event?.eventEnd) && [1, 8].includes(row.reservation.status) && button(`Settle no-show ${row.address.slice(-4)}`, "settleNoShow", [id, row.address])}
          {event && !event.cancelled && row.reservation.status === 7 && now > Number(row.reservation.paymentDeadline) && button(`Mark payment default ${row.address.slice(-4)}`, "markPaymentDefault", [id, row.address])}
        </div>
      </div>)}
      <button className={buttonClass} disabled={busy || page === 0} onClick={() => { setData(null); setPage(page - 1); }}>Previous</button>{" "}
      <button className={buttonClass} disabled={busy || data.rows.length < 20} onClick={() => { setData(null); setPage(page + 1); }}>Next</button>
    </div>}
    {confirmation && <div className="rounded-xl border border-amber-300/30 p-4 space-y-3">
      <p>{confirmation.label} · {IS_MAINNET ? "Real USDC" : "Test USDC"} on {ARC_NETWORK_LABEL}</p>
      <p>Payment: {formatUnits(confirmation.amount, 6)} USDC, plus network fees.</p>
      {confirmation.args.length > 1 && <p className="break-all">Target: {String(confirmation.args[1])}</p>}
      <button className={buttonClass} disabled={busy} onClick={() => void execute()}>Confirm in wallet</button>{" "}
      <button className={buttonClass} onClick={() => setConfirmation(null)}>Back</button>
    </div>}
    {message && <p role="status">{message}</p>}
    {error && <p role="alert" className="break-words text-red-300">{error}</p>}
    {hash && <a className="block text-[#9bddff] underline" href={explorerTxUrl(hash)} target="_blank" rel="noreferrer">View transaction on explorer</a>}
  </section>;
}
