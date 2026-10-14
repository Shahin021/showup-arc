"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

import CircleWalletButton from "@/components/circle-wallet-button";
import PendingTransactionNotice from "@/components/pending-transaction-notice";
import { ARC_NETWORK_LABEL, IS_MAINNET } from "@/lib/showup-network";
import { fundingAction, isActivePath, primaryNavItems } from "@/lib/site-nav";

const NAV_ITEMS = primaryNavItems();
const FUNDING = fundingAction();

const linkBase = "rounded-full px-3 py-2 text-sm transition";
const linkIdle = "text-white/60 hover:text-[#8fd8ff]";
const linkActive = "bg-[#73d8ff]/10 font-medium text-[#9bddff]";

const pillBase =
  "items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition";
const pillIdle = "border-[#73d8ff]/25 bg-[#73d8ff]/10 text-[#9bddff] hover:bg-[#73d8ff]/15";
const pillActive = "border-[#73d8ff]/60 bg-[#73d8ff]/20 text-white";

export default function ShowUpHeader() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPath, setMenuPath] = useState(pathname);
  const menuId = useId();
  const menuRef = useRef<HTMLDivElement>(null);
  const fundingActive = isActivePath(pathname, FUNDING.activePrefixes);

  // Close the mobile menu after navigation (including Back/Forward).
  if (menuPath !== pathname) {
    setMenuPath(pathname);
    setMenuOpen(false);
  }

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [menuOpen]);

  const fundingLink = (className: string) =>
    FUNDING.external ? (
      <a href={FUNDING.href} target="_blank" rel="noreferrer" onClick={() => setMenuOpen(false)} className={className}>
        {FUNDING.label}
      </a>
    ) : (
      // Closes the menu even when the user is already on Add Funds (the pathname does not change then).
      <Link href={FUNDING.href} aria-current={fundingActive ? "page" : undefined} onClick={() => setMenuOpen(false)} className={className}>
        {FUNDING.label}
      </Link>
    );

  return (
    <header className="sticky top-0 z-[100] overflow-visible border-b border-[#73baff]/15 bg-[#050817]/85 backdrop-blur-xl">
      {IS_MAINNET ? (
        <div className="border-b border-amber-300/20 bg-amber-300/10 px-6 py-2 text-center text-xs font-medium text-amber-100">
          Arc mainnet: transactions move real USDC and cannot be undone. Only reserve what you are willing to lock.
        </div>
      ) : (
        <div className="border-b border-[#73d8ff]/15 bg-[#73d8ff]/5 px-6 py-2 text-center text-xs font-medium text-[#9bddff]">
          {ARC_NETWORK_LABEL}: test USDC only, no real value.
        </div>
      )}
      <PendingTransactionNotice />
      <div ref={menuRef} className="relative">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-4 sm:px-6 lg:px-10 lg:py-5">
          <Link href="/" className="flex shrink-0 items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-[#73d8ff] to-[#9285ff] text-lg font-black text-[#050817] shadow-lg shadow-[#4b9cff]/20">S</div>
            <div className="hidden sm:block">
              <p className="text-lg font-semibold tracking-tight">ShowUp</p>
              <p className="text-xs text-white/45">Programmable commitment on Arc</p>
            </div>
          </Link>

          <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = isActivePath(pathname, item.activePrefixes);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`${linkBase} whitespace-nowrap ${active ? linkActive : linkIdle}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            {!IS_MAINNET && fundingLink(`hidden whitespace-nowrap lg:inline-flex ${pillBase} ${fundingActive ? pillActive : pillIdle}`)}
            <CircleWalletButton />
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white transition hover:border-[#73d8ff]/60 lg:hidden"
              aria-expanded={menuOpen}
              aria-controls={menuId}
              aria-label={menuOpen ? "Close menu" : "Open menu"}
              onClick={() => setMenuOpen((open) => !open)}
            >
              <svg viewBox="0 0 20 20" fill="none" aria-hidden="true" className="h-5 w-5">
                {menuOpen ? (
                  <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                ) : (
                  <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                )}
              </svg>
            </button>
          </div>
        </div>

        {menuOpen ? (
          <nav
            id={menuId}
            aria-label="Main"
            className="absolute inset-x-0 top-full border-b border-[#73baff]/15 bg-[#050817] px-4 pb-5 pt-2 shadow-2xl shadow-black/60 sm:px-6 lg:hidden"
          >
            <ul className="mx-auto grid max-w-7xl gap-1">
              {NAV_ITEMS.map((item) => {
                const active = isActivePath(pathname, item.activePrefixes);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                      className={`block rounded-2xl px-4 py-3 text-base transition ${
                        active ? "bg-[#73d8ff]/10 font-medium text-[#9bddff]" : "text-white/75 hover:bg-white/5"
                      }`}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
              {!IS_MAINNET && <li className="pt-2">
                {fundingLink(`flex justify-center ${pillBase} py-3 text-base ${fundingActive ? pillActive : pillIdle}`)}
              </li>}
            </ul>
          </nav>
        ) : null}
      </div>
    </header>
  );
}
