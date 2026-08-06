"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type WalletRecoveryMode = "backup" | "restore";

type WalletRecoveryDialogProps = {
  open: boolean;
  mode: WalletRecoveryMode;
  userId?: string;
  onClose: () => void;
  onRestore: (userId: string) => void | Promise<void>;
};

type CreateRecoveryResponse = {
  recoveryCode?: string;
  error?: string;
};

type RestoreRecoveryResponse = {
  userId?: string;
  createdAt?: string;
  error?: string;
};

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Something went wrong. Please try again.";
}

function copyWithFallback(text: string) {
  const textarea = document.createElement("textarea");

  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  document.execCommand("copy");
  document.body.removeChild(textarea);
}

export default function WalletRecoveryDialog({
  open,
  mode,
  userId,
  onClose,
  onRestore,
}: WalletRecoveryDialogProps) {
  const [recoveryCode, setRecoveryCode] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isWorking) {
        onClose();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isWorking, onClose]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setRecoveryCode("");
      setRecoveryInput("");
      setStatusMessage("");
      setErrorMessage("");
      setCopied(false);

      if (!open) {
        setIsWorking(false);
        return;
      }

      if (mode === "backup") {
        void createRecoveryCode();
      }
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mode, userId]);

  async function createRecoveryCode() {
    if (!userId) {
      setErrorMessage(
        "Circle wallet information is missing. Reconnect the wallet and try again.",
      );
      return;
    }

    try {
      setIsWorking(true);
      setErrorMessage("");
      setStatusMessage("Creating your encrypted recovery code...");

      const response = await fetch(
        "/api/circle/recovery/create",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            userId,
          }),
        },
      );

      const data =
        (await response.json()) as CreateRecoveryResponse;

      if (!response.ok || !data.recoveryCode) {
        throw new Error(
          data.error ?? "Unable to create the recovery code.",
        );
      }

      setRecoveryCode(data.recoveryCode);
      setStatusMessage("");
    } catch (error) {
      console.error(
        "ShowUp recovery code creation failed:",
        error,
      );

      setStatusMessage("");
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsWorking(false);
    }
  }

  async function handleCopy() {
    if (!recoveryCode) {
      return;
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(recoveryCode);
      } else {
        copyWithFallback(recoveryCode);
      }

      setCopied(true);

      window.setTimeout(() => {
        setCopied(false);
      }, 1800);
    } catch (error) {
      console.error("Unable to copy recovery code:", error);

      copyWithFallback(recoveryCode);
      setCopied(true);
    }
  }

  function handleDownload() {
    if (!recoveryCode) {
      return;
    }

    const fileContents = [
      "SHOWUP WALLET RECOVERY CODE",
      "",
      recoveryCode,
      "",
      "Keep this code private and store it somewhere safe.",
      "This code restores the connection to your Circle wallet.",
      "It does not replace your Circle PIN or security answers.",
    ].join("\n");

    const blob = new Blob([fileContents], {
      type: "text/plain;charset=utf-8",
    });

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = "showup-wallet-recovery-code.txt";

    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    URL.revokeObjectURL(url);
  }

  async function handleRestore() {
    const normalizedCode = recoveryInput.trim();

    if (!normalizedCode) {
      setErrorMessage("Enter your ShowUp recovery code.");
      return;
    }

    try {
      setIsWorking(true);
      setErrorMessage("");
      setStatusMessage("Checking your recovery code...");

      const response = await fetch(
        "/api/circle/recovery/restore",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify({
            recoveryCode: normalizedCode,
          }),
        },
      );

      const data =
        (await response.json()) as RestoreRecoveryResponse;

      if (!response.ok || !data.userId) {
        throw new Error(
          data.error ??
            "The recovery code could not be verified.",
        );
      }

      setStatusMessage(
        "Recovery code accepted. Restoring your Circle wallet...",
      );

      await onRestore(data.userId);

      setStatusMessage("");
      onClose();
    } catch (error) {
      console.error("ShowUp wallet restoration failed:", error);

      setStatusMessage("");
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsWorking(false);
    }
  }

  if (!open || typeof document === "undefined") {
    return null;
  }

  const isBackupMode = mode === "backup";

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] bg-black/80 backdrop-blur-md"
      onMouseDown={(event) => {
        if (
          event.target === event.currentTarget &&
          !isWorking
        ) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-recovery-title"
        className="absolute left-1/2 top-1/2 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-[28px] border border-[#79b7ff]/16 bg-[#0a1025] shadow-2xl shadow-[#267cff]/20"
      >
        <div className="sticky top-0 z-10 flex items-start justify-between gap-5 border-b border-[#79b7ff]/12 bg-[#0a1025]/95 px-6 py-5 backdrop-blur-xl">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-[#73d8ff]">
              ShowUp wallet recovery
            </p>

            <h2
              id="wallet-recovery-title"
              className="mt-2 text-2xl font-semibold text-white"
            >
              {isBackupMode
                ? "Back up your wallet"
                : "Restore your wallet"}
            </h2>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={isWorking}
            aria-label="Close recovery dialog"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/[0.04] text-xl text-white/55 transition hover:bg-white/[0.08] hover:text-white disabled:cursor-wait disabled:opacity-50"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          {isBackupMode ? (
            <>
              <p className="text-sm leading-6 text-white/60">
                Save this encrypted code somewhere private. You
                can use it to reconnect the same Circle wallet on
                another browser or device.
              </p>

              <div className="mt-5">
                <label
                  htmlFor="showup-recovery-code"
                  className="text-sm font-medium text-white/80"
                >
                  Recovery code
                </label>

                <textarea
                  id="showup-recovery-code"
                  readOnly
                  value={recoveryCode}
                  placeholder={
                    isWorking
                      ? "Creating recovery code..."
                      : "Recovery code unavailable"
                  }
                  className="mt-2 min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-[#0d142b] p-4 font-mono text-xs leading-6 text-[#b8e8ff] outline-none"
                />
              </div>

              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    void handleCopy();
                  }}
                  disabled={!recoveryCode || isWorking}
                  className="rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3 text-sm font-medium text-white transition hover:bg-white/[0.08] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {copied ? "Copied" : "Copy code"}
                </button>

                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!recoveryCode || isWorking}
                  className="rounded-2xl bg-[#73d8ff] px-4 py-3 text-sm font-semibold text-[#050817] transition hover:bg-[#8195ff] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Download code
                </button>
              </div>

              {errorMessage && (
                <button
                  type="button"
                  onClick={() => {
                    void createRecoveryCode();
                  }}
                  disabled={isWorking}
                  className="mt-4 w-full rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm text-red-200 transition hover:bg-red-400/15 disabled:opacity-50"
                >
                  Try creating the code again
                </button>
              )}

              <div className="mt-5 rounded-2xl border border-amber-300/15 bg-amber-300/[0.07] p-4">
                <p className="text-sm font-medium text-amber-100">
                  Keep it private
                </p>

                <p className="mt-2 text-xs leading-5 text-amber-100/65">
                  Anyone with this code can attempt to reconnect
                  your ShowUp wallet. It does not reveal your
                  private key and it does not replace your Circle
                  PIN or security answers.
                </p>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm leading-6 text-white/60">
                Paste the ShowUp recovery code you previously
                saved. After verification, ShowUp will reconnect
                the Circle wallet associated with it.
              </p>

              <div className="mt-5">
                <label
                  htmlFor="showup-recovery-input"
                  className="text-sm font-medium text-white/80"
                >
                  Recovery code
                </label>

                <textarea
                  id="showup-recovery-input"
                  value={recoveryInput}
                  onChange={(event) => {
                    setRecoveryInput(event.target.value);
                    setErrorMessage("");
                  }}
                  disabled={isWorking}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="SUP1..."
                  className="mt-2 min-h-36 w-full resize-none rounded-2xl border border-white/10 bg-[#0d142b] p-4 font-mono text-xs leading-6 text-white outline-none transition focus:border-[#73d8ff]/50 disabled:opacity-60"
                />
              </div>

              <button
                type="button"
                onClick={() => {
                  void handleRestore();
                }}
                disabled={!recoveryInput.trim() || isWorking}
                className="mt-4 w-full rounded-2xl bg-[#73d8ff] px-4 py-3.5 text-sm font-semibold text-[#050817] transition hover:bg-[#8195ff] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isWorking
                  ? "Restoring wallet..."
                  : "Restore wallet"}
              </button>

              <p className="mt-4 text-xs leading-5 text-white/40">
                Your Circle PIN may still be required when you
                approve wallet actions or transactions.
              </p>
            </>
          )}

          {statusMessage && (
            <p
              aria-live="polite"
              className="mt-4 rounded-2xl border border-[#73d8ff]/15 bg-[#73d8ff]/10 px-4 py-3 text-sm leading-6 text-[#b8e8ff]"
            >
              {statusMessage}
            </p>
          )}

          {errorMessage && (
            <p
              aria-live="assertive"
              className="mt-4 rounded-2xl border border-red-400/20 bg-red-400/10 px-4 py-3 text-sm leading-6 text-red-200"
            >
              {errorMessage}
            </p>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}