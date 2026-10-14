import Link from "next/link";

import { ARC_NETWORK_LABEL, IS_MAINNET } from "@/lib/showup-network";
import { WALLET_TOOL_ROUTES } from "@/lib/site-nav";

/** Shared footer. Secondary links (including the infrastructure overview) live here, not in the main header. */
export default function SiteFooter({ note }: { note?: string }) {
  const links = [
    { href: "/#how-it-works", label: "How it works" },
    { href: "/events", label: "Explore events" },
    { href: "/create", label: "Create an event" },
    ...(IS_MAINNET ? [{ href: WALLET_TOOL_ROUTES.addFunds, label: "Add funds" }] : [{ href: "/wallet-tools", label: "Wallet tools" }]),
    { href: "/#infrastructure", label: "About & infrastructure" },
  ];
  return (
    <footer className="border-t border-[#79b7ff]/12">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 py-8 text-sm text-white/38 lg:flex-row lg:items-center lg:justify-between lg:px-10">
        <p>ShowUp. Programmable commitment on {ARC_NETWORK_LABEL}.</p>
        <nav aria-label="Footer" className="flex flex-wrap gap-x-5 gap-y-2">
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="transition hover:text-[#8fd8ff]">
              {link.label}
            </Link>
          ))}
        </nav>
        {note ? <p>{note}</p> : null}
      </div>
    </footer>
  );
}
