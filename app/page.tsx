"use client";

import { useEffect, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { StrKey } from "@stellar/stellar-sdk";
import { QRCodeSVG } from "qrcode.react";
import ThemeToggle from "@/src/components/ThemeToggle";

type WalletData = {
  success: boolean;
  publicKey?: string;
  balance?: string;
  error?: string;
};

type Payment = {
  from: string;
  to: string;
  amount: string;
  assetType: string;
};

type Transaction = {
  hash: string;
  ledger: number;
  createdAt: string;
  successful: boolean;
  feeCharged: string;
  payments: Payment[];
};

type TransactionData = {
  success: boolean;
  transactions?: Transaction[];
  error?: string;
};

type ChartRange = "24h" | "Week" | "Month" | "Year";
type Period = "all" | "7d" | "30d";

const CH = 180; // chart viewBox height
const CW = 600; // chart viewBox width

// Captured once at module load so render stays pure (the React compiler
// forbids reading the clock during render).
const SESSION_START = Date.now();

const IconGrid = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="3" width="7" height="7" rx="2" />
    <rect x="14" y="14" width="7" height="7" rx="2" />
    <rect x="3" y="14" width="7" height="7" rx="2" />
  </svg>
);

const IconSend = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="7" y1="17" x2="17" y2="7" />
    <polyline points="7 7 17 7 17 17" />
  </svg>
);

const IconReceive = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="17" y1="7" x2="7" y2="17" />
    <polyline points="17 17 7 17 7 7" />
  </svg>
);

const IconActivity = (
  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="20" x2="18" y2="11" />
    <line x1="12" y1="20" x2="12" y2="4" />
    <line x1="6" y1="20" x2="6" y2="14" />
  </svg>
);

const IconExternal = (
  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const renderRefreshIcon = (spinning: boolean) => (
  <svg className={`h-4 w-4 ${spinning ? "animate-spin" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

function shortenAddress(address: string, size = 4) {
  if (!address || address.length <= size * 2 + 3) return address || "";
  return `${address.slice(0, size)}…${address.slice(-size)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatAmount(value: number, digits = 2, maxDigits?: number) {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: maxDigits ?? digits,
  });
}

function formatYAxis(value: number) {
  if (value >= 1_000_000) {
    return (value / 1_000_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "M";
  }
  if (value >= 10_000) {
    return (value / 1_000).toLocaleString(undefined, { maximumFractionDigits: 1 }) + "k";
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function paymentTotal(tx: Transaction) {
  return tx.payments.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
}

function buildSeries(transactions: Transaction[], range: ChartRange) {
  if (range === "Year") {
    // Build 12 monthly buckets starting 11 months ago (first of each month)
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setDate(1);
      d.setHours(0, 0, 0, 0);
      d.setMonth(d.getMonth() - (11 - i));
      return {
        label: d.toLocaleDateString(undefined, { month: "short" }),
        start: d.getTime(),
        value: 0,
      };
    });

    for (const tx of transactions) {
      const t = new Date(tx.createdAt).getTime();
      // Find the latest bucket whose start <= tx time
      let placed = false;
      for (let i = buckets.length - 1; i >= 0; i--) {
        if (t >= buckets[i].start) {
          buckets[i].value += paymentTotal(tx);
          placed = true;
          break;
        }
      }
      // If the tx predates all buckets, roll it into the oldest bucket
      // so that accounts with old transactions still show activity
      if (!placed) {
        buckets[0].value += paymentTotal(tx);
      }
    }
    return buckets;
  }

  const now = Date.now();
  const cfg =
    range === "24h"
      ? { count: 8, step: 3 * 3600_000, label: (d: Date) => d.toLocaleTimeString(undefined, { hour: "2-digit" }) }
      : range === "Week"
        ? { count: 7, step: 24 * 3600_000, label: (d: Date) => d.toLocaleDateString(undefined, { weekday: "short" }) }
        : { count: 10, step: 3 * 24 * 3600_000, label: (d: Date) => d.toLocaleDateString(undefined, { day: "numeric" }) };

  const buckets = Array.from({ length: cfg.count }, (_, i) => {
    const d = new Date(now - (cfg.count - 1 - i) * cfg.step);
    return { label: cfg.label(d), start: now - (cfg.count - i) * cfg.step, value: 0 };
  });

  for (const tx of transactions) {
    const t = new Date(tx.createdAt).getTime();
    let placed = false;
    for (let i = buckets.length - 1; i >= 0; i--) {
      if (t >= buckets[i].start) {
        buckets[i].value += paymentTotal(tx);
        placed = true;
        break;
      }
    }
    // Roll pre-window transactions into the oldest visible bucket
    if (!placed) {
      buckets[0].value += paymentTotal(tx);
    }
  }
  return buckets;
}

function smoothPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";
  if (points.length < 3) {
    return points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
  }
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2 < points.length ? i + 2 : i + 1];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export default function Home() {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [copiedTxHash, setCopiedTxHash] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"send" | "receive">("send");
  const [formOpen, setFormOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [hideBalance, setHideBalance] = useState(false);

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [receiveAmount, setReceiveAmount] = useState("");
  const [sending, setSending] = useState(false);

  const [message, setMessage] = useState("");
  const [transactionHash, setTransactionHash] = useState("");

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);
  const [transactionsError, setTransactionsError] = useState("");

  const [fee, setFee] = useState<number | null>(null);
  const [network, setNetwork] = useState<{
    ledger: number | null;
    baseReserve: number | null;
    minimumBalance: number | null;
  }>({ ledger: null, baseReserve: null, minimumBalance: null });
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null);

  const [query, setQuery] = useState("");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [chartRange, setChartRange] = useState<ChartRange>("Year");
  const [period, setPeriod] = useState<Period>("all");
  const [periodCutoff, setPeriodCutoff] = useState(0);

  async function copyAddress() {
    if (!wallet?.publicKey) return;
    try {
      await navigator.clipboard.writeText(wallet.publicKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error("Failed to copy address:", error);
    }
  }

  async function copyToClipboard(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedTxHash(id);
      setTimeout(() => setCopiedTxHash(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  }

  async function loadBalance() {
    try {
      const response = await fetch(`/api/stellar/balance?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Failed to load balance");
      const data: WalletData = await response.json();
      setWallet(data);
    } catch (error) {
      console.error("Failed to load balance:", error);
      setWallet((current) => (current ? { ...current, error: "Failed to load balance" } : current));
    } finally {
      setLoading(false);
    }
  }

  async function loadTransactions() {
    try {
      setTransactionsLoading(true);
      setTransactionsError("");
      const response = await fetch("/api/stellar/transactions");
      const data: TransactionData = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Failed to load transactions");
      }
      setTransactions(data.transactions ?? []);
    } catch (error) {
      console.error("Transaction history error:", error);
      setTransactions([]);
      setTransactionsError(error instanceof Error ? error.message : "Failed to load transactions");
    } finally {
      setTransactionsLoading(false);
    }
  }

  async function loadFee() {
    try {
      const response = await fetch("/api/stellar/fee");
      const data = await response.json();
      if (data.success) setFee(Number(data.baseFee));
    } catch (error) {
      console.error("Failed to load Stellar fee:", error);
    }
  }

  async function loadNetwork() {
    try {
      const response = await fetch("/api/stellar");
      const data = await response.json();
      if (!data.success) return;
      setNetwork({
        ledger: typeof data.ledger === "number" ? data.ledger : null,
        baseReserve: Number.isFinite(Number(data.baseReserve)) ? Number(data.baseReserve) : null,
        minimumBalance: Number.isFinite(Number(data.minimumBalance))
          ? Number(data.minimumBalance)
          : null,
      });
    } catch (error) {
      console.error("Failed to load network info:", error);
    }
  }

  async function fetchBalance(): Promise<string | null> {
    try {
      const response = await fetch(`/api/stellar/balance?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) return null;
      const data: WalletData = await response.json();
      return data.success && data.balance ? data.balance : null;
    } catch (error) {
      console.error("Balance sync error:", error);
      return null;
    }
  }

  // Horizon can lag behind a submit, so poll until the reported balance reflects
  // the send. The optimistic value is kept if the network never catches up.
  async function reconcileBalance(previousBalance: number, expectedBalance: number) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await sleep(1500);
      const fetched = await fetchBalance();
      if (fetched === null) continue;

      const next = Number(fetched);
      if (!Number.isFinite(next)) continue;

      const movedFromPrevious = Math.abs(next - previousBalance) > 1e-7;
      const reflectsSend = next <= expectedBalance + 1e-7;
      if (movedFromPrevious || reflectsSend) {
        setWallet((current) => (current ? { ...current, balance: fetched } : current));
        break;
      }
    }

    await Promise.all([loadTransactions(), loadFee(), loadNetwork()]);
  }

  function setMaxAmount() {
    const balance = Number(wallet?.balance ?? 0);
    if (!Number.isFinite(balance) || balance <= 0) {
      setMessage("Wallet balance is unavailable.");
      return;
    }
    const feeAmount = fee !== null ? fee / 10_000_000 : 0.00001;
    const maxAmount = balance - feeAmount;
    if (maxAmount <= 0) {
      setMessage("Not enough XLM available after reserving the network fee.");
      return;
    }
    setAmount(maxAmount.toFixed(7));
    setMessage("");
    setTransactionHash("");
  }

  async function sendXLM() {
    setMessage("");
    setTransactionHash("");

    const trimmedRecipient = recipient.trim();
    if (!trimmedRecipient) return setMessage("Please enter a recipient address.");
    if (!StrKey.isValidEd25519PublicKey(trimmedRecipient)) return setMessage("Invalid Stellar recipient address.");

    const parsedAmount = Number(amount);
    if (!amount || !Number.isFinite(parsedAmount)) return setMessage("Please enter a valid amount.");
    if (parsedAmount <= 0) return setMessage("Amount must be greater than 0 XLM.");

    const balance = Number(wallet?.balance ?? 0);
    if (!Number.isFinite(balance)) return setMessage("Unable to determine wallet balance.");
    if (parsedAmount >= balance) {
      return setMessage("Insufficient balance. Leave some XLM available for the transaction fee.");
    }

    try {
      setSending(true);
      const response = await fetch("/api/stellar/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: trimmedRecipient, amount: parsedAmount.toString() }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error ?? "Failed to send XLM");

      // Reflect the new total immediately; Horizon may not have indexed the
      // transaction yet, so reconcile in the background rather than letting a
      // stale read overwrite the fresh value.
      const previousBalance = Number(wallet?.balance ?? 0);
      const immediateFee = fee !== null ? fee / 10_000_000 : 0;
      const expectedBalance = Math.max(0, previousBalance - parsedAmount - immediateFee);

      setWallet((current) =>
        current?.success && current.balance
          ? { ...current, balance: expectedBalance.toFixed(7) }
          : current
      );

      setMessage(`Successfully sent ${parsedAmount} XLM`);
      setTransactionHash(data.transactionHash);
      setRecipient("");
      setAmount("");

      // Auto-dismiss the success notification after 4 seconds
      setTimeout(() => {
        setMessage("");
        setTransactionHash("");
      }, 4000);

      // After a successful send, refresh the balance so the displayed figure
      // immediately reflects what the Stellar network now holds.
      await loadBalance();
      await reconcileBalance(previousBalance, expectedBalance);
    } catch (error) {
      console.error("Send XLM error:", error);
      setMessage(error instanceof Error ? error.message : "Failed to send XLM");
    } finally {
      setSending(false);
    }
  }

  async function refreshWallet() {
    await Promise.all([loadBalance(), loadTransactions(), loadFee(), loadNetwork()]);
  }

  useEffect(() => {
    loadBalance();
    loadTransactions();
    loadFee();
    loadNetwork();
  }, []);

  // Re-sync with the network when the tab regains focus so the balance stays current.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        loadBalance();
        loadTransactions();
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  useEffect(() => {
    const overlayOpen = Boolean(selectedTransaction) || formOpen || menuOpen;
    if (!overlayOpen) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSelectedTransaction(null);
        setFormOpen(false);
        setMenuOpen(false);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [selectedTransaction, formOpen, menuOpen]);

  const explorerUrl = transactionHash
    ? `https://stellar.expert/explorer/testnet/tx/${transactionHash}`
    : "";
  const accountExplorerUrl = wallet?.publicKey
    ? `https://stellar.expert/explorer/testnet/account/${wallet.publicKey}`
    : "";

  function getPaymentDirection(payment: Payment) {
    if (payment.from === wallet?.publicKey) return "sent";
    if (payment.to === wallet?.publicKey) return "received";
    return "unknown";
  }

  function getPaymentRequestUri() {
    if (!wallet?.publicKey) return "";
    const params = new URLSearchParams();
    if (receiveAmount) params.set("amount", receiveAmount);
    return `web+stellar:pay?destination=${encodeURIComponent(wallet.publicKey)}${
      params.toString() ? `&${params.toString()}` : ""
    }`;
  }

  function openForm(tab: "send" | "receive") {
    setActiveTab(tab);
    setFormOpen(true);
    setMenuOpen(false);
  }

  function scrollToId(id: string) {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setMenuOpen(false);
  }

  // The cutoff is computed when the user picks a period so render stays pure.
  function selectPeriod(next: Period) {
    setPeriod(next);
    setPeriodCutoff(
      next === "7d"
        ? SESSION_START - 7 * 86400000
        : next === "30d"
          ? SESSION_START - 30 * 86400000
          : 0
    );
  }

  const networkFeeFormatted = fee !== null ? (fee / 10_000_000).toFixed(7) : "0.0000100";
  const refreshing = loading || transactionsLoading;
  const balanceNumber = Number(wallet?.balance ?? 0);

  let receivedTotal = 0;
  let sentTotal = 0;
  for (const tx of transactions) {
    for (const payment of tx.payments) {
      const value = Number(payment.amount) || 0;
      if (getPaymentDirection(payment) === "received") receivedTotal += value;
      else sentTotal += value;
    }
  }
  const volume = receivedTotal + sentTotal;
  const receivedPct = volume > 0 ? Math.min(100, (receivedTotal / volume) * 100) : 0;
  const sentPct = volume > 0 ? Math.min(100, (sentTotal / volume) * 100) : 0;

  const series = buildSeries(transactions, chartRange);
  const maxValue = Math.max(...series.map((s) => s.value), 0);
  const hasChartData = maxValue > 0;
  const points = series.map((s, i) => ({
    x: series.length > 1 ? (i / (series.length - 1)) * CW : CW / 2,
    y: CH - (hasChartData ? (s.value / maxValue) * (CH * 0.85) : 0) - CH * 0.075,
  }));
  const linePath = smoothPath(points);
  // Guard: only build areaPath if we have a valid linePath
  const areaPath = linePath ? `${linePath} L ${CW} ${CH} L 0 ${CH} Z` : "";
  const markerIndex = series.reduce((best, s, i) => (s.value > series[best].value ? i : best), 0);
  const activeIndex =
    hoverIndex !== null && hoverIndex >= 0 && hoverIndex < series.length
      ? hoverIndex
      : hasChartData
        ? markerIndex
        : null;
  const yTicks = [0, 1, 2, 3, 4].map((i) => ({
    value: (maxValue * i) / 4,
    y: CH - (i / 4) * (CH * 0.85) - CH * 0.075,
  }));

  const q = query.trim().toLowerCase();
  const filteredTransactions = transactions.filter((tx) => {
    if (periodCutoff && new Date(tx.createdAt).getTime() < periodCutoff) return false;
    if (!q) return true;
    return (
      tx.hash.toLowerCase().includes(q) ||
      tx.payments.some(
        (p) =>
          p.from.toLowerCase().includes(q) ||
          p.to.toLowerCase().includes(q) ||
          p.amount.includes(q)
      )
    );
  });
  const navItems = [
    { key: "dashboard", label: "Dashboard", icon: IconGrid, active: true, onClick: () => scrollToId("dashboard-top") },
    { key: "send", label: "Send", icon: IconSend, active: false, onClick: () => openForm("send") },
    { key: "receive", label: "Receive", icon: IconReceive, active: false, onClick: () => openForm("receive") },
    { key: "activity", label: "Activity", icon: IconActivity, active: false, onClick: () => scrollToId("activity") },
  ];

  const periodLabel = period === "all" ? "All time" : period === "7d" ? "Last 7 days" : "Last 30 days";

  function handleChartPointer(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || series.length === 0) return;

    const last = series.length - 1;
    const ratio = (event.clientX - rect.left) / rect.width;
    const index = last > 0 ? Math.round(ratio * last) : 0;
    setHoverIndex(Math.max(0, Math.min(last, index)));
  }

  return (
    <div className="flex min-h-dvh flex-col bg-panel">
          {/* Top bar */}
          <header className="flex h-16 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6 backdrop-blur-md sticky top-0 z-30" style={{ background: "color-mix(in srgb, var(--panel) 85%, transparent)" }}>
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label="Open navigation"
              className="icon-btn md:hidden"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <line x1="4" y1="7" x2="20" y2="7" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="17" x2="20" y2="17" />
              </svg>
            </button>

            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl border border-border text-fg">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8z" />
                </svg>
              </div>
              <span className="text-[17px] font-medium tracking-tight">Lumio</span>
            </div>

            <div className="ml-2 hidden flex-1 md:flex">
              <div className="relative w-full max-w-md">
                <svg className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search transactions..."
                  aria-label="Search transactions"
                  className="input rounded-full py-2.5 pl-10"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-xl border border-border px-3 py-2 text-xs font-medium text-muted lg:inline-flex">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                  <path d="M13.7 21a2 2 0 0 1-3.4 0" />
                </svg>
                <span className="h-1.5 w-1.5 rounded-full bg-success" />
                Testnet
              </span>

              <ThemeToggle />

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setProfileOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={profileOpen}
                  className="flex items-center gap-2.5 rounded-xl border border-border py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-hover"
                >
                  <span
                    className="grid h-8 w-8 place-items-center rounded-full text-[11px] font-semibold text-white"
                    style={{ background: "linear-gradient(135deg, #6366f1, #22d3ee)" }}
                  >
                    LU
                  </span>
                  <span className="hidden text-left sm:block">
                    <span className="block text-sm font-medium leading-tight">Lumio Wallet</span>
                    <span className="block font-mono text-[11px] leading-tight text-subtle">
                      {wallet?.publicKey ? shortenAddress(wallet.publicKey) : "—"}
                    </span>
                  </span>
                  <svg className="hidden h-4 w-4 text-subtle sm:block" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>

                {profileOpen && (
                  <>
                    <div className="fixed inset-0 z-40" onClick={() => setProfileOpen(false)} />
                    <div className="absolute right-0 top-full z-50 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card p-1" style={{ boxShadow: "var(--shadow)" }}>
                      <div className="px-3 py-2">
                        <p className="text-xs text-subtle">Wallet address</p>
                        <p className="mt-1 break-all font-mono text-[11px] text-muted">
                          {wallet?.publicKey ?? "Unavailable"}
                        </p>
                      </div>
                      <div className="my-1 h-px bg-border" />
                      <button
                        type="button"
                        onClick={() => {
                          copyAddress();
                          setProfileOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
                      >
                        {copied ? "Address copied" : "Copy address"}
                      </button>
                      {accountExplorerUrl && (
                        <a
                          href={accountExplorerUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
                        >
                          View on explorer
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          refreshWallet();
                          setProfileOpen(false);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted transition-colors hover:bg-hover hover:text-fg"
                      >
                        Refresh balances
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </header>

          <div className="flex min-h-0 flex-1">
            {/* Icon rail */}
            <aside className="hidden w-[68px] shrink-0 flex-col items-center gap-2 border-r border-border py-5 md:flex">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  aria-label={item.label}
                  title={item.label}
                  className={item.active ? "rail-btn-active" : "rail-btn"}
                >
                  {item.icon}
                </button>
              ))}
              <div className="mt-auto">
                {accountExplorerUrl && (
                  <a
                    href={accountExplorerUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Open explorer"
                    title="Open explorer"
                    className="rail-btn"
                  >
                    {IconExternal}
                  </a>
                )}
              </div>
            </aside>

            {/* Content */}
            <main className="min-w-0 flex-1 p-4 sm:p-5 lg:p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <h1 id="dashboard-top" className="scroll-mt-6 text-3xl font-normal tracking-tight sm:text-4xl">
                  Dashboard
                </h1>

                <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border bg-card">
                  <div className="p-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted">Received</span>
                      <span className="font-medium tabular-nums">+{formatAmount(receivedTotal)} XLM</span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full bg-fg" style={{ width: `${receivedPct}%` }} />
                    </div>
                  </div>
                  <div className="border-l border-border p-4">
                    <div className="flex items-center justify-between gap-3 text-sm">
                      <span className="text-muted">Sent</span>
                      <span className="font-medium tabular-nums">{formatAmount(sentTotal)} XLM</span>
                    </div>
                    <div className="mt-3 h-1 overflow-hidden rounded-full bg-hover">
                      <div className="h-full rounded-full bg-fg" style={{ width: `${sentPct}%` }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 1: balance + overview */}
              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
                <section className="card flex flex-col xl:col-span-2 overflow-hidden" style={{ background: "var(--card)" }}>
                  <div className="h-1 w-full" style={{ background: "linear-gradient(90deg, #6366f1, #22d3ee, #6366f1)" }} />
                  <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm text-muted">
                        Overall balance
                        <button
                          type="button"
                          onClick={() => setHideBalance((v) => !v)}
                          aria-label={hideBalance ? "Show balance" : "Hide balance"}
                          className="text-subtle transition-colors hover:text-fg"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        </button>
                      </div>

                      {wallet?.success ? (
                        <p className="balance-glow mt-2 text-3xl sm:text-4xl xl:text-5xl font-light tracking-tight tabular-nums min-w-0 break-words">
                          {hideBalance ? "••••••" : formatAmount(balanceNumber, 2, 7)}{" "}
                          <span className="text-xl font-normal text-muted">XLM</span>
                        </p>
                      ) : loading ? (
                        <div className="mt-3 h-9 w-40 animate-pulse rounded-lg bg-hover" />
                      ) : (
                        <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                          <span className="min-w-0 break-words">
                            {wallet?.error ?? "Unable to load balance"}
                          </span>
                          <button
                            type="button"
                            onClick={loadBalance}
                            className="rounded-md border border-danger/30 px-2 py-0.5 text-xs font-medium"
                          >
                            Retry
                          </button>
                        </div>
                      )}
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs text-subtle">Network fee</p>
                      <p className="mt-1 text-sm font-medium tabular-nums">{networkFeeFormatted} XLM</p>
                    </div>
                  </div>

                  <div className="card-inset relative mt-5 flex flex-1 items-center justify-between gap-4 overflow-hidden rounded-xl p-4">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-xs text-muted">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Z" />
                        </svg>
                        Stellar network
                      </p>
                      <p className="mt-5 text-2xl font-normal tabular-nums">
                        {network.minimumBalance !== null
                          ? formatAmount(network.minimumBalance)
                          : "—"}{" "}
                        <span className="text-sm text-muted">XLM reserve</span>
                      </p>
                      <p className="mt-1.5 max-w-[15rem] text-xs text-subtle">
                        Minimum balance held to keep this account active.
                      </p>
                    </div>

                    <div
                      aria-hidden="true"
                      className="relative h-24 w-24 shrink-0 rounded-full"
                      style={{
                        background:
                          "radial-gradient(circle at 32% 28%, #a9c3ff 0%, #6366f1 38%, #1e1b4b 72%, rgba(15,21,38,0) 74%)",
                        boxShadow:
                          "0 0 60px rgba(99,102,241,0.45), inset 0 0 28px rgba(255,255,255,0.22)",
                      }}
                    />
                  </div>
                  </div>
                </section>

                <section className="card flex flex-col p-5 xl:col-span-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="text-lg font-medium">Overview</h2>
                    <div className="flex items-center rounded-full border border-border p-0.5">
                      {(["24h", "Week", "Month", "Year"] as ChartRange[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setChartRange(option)}
                          className={chartRange === option ? "chip-active" : "chip"}
                        >
                          {option}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="mt-6 flex min-h-[220px] flex-1 gap-3">
                    <div className="relative w-14 shrink-0">
                      {yTicks.map((tick, i) => (
                        <span
                          key={i}
                          className="absolute right-0 -translate-y-1/2 text-[11px] tabular-nums text-subtle whitespace-nowrap"
                          style={{ top: `${(tick.y / CH) * 100}%` }}
                        >
                          {formatYAxis(tick.value)}
                        </span>
                      ))}
                    </div>

                    <div
                      className="relative flex-1 cursor-crosshair"
                      onPointerMove={handleChartPointer}
                      onPointerLeave={() => setHoverIndex(null)}
                    >
                      <svg
                        viewBox={`0 0 ${CW} ${CH}`}
                        preserveAspectRatio="none"
                        className="h-full w-full"
                        aria-hidden="true"
                      >
                        <defs>
                          <linearGradient id="lumio-area-gradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                          </linearGradient>
                        </defs>
                        {yTicks.map((tick, i) => (
                          <line
                            key={i}
                            x1="0"
                            y1={tick.y}
                            x2={CW}
                            y2={tick.y}
                            stroke="var(--border)"
                            strokeWidth="1"
                            vectorEffect="non-scaling-stroke"
                          />
                        ))}
                        {areaPath && <path d={areaPath} fill="url(#lumio-area-gradient)" />}
                        {linePath && (
                          <path
                            d={linePath}
                            fill="none"
                            stroke="var(--accent)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                        {activeIndex !== null && (
                          <line
                            x1={points[activeIndex].x}
                            y1={points[activeIndex].y}
                            x2={points[activeIndex].x}
                            y2={CH}
                            stroke="var(--border-strong)"
                            strokeWidth="1"
                            strokeDasharray="4 4"
                            vectorEffect="non-scaling-stroke"
                          />
                        )}
                      </svg>

                      {activeIndex !== null && (
                        <>
                          <span
                            className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-fg"
                            style={{
                              left: `${(points[activeIndex].x / CW) * 100}%`,
                              top: `${(points[activeIndex].y / CH) * 100}%`,
                            }}
                          />
                          <div
                            className={`pointer-events-none absolute z-10 ${
                              points[activeIndex].y / CH < 0.25 ? "translate-y-3" : "-translate-y-[130%]"
                            } ${
                              points[activeIndex].x / CW > 0.82
                                ? "-translate-x-full"
                                : points[activeIndex].x / CW < 0.18
                                  ? "translate-x-0"
                                  : "-translate-x-1/2"
                            }`}
                            style={{
                              left: `${(points[activeIndex].x / CW) * 100}%`,
                              top: `${(points[activeIndex].y / CH) * 100}%`,
                            }}
                          >
                            <div className="card-inset whitespace-nowrap px-3 py-1.5 text-center shadow-lg">
                              <p className="text-sm font-medium tabular-nums">
                                {formatAmount(series[activeIndex].value)} XLM
                              </p>
                              <p className="text-[11px] text-muted">{series[activeIndex].label}</p>
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex pl-[68px]">
                    {series.map((point, i) => (
                      <span
                        key={i}
                        className={`flex-1 text-center text-[11px] text-subtle ${
                          series.length > 8 && i % 2 === 1 ? "hidden sm:block" : ""
                        }`}
                      >
                        {point.label}
                      </span>
                    ))}
                  </div>
                </section>
              </div>

              {/* Row 2: activity + network */}
              <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
                <section id="activity" className="card scroll-mt-6 xl:col-span-3">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <h2 className="text-lg font-medium">Recent activity</h2>
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setPeriodOpen((open) => !open)}
                        aria-haspopup="menu"
                        aria-expanded={periodOpen}
                        className="btn-secondary px-3 py-1.5 text-xs"
                      >
                        {periodLabel}
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                      {periodOpen && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setPeriodOpen(false)} />
                          <div className="absolute right-0 top-full z-50 mt-2 w-40 overflow-hidden rounded-xl border border-border bg-card p-1" style={{ boxShadow: "var(--shadow)" }}>
                            {(
                              [
                                ["all", "All time"],
                                ["7d", "Last 7 days"],
                                ["30d", "Last 30 days"],
                              ] as [Period, string][]
                            ).map(([value, label]) => (
                              <button
                                key={value}
                                type="button"
                                onClick={() => {
                                  selectPeriod(value);
                                  setPeriodOpen(false);
                                }}
                                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors hover:bg-hover ${
                                  period === value ? "text-fg" : "text-muted"
                                }`}
                              >
                                {label}
                                {period === value && (
                                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                )}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="overflow-y-auto" style={{ maxHeight: "420px" }}>
                    <table className="w-full min-w-[560px] border-collapse text-sm">
                      <thead className="sticky top-0 z-10" style={{ background: "var(--card)" }}>
                        <tr className="text-left text-xs text-subtle">
                          <th className="px-5 py-3 font-medium">Activity</th>
                          <th className="px-5 py-3 font-medium">Date</th>
                          <th className="px-5 py-3 text-right font-medium">Amount</th>
                          <th className="px-5 py-3 font-medium">Status</th>
                          <th className="px-5 py-3" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {transactionsLoading ? (
                          [0, 1, 2].map((i) => (
                            <tr key={i}>
                              <td className="px-5 py-4" colSpan={5}>
                                <div className="h-8 animate-pulse rounded-lg bg-hover" />
                              </td>
                            </tr>
                          ))
                        ) : transactionsError ? (
                          <tr>
                            <td className="px-5 py-10 text-center" colSpan={5}>
                              <p className="text-sm font-medium">Couldn&apos;t load activity</p>
                              <p className="mt-1 text-xs text-muted">{transactionsError}</p>
                              <button
                                type="button"
                                onClick={loadTransactions}
                                className="btn-secondary mt-3 px-3 py-1.5 text-xs"
                              >
                                Try again
                              </button>
                            </td>
                          </tr>
                        ) : filteredTransactions.length === 0 ? (
                          <tr>
                            <td className="px-5 py-10 text-center" colSpan={5}>
                              <p className="text-sm font-medium">
                                {transactions.length === 0 ? "No transactions yet" : "No matching transactions"}
                              </p>
                              <p className="mt-1 text-xs text-muted">
                                {transactions.length === 0
                                  ? "Transactions from this wallet will appear here."
                                  : "Try a different search or date range."}
                              </p>
                            </td>
                          </tr>
                        ) : (
                          filteredTransactions.map((tx) => {
                            const first = tx.payments[0];
                            const received = first ? getPaymentDirection(first) === "received" : false;
                            const title =
                              tx.payments.length > 1
                                ? `${tx.payments.length} payments`
                                : received
                                  ? "Received"
                                  : "Sent";
                            const counterparty = first
                              ? received
                                ? shortenAddress(first.from, 6)
                                : shortenAddress(first.to, 6)
                              : "Contract operation";

                            return (
                              <tr
                                key={tx.hash}
                                onClick={() => setSelectedTransaction(tx)}
                                className="cursor-pointer transition-colors hover:bg-hover"
                              >
                                <td className="px-5 py-3.5">
                                  <div className="flex items-center gap-3">
                                    <span
                                      className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border border-border ${
                                        received ? "text-success" : "text-muted"
                                      }`}
                                    >
                                      {received ? IconReceive : IconSend}
                                    </span>
                                    <span className="min-w-0">
                                      <span className="block font-medium">{title}</span>
                                      <span className="block truncate font-mono text-xs text-subtle">
                                        {counterparty}
                                      </span>
                                    </span>
                                  </div>
                                </td>
                                <td className="px-5 py-3.5 tabular-nums text-muted">
                                  {new Date(tx.createdAt).toLocaleDateString(undefined, {
                                    day: "2-digit",
                                    month: "2-digit",
                                    year: "2-digit",
                                  })}
                                </td>
                                <td className="px-5 py-3.5 text-right font-medium tabular-nums">
                                  {first
                                    ? `${received ? "+" : "-"}${formatAmount(Number(first.amount))}`
                                    : "—"}{" "}
                                  XLM
                                </td>
                                <td className="px-5 py-3.5">
                                  <span
                                    className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                      tx.successful ? "text-success" : "text-danger"
                                    }`}
                                  >
                                    {tx.successful ? (
                                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="9" />
                                        <polyline points="8.5 12.5 11 15 15.5 9.5" />
                                      </svg>
                                    ) : (
                                      <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="12" r="9" />
                                        <line x1="9" y1="9" x2="15" y2="15" />
                                        <line x1="15" y1="9" x2="9" y2="15" />
                                      </svg>
                                    )}
                                    {tx.successful ? "Success" : "Failed"}
                                  </span>
                                </td>
                                <td className="px-5 py-3.5 text-right">
                                  <span className="text-subtle" aria-hidden="true">
                                    ···
                                  </span>
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="card flex flex-col overflow-hidden xl:col-span-2">
                  <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-4">
                    <h2 className="text-lg font-medium">Network</h2>
                    {accountExplorerUrl && (
                      <a
                        href={accountExplorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Open explorer"
                        className="icon-btn h-9 w-9"
                      >
                        {IconExternal}
                      </a>
                    )}
                  </div>

                  <ul className="divide-y divide-border">
                    <li className="flex items-center gap-3 px-5 py-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: "linear-gradient(135deg, #6366f1, #22d3ee)" }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 2 4.5 13.5H11l-1 8.5L19.5 10H13l1-8z" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Base fee</p>
                        <p className="text-xs text-subtle">Per transaction</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">{networkFeeFormatted}</p>
                      <p className="text-xs text-subtle">XLM</p>
                    </li>

                    <li className="flex items-center gap-3 px-5 py-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: "linear-gradient(135deg, #f59e0b, #ef4444)" }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="16" rx="2" />
                          <path d="M3 10h18" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Base reserve</p>
                        <p className="text-xs text-subtle">Per ledger entry</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">
                        {network.baseReserve !== null
                          ? formatAmount(network.baseReserve)
                          : "—"}
                      </p>
                      <p className="text-xs text-subtle">XLM</p>
                    </li>

                    <li className="flex items-center gap-3 px-5 py-4">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-white" style={{ background: "linear-gradient(135deg, #10b981, #0ea5e9)" }}>
                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M3 12h4l3 8 4-16 3 8h4" />
                        </svg>
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">Latest ledger</p>
                        <p className="text-xs text-subtle">Horizon testnet</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">
                        {network.ledger ? network.ledger.toLocaleString() : "—"}
                      </p>
                    </li>
                  </ul>

                  <div className="mt-auto border-t border-border p-5">
                    <button type="button" onClick={refreshWallet} disabled={refreshing} className="btn-secondary w-full">
                      {renderRefreshIcon(refreshing)}
                      Refresh data
                    </button>
                  </div>
                </section>
              </div>

              <footer className="mt-6 pb-2 text-xs text-subtle">
                Lumio · Stellar Testnet · Connected to Horizon
              </footer>
            </main>
          </div>

      {/* Mobile navigation drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMenuOpen(false)} />
          <div className="absolute inset-y-0 left-0 flex w-64 max-w-[80%] flex-col border-r border-border bg-panel">
            <div className="flex h-16 items-center justify-between border-b border-border px-4">
              <span className="text-[17px] font-medium tracking-tight">Lumio</span>
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                aria-label="Close navigation"
                className="icon-btn h-9 w-9 border-transparent"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <nav className="flex-1 space-y-1 p-3">
              {navItems.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={item.onClick}
                  className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                    item.active ? "bg-active text-active-fg" : "text-muted hover:bg-hover hover:text-fg"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </nav>
          </div>
        </div>
      )}

      {/* Send / Receive panel */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setFormOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-panel" style={{ boxShadow: "var(--shadow)" }}>
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <h2 className="text-base font-medium">
                {activeTab === "send" ? "Send XLM" : "Receive XLM"}
              </h2>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                aria-label="Close"
                className="icon-btn h-9 w-9 border-transparent"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-3">
              {(["send", "receive"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveTab(tab)}
                  className={`-mb-px border-b-2 px-3 pb-3 text-sm font-medium capitalize transition-colors ${
                    activeTab === tab ? "border-fg text-fg" : "border-transparent text-muted hover:text-fg"
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5">
              {activeTab === "send" ? (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="recipient" className="label">
                      Recipient address
                    </label>
                    <input
                      id="recipient"
                      type="text"
                      value={recipient}
                      onChange={(event) => setRecipient(event.target.value)}
                      placeholder="G..."
                      autoComplete="off"
                      spellCheck={false}
                      className="input mt-1.5 font-mono"
                    />
                    <p className="mt-1.5 text-xs text-subtle">
                      Stellar Ed25519 public key starting with &apos;G&apos;
                    </p>
                  </div>

                  <div>
                    <div className="flex items-center justify-between">
                      <label htmlFor="amount" className="label">
                        Amount
                      </label>
                      <button
                        type="button"
                        onClick={setMaxAmount}
                        disabled={!wallet?.success || loading}
                        className="rounded-md px-1.5 py-0.5 text-xs font-medium text-fg transition-colors hover:bg-hover disabled:opacity-50"
                      >
                        Use max
                      </button>
                    </div>
                    <div className="relative mt-1.5">
                      <input
                        id="amount"
                        type="number"
                        min="0"
                        step="0.0000001"
                        value={amount}
                        onChange={(event) => setAmount(event.target.value)}
                        placeholder="0.00"
                        className="input pr-14"
                      />
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-subtle">
                        XLM
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-subtle">
                      <span>Network fee</span>
                      <span className="tabular-nums">{networkFeeFormatted} XLM</span>
                    </div>
                  </div>

                  <button type="button" onClick={sendXLM} disabled={sending || loading} className="btn-primary w-full">
                    {sending ? (
                      <>
                        {renderRefreshIcon(true)}
                        Sending...
                      </>
                    ) : (
                      "Send XLM"
                    )}
                  </button>

                  {message && (
                    <div
                      role="status"
                      className={`rounded-xl border p-3.5 text-sm ${
                        transactionHash
                          ? "border-success/30 bg-success/10 text-success"
                          : "border-danger/30 bg-danger/10 text-danger"
                      }`}
                    >
                      <p className="font-medium">{message}</p>
                      {transactionHash && (
                        <div className="mt-2 space-y-1.5 border-t border-success/20 pt-2">
                          <p className="select-all break-all font-mono text-xs opacity-80">{transactionHash}</p>
                          <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex font-medium underline underline-offset-4">
                            View on Explorer
                          </a>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="receiveAmount" className="label">
                      Request amount <span className="font-normal text-subtle">(optional)</span>
                    </label>
                    <div className="relative mt-1.5">
                      <input
                        id="receiveAmount"
                        type="number"
                        min="0"
                        step="0.0000001"
                        value={receiveAmount}
                        onChange={(event) => setReceiveAmount(event.target.value)}
                        placeholder="0.00"
                        className="input pr-14"
                      />
                      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-subtle">
                        XLM
                      </span>
                    </div>
                  </div>

                  <div className="card-inset flex flex-col items-center p-5">
                    <div className="rounded-xl bg-white p-3 [&>svg]:h-auto [&>svg]:max-w-full">
                      {wallet?.publicKey ? (
                        <QRCodeSVG value={getPaymentRequestUri()} size={168} level="M" includeMargin />
                      ) : (
                        <div className="aspect-square w-[168px] max-w-full animate-pulse rounded bg-hover" />
                      )}
                    </div>
                    <p className="mt-3 text-xs text-muted">
                      {receiveAmount ? `Requesting ${receiveAmount} XLM` : "Scan to request XLM"}
                    </p>
                  </div>

                  <div className="card-inset p-4">
                    <p className="text-xs text-muted">Payment destination</p>
                    <p className="mt-1.5 select-all break-all font-mono text-xs leading-relaxed text-muted">
                      {wallet?.publicKey ?? "Loading..."}
                    </p>
                    <button
                      type="button"
                      onClick={copyAddress}
                      disabled={!wallet?.publicKey}
                      className="btn-secondary mt-3 w-full"
                    >
                      {copied ? "Copied" : "Copy address"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Transaction details */}
      {selectedTransaction && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setSelectedTransaction(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Transaction details"
            className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-panel"
            style={{ boxShadow: "var(--shadow)" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <h3 className="text-base font-medium">Transaction details</h3>
              <button
                type="button"
                onClick={() => setSelectedTransaction(null)}
                aria-label="Close"
                className="icon-btn h-9 w-9 border-transparent"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-2">
              <dl className="divide-y divide-border text-sm">
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="shrink-0 text-muted">Status</dt>
                  <dd className={`font-medium ${selectedTransaction.successful ? "text-success" : "text-danger"}`}>
                    {selectedTransaction.successful ? "Successful" : "Failed"}
                  </dd>
                </div>

                {selectedTransaction.payments.length > 0 ? (
                  selectedTransaction.payments.map((payment, index) => (
                    <div key={index} className="space-y-2.5 py-3">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="shrink-0 text-muted">Amount</dt>
                        <dd className="font-medium tabular-nums">
                          {formatAmount(Number(payment.amount))} XLM
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="shrink-0 text-muted">From</dt>
                        <dd className="min-w-0 break-all text-right font-mono text-xs">{payment.from}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="shrink-0 text-muted">To</dt>
                        <dd className="min-w-0 break-all text-right font-mono text-xs">{payment.to}</dd>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="flex items-center justify-between gap-4 py-3">
                    <dt className="text-muted">Type</dt>
                    <dd className="font-medium">Contract operation</dd>
                  </div>
                )}

                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="shrink-0 text-muted">Fee</dt>
                  <dd className="font-mono text-xs tabular-nums">
                    {Number(selectedTransaction.feeCharged) / 10000000} XLM
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="shrink-0 text-muted">Ledger</dt>
                  <dd className="font-mono text-xs tabular-nums">{selectedTransaction.ledger}</dd>
                </div>
                <div className="flex items-center justify-between gap-4 py-3">
                  <dt className="shrink-0 text-muted">Date</dt>
                  <dd className="min-w-0 break-words text-right text-xs">
                    {new Date(selectedTransaction.createdAt).toLocaleString(undefined, {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                      timeZoneName: "short",
                    })}
                  </dd>
                </div>
                <div className="py-3">
                  <dt className="text-muted">Transaction hash</dt>
                  <dd className="mt-1.5 select-all break-all rounded-lg border border-border bg-card-2 p-2 font-mono text-xs">
                    {selectedTransaction.hash}
                  </dd>
                </div>
              </dl>
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t border-border p-4">
              <button
                type="button"
                onClick={() => copyToClipboard(selectedTransaction.hash, selectedTransaction.hash)}
                className="btn-secondary flex-1"
              >
                {copiedTxHash === selectedTransaction.hash ? "Copied" : "Copy hash"}
              </button>
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${selectedTransaction.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary flex-1"
              >
                View on Explorer
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
