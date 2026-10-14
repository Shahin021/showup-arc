"use client";

import type { ReactNode } from "react";

export function Panel({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-6 rounded-[28px] border border-[#79b7ff]/18 bg-[#0b1025]/85 p-6 shadow-2xl shadow-black/40 backdrop-blur-xl">
      <h2 className="text-xl font-semibold tracking-[-0.02em] text-white">{title}</h2>
      {subtitle ? <p className="mt-2 text-sm leading-6 text-white/50">{subtitle}</p> : null}
      <div className="mt-5">{children}</div>
    </section>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs uppercase tracking-wide text-white/45">{label}</span>
      <div className="mt-2">{children}</div>
    </label>
  );
}

export const inputClass =
  "w-full rounded-2xl border border-[#79b7ff]/18 bg-[#070c1d] px-4 py-3 text-white outline-none transition placeholder:text-white/25 focus:border-[#73d8ff]/60 disabled:opacity-50";

export function Choice<T extends string>({
  value,
  options,
  onChange,
  disabled,
  columns = "responsive",
}: {
  value: T;
  options: { value: T; label: string; hint?: string }[];
  onChange: (value: T) => void;
  disabled?: boolean;
  /** "responsive": stacked on phones; 2 or 3: always in one row (for short labels). */
  columns?: "responsive" | 2 | 3;
}) {
  const grid = columns === 3 ? "grid-cols-3" : columns === 2 ? "grid-cols-2" : "sm:grid-cols-2";
  return (
    <div className={`grid gap-2 ${grid}`} role="radiogroup">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`rounded-2xl border px-4 py-3 text-left text-sm transition disabled:opacity-50 ${
              selected
                ? "border-[#73d8ff]/60 bg-[#73d8ff]/10 text-white"
                : "border-[#79b7ff]/14 bg-[#070c1d] text-white/65 hover:border-[#79b7ff]/35"
            }`}
          >
            <span className="font-semibold">{option.label}</span>
            {option.hint ? <span className="mt-1 block text-xs leading-5 text-white/45">{option.hint}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

export function SummaryRow({ label, value, strong }: { label: string; value: ReactNode; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <span className="text-white/50">{label}</span>
      <span className={`text-right ${strong ? "font-semibold text-white" : "text-white/80"}`}>{value}</span>
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded-2xl bg-gradient-to-r from-[#3d8bff] to-[#5fd0ff] px-5 py-3 text-sm font-semibold text-[#03101f] shadow-lg shadow-[#3d8bff]/20 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-2xl border border-[#73d8ff]/25 bg-[#73d8ff]/10 px-4 py-2 text-sm font-semibold text-[#9bddff] transition hover:bg-[#73d8ff]/15 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  );
}

export function Notice({ tone, children }: { tone: "info" | "warn" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-[#79b7ff]/20 bg-[#418cff]/10 text-[#cfe6ff]",
    warn: "border-amber-300/30 bg-amber-300/10 text-amber-100",
    error: "border-red-400/30 bg-red-400/10 text-red-100",
    success: "border-emerald-300/30 bg-emerald-300/10 text-emerald-100",
  }[tone];
  return <div className={`mt-4 rounded-2xl border p-4 text-sm leading-6 ${styles}`}>{children}</div>;
}

export function TxLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="font-mono text-xs text-[#9bddff] hover:underline">
      {label}
    </a>
  );
}

export function shortHash(hash: string) {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) {
    const short = (error as { shortMessage?: unknown }).shortMessage;
    return typeof short === "string" && short ? short : error.message;
  }
  return "Something went wrong.";
}
