"use client";

import Link from "next/link";
import { useState } from "react";
import type { Address } from "viem";

import { FEATURES } from "@/lib/showup-network";
import { WALLET_TOOL_ROUTES } from "@/lib/site-nav";

import { Panel, SecondaryButton } from "./wallet-tools-ui";

/** A link to Arc's hosted purchase flow; no embedded checkout or developer key. */
export default function AddFundsPanel({ owner }: { owner: Address | null }) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    if (!owner) return;
    try {
      await navigator.clipboard.writeText(owner);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Panel
      title="Buy USDC on Arc"
      subtitle="Use Arc Portal to fund your wallet with a debit card, Apple Pay or Google Pay where supported."
    >
      <div className="flex flex-wrap gap-2 text-xs font-medium text-[#9bddff]">
        {["Debit card", "Apple Pay", "Google Pay"].map((method) => (
          <span key={method} className="rounded-full border border-[#73d8ff]/20 bg-[#73d8ff]/10 px-3 py-2">
            {method}
          </span>
        ))}
      </div>

      <ol className="mt-5 list-decimal space-y-3 pl-5 text-sm leading-6 text-white/65">
        <li>Open Arc Portal and connect the same wallet you use for ShowUp.</li>
        <li>Choose Add funds, then select USDC on Arc and an available payment method.</li>
        <li>Review the destination address and fees before paying. Return to ShowUp once the USDC arrives.</li>
      </ol>

      <a
        href="https://portal.arc.io/"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-[#3d8bff] to-[#5fd0ff] px-5 py-3 text-center text-sm font-semibold text-[#03101f] shadow-lg shadow-[#3d8bff]/20 transition hover:brightness-110"
      >
        Continue to Arc Portal <span aria-hidden="true">↗</span>
      </a>
      <p className="mt-2 text-center text-xs leading-5 text-white/45">
        Opens in a new tab. Purchase and identity verification take place in Arc Portal.
      </p>

      {owner ? (
        <div className="mt-6 rounded-2xl border border-[#79b7ff]/14 bg-[#070c1d] p-4">
          <p className="text-xs uppercase tracking-wide text-white/45">Your ShowUp wallet</p>
          <p className="mt-2 break-all font-mono text-sm text-white">{owner}</p>
          <div className="mt-3">
            <SecondaryButton onClick={copyAddress}>{copied ? "Copied" : "Copy address"}</SecondaryButton>
          </div>
          <p className="mt-3 text-xs leading-5 text-white/45">
            Select this account in Arc Portal and check that the destination matches. Your address is not filled in automatically.
          </p>
        </div>
      ) : (
        <p className="mt-5 text-sm leading-6 text-white/50">
          Use the same wallet in Arc Portal and ShowUp. The wallet button at the top connects it to ShowUp.
        </p>
      )}

      <p className="mt-5 text-xs leading-5 text-white/45">
        Payment methods and availability depend on your country and the provider. Credit cards are not supported by Arc Portal.
        Keep a little USDC for Arc network fees.
      </p>

      {FEATURES.mainnetBridge ? (
        <p className="mt-5 border-t border-white/10 pt-4 text-sm leading-6 text-white/50">
          Already have USDC on Ethereum or Base?{" "}
          <Link href={WALLET_TOOL_ROUTES.bridge} className="font-medium text-[#9bddff] hover:underline">
            Bridge it to Arc.
          </Link>
        </p>
      ) : null}
    </Panel>
  );
}
