"use client";

import { useEffect, useMemo, useState } from "react";
import {
  SIGNATURE_TYPES,
  addressFromPrivateKey,
  clearStoredWallet,
  loadStoredWalletMeta,
  saveWallet,
  unlockWallet,
  type SignatureTypeValue,
  type StoredWalletMeta,
} from "@/lib/realMoney/wallet";
import { checkConnection, type WalletConnection } from "@/lib/realMoney/clob";
import { CloseIcon, LockIcon, WalletIcon } from "./icons";

// Everything in this sheet runs client-side only. The private key the user types in is encrypted
// (lib/realMoney/crypto.ts) and stored in this browser's own localStorage; the decrypted key this
// sheet hands back via `onWalletReady` lives only in the Lab page's own React state for the rest
// of that session (cleared on Lock, Disconnect, or a page reload) — it is never sent to this app's
// server, never logged, and never leaves the browser except to sign a request directly to
// clob.polymarket.com.
export default function RealWalletSheet({
  unlockedWallet,
  onClose,
  onWalletReady,
  onLocked,
  onDisconnected,
}: {
  // The Lab page's own current in-memory wallet, if any — passed back in so reopening this sheet
  // while already unlocked (e.g. to check the balance or disconnect) skips straight past the
  // passphrase prompt instead of asking again for no reason.
  unlockedWallet: WalletConnection | null;
  onClose: () => void;
  onWalletReady: (wallet: WalletConnection, meta: StoredWalletMeta) => void;
  onLocked: () => void;
  onDisconnected: () => void;
}) {
  const [stored, setStored] = useState<StoredWalletMeta | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    /* eslint-disable-next-line react-hooks/set-state-in-effect -- reading localStorage, unavailable during SSR */
    setStored(loadStoredWalletMeta());
    setChecked(true);
  }, []);

  if (!checked) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div
        className="sheet-up relative flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
        style={{ background: "var(--lab-bg-2)", border: "1px solid var(--lab-border)" }}
      >
        <div className="shrink-0 px-5 pb-3.5 pt-4" style={{ borderBottom: "1px solid var(--lab-border)" }}>
          <div className="mx-auto mb-3 h-1 w-9 rounded-full sm:hidden" style={{ background: "var(--lab-border)" }} />
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <div
                className="flex h-8 w-8 items-center justify-center rounded-xl"
                style={{ background: "var(--lab-surface-2)", color: "var(--lab-gold)" }}
              >
                <WalletIcon className="h-4 w-4" />
              </div>
              <p className="font-display text-[15px] font-bold text-text">Polymarket wallet</p>
            </div>
            <button onClick={onClose} className="press text-text-faint">
              <CloseIcon className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-4">
          {stored ? (
            <UnlockOrManage
              meta={stored}
              initialUnlocked={unlockedWallet}
              onWalletReady={onWalletReady}
              onLocked={onLocked}
              onDisconnected={() => {
                clearStoredWallet();
                setStored(null);
                onDisconnected();
              }}
            />
          ) : (
            <ConnectForm
              onConnected={(wallet, meta) => {
                setStored(meta);
                onWalletReady(wallet, meta);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function RiskNotice() {
  return (
    <div
      className="mb-4 space-y-1.5 rounded-2xl p-3.5 text-[11px] leading-relaxed"
      style={{ background: "rgba(var(--lab-red-rgb), 0.1)", color: "var(--lab-red)" }}
    >
      <p className="font-semibold">This places real orders with real money on Polymarket.</p>
      <p className="text-text-dim">
        Your private key is encrypted with the passphrase you set below and stored only in this
        browser — it is never sent to our server. If you clear this browser&rsquo;s data or switch
        devices, you&rsquo;ll need to reconnect with the key again. There is no password recovery
        for a lost passphrase; the encrypted key would need to be re-imported instead.
      </p>
    </div>
  );
}

function ConnectForm({
  onConnected,
}: {
  onConnected: (wallet: WalletConnection, meta: StoredWalletMeta) => void;
}) {
  const [privateKeyInput, setPrivateKeyInput] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [signatureType, setSignatureType] = useState<SignatureTypeValue>(0);
  const [funderInput, setFunderInput] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const derivedAddress = useMemo(() => {
    if (!privateKeyInput.trim()) return null;
    try {
      return addressFromPrivateKey(privateKeyInput);
    } catch {
      return null;
    }
  }, [privateKeyInput]);

  const needsFunder = signatureType !== 0;
  const canSubmit =
    derivedAddress !== null &&
    passphrase.length >= 8 &&
    passphrase === confirmPassphrase &&
    (!needsFunder || funderInput.trim().length > 0) &&
    acknowledged &&
    !submitting;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const meta = await saveWallet({
        privateKeyInput,
        passphrase,
        signatureType,
        funder: needsFunder ? funderInput.trim() : undefined,
      });
      // Round-trips through unlockWallet rather than just holding the plaintext key already in
      // hand — a cheap sanity check that what got encrypted actually decrypts back correctly with
      // this exact passphrase, before the user ever walks away thinking they're connected.
      const { privateKey } = await unlockWallet(passphrase);
      onConnected({ privateKey, signatureType: meta.signatureType, funder: meta.funder }, meta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that wallet.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <RiskNotice />

      <Field label="Private key">
        <input
          type="password"
          autoComplete="off"
          spellCheck={false}
          value={privateKeyInput}
          onChange={(e) => setPrivateKeyInput(e.target.value)}
          placeholder="0x..."
          className="lab-input"
        />
        {derivedAddress && (
          <p className="mt-1.5 text-[10px] text-text-faint">
            Address: <span className="tabular-nums text-text-dim">{shortenAddress(derivedAddress)}</span> — confirm
            this matches your Polymarket profile before continuing.
          </p>
        )}
      </Field>

      <Field label="How did you sign up on Polymarket?">
        <div className="grid grid-cols-1 gap-1.5">
          {SIGNATURE_TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setSignatureType(t.value)}
              className="press flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-left"
              style={{
                background: signatureType === t.value ? "rgba(var(--lab-gold-rgb), 0.14)" : "var(--lab-surface-2)",
                boxShadow: signatureType === t.value ? "inset 0 0 0 1px rgba(var(--lab-gold-rgb), 0.4)" : undefined,
              }}
            >
              <span>
                <span className="block text-[12px] font-semibold text-text">{t.label}</span>
                <span className="block text-[10px] text-text-faint">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Field>

      {needsFunder && (
        <Field label="Polymarket profile address">
          <input
            value={funderInput}
            onChange={(e) => setFunderInput(e.target.value)}
            placeholder="0x..."
            spellCheck={false}
            className="lab-input"
          />
          <p className="mt-1.5 text-[10px] text-text-faint">
            Copy this from your Polymarket profile page — it&rsquo;s where your USDC actually sits,
            different from the address above for an email/Safe login.
          </p>
        </Field>
      )}

      <Field label="Encrypt with a passphrase">
        <input
          type="password"
          autoComplete="new-password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="At least 8 characters"
          className="lab-input"
        />
      </Field>

      <Field label="Confirm passphrase">
        <input
          type="password"
          autoComplete="new-password"
          value={confirmPassphrase}
          onChange={(e) => setConfirmPassphrase(e.target.value)}
          className="lab-input"
        />
        {confirmPassphrase.length > 0 && confirmPassphrase !== passphrase && (
          <p className="mt-1.5 text-[10px]" style={{ color: "var(--lab-red)" }}>
            Passphrases don&rsquo;t match.
          </p>
        )}
      </Field>

      <label className="flex items-start gap-2.5 text-[11px] text-text-dim">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(e) => setAcknowledged(e.target.checked)}
          className="mt-0.5 h-4 w-4 shrink-0"
        />
        I understand this places real orders with real USDC, and that losing my passphrase means
        losing access to this connection (not to the funds themselves — those stay on Polymarket,
        recoverable there directly with the same private key).
      </label>

      {error && <p className="text-[11px]" style={{ color: "var(--lab-red)" }}>{error}</p>}

      <button
        type="submit"
        disabled={!canSubmit}
        className="press flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold disabled:opacity-40"
        style={{ background: "var(--lab-gold)", color: "#1a0f05" }}
      >
        <LockIcon className="h-4 w-4" />
        {submitting ? "Connecting..." : "Encrypt & connect"}
      </button>
    </form>
  );
}

function UnlockOrManage({
  meta,
  initialUnlocked,
  onWalletReady,
  onLocked,
  onDisconnected,
}: {
  meta: StoredWalletMeta;
  initialUnlocked: WalletConnection | null;
  onWalletReady: (wallet: WalletConnection, meta: StoredWalletMeta) => void;
  onLocked: () => void;
  onDisconnected: () => void;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [checking, setChecking] = useState(false);
  const [balance, setBalance] = useState<number | null>(null);
  const [unlocked, setUnlocked] = useState<WalletConnection | null>(initialUnlocked);

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { privateKey, meta: unlockedMeta } = await unlockWallet(passphrase);
      const wallet: WalletConnection = { privateKey, signatureType: unlockedMeta.signatureType, funder: unlockedMeta.funder };
      setUnlocked(wallet);
      onWalletReady(wallet, unlockedMeta);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't unlock this wallet.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTestConnection() {
    if (!unlocked) return;
    setChecking(true);
    setBalance(null);
    setError(null);
    try {
      const { usdcBalance } = await checkConnection(unlocked);
      setBalance(usdcBalance);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach Polymarket.");
    } finally {
      setChecking(false);
    }
  }

  const label = SIGNATURE_TYPES.find((t) => t.value === meta.signatureType)?.label ?? "Unknown";

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-2xl p-3.5" style={{ background: "var(--lab-surface-2)" }}>
        <p className="text-[10px] uppercase tracking-wide text-text-faint">Connected wallet</p>
        <p className="tabular-nums text-[13px] font-semibold text-text">{shortenAddress(meta.address)}</p>
        <p className="text-[11px] text-text-faint">{label}</p>
      </div>

      {!unlocked ? (
        <form onSubmit={handleUnlock} className="space-y-3">
          <Field label="Passphrase">
            <input
              type="password"
              autoFocus
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="lab-input"
            />
          </Field>
          {error && <p className="text-[11px]" style={{ color: "var(--lab-red)" }}>{error}</p>}
          <button
            type="submit"
            disabled={submitting || passphrase.length === 0}
            className="press flex w-full items-center justify-center gap-2 rounded-full py-3.5 text-[14px] font-bold disabled:opacity-40"
            style={{ background: "var(--lab-gold)", color: "#1a0f05" }}
          >
            <LockIcon className="h-4 w-4" />
            {submitting ? "Unlocking..." : "Unlock"}
          </button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-[11px] text-text-dim">
            Unlocked for this session — Real mode can place orders until you lock it, close this
            tab, or reload the page.
          </p>
          <button
            onClick={handleTestConnection}
            disabled={checking}
            className="press w-full rounded-full py-3 text-[13px] font-semibold disabled:opacity-40"
            style={{ background: "var(--lab-surface-2)", color: "var(--lab-cyan)" }}
          >
            {checking ? "Checking..." : "Test connection (reads balance, moves nothing)"}
          </button>
          {balance !== null && (
            <p className="text-center text-[12px] text-text-dim">
              Polymarket USDC balance: <span className="font-semibold text-text">${balance.toFixed(2)}</span>
            </p>
          )}
          {error && <p className="text-[11px]" style={{ color: "var(--lab-red)" }}>{error}</p>}
          <button
            onClick={() => {
              setUnlocked(null);
              setPassphrase("");
              setBalance(null);
              onLocked();
            }}
            className="press w-full rounded-full py-2.5 text-[12px] font-semibold"
            style={{ background: "var(--lab-surface-2)", color: "var(--text-dim)" }}
          >
            Lock
          </button>
        </div>
      )}

      <div style={{ borderTop: "1px solid var(--lab-border)" }} className="pt-3">
        {confirmingDisconnect ? (
          <div className="space-y-2">
            <p className="text-[11px] text-text-dim">
              This forgets the encrypted key stored in this browser. Your funds stay exactly where
              they are on Polymarket — you&rsquo;d just need to reconnect with the private key
              again to trade from here.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setConfirmingDisconnect(false)}
                className="press flex-1 rounded-full py-2.5 text-[12px] font-semibold"
                style={{ background: "var(--lab-surface-2)", color: "var(--text-dim)" }}
              >
                Cancel
              </button>
              <button
                onClick={onDisconnected}
                className="press flex-1 rounded-full py-2.5 text-[12px] font-semibold"
                style={{ background: "rgba(var(--lab-red-rgb), 0.16)", color: "var(--lab-red)" }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingDisconnect(true)}
            className="press text-[11px] font-medium text-text-faint hover:text-[var(--lab-red)]"
          >
            Disconnect this wallet
          </button>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-text-faint">{label}</span>
      {children}
    </label>
  );
}

function shortenAddress(address: string): string {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
