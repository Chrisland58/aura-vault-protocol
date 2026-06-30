"use client";

import { useState, useEffect } from "react";
import TransactionModal from "./TransactionModal";

type Tab = "deposit" | "withdraw";

export default function VaultActions() {
  const [tab, setTab] = useState<Tab>("deposit");
  const [modal, setModal] = useState<Tab | null>(null);
  const [balance, setBalance] = useState("1000");

  useEffect(() => {
    fetch("/api/vault/balance_of?address=mock")
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.balance) setBalance(d.balance); })
      .catch(() => {});
  }, []);

  return (
    <section className="w-full rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <div className="flex gap-2 mb-4">
        <button
          data-cy="deposit-tab"
          onClick={() => setTab("deposit")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === "deposit" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"}`}
        >
          Deposit
        </button>
        <button
          data-cy="withdraw-tab"
          onClick={() => setTab("withdraw")}
          className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${tab === "withdraw" ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-black" : "border border-zinc-300 hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-800"}`}
        >
          Withdraw
        </button>
      </div>

      <p className="text-sm text-zinc-500 mb-4">
        Balance: <span data-cy="vault-balance" className="font-mono font-semibold text-zinc-800 dark:text-zinc-200">{balance}</span>
      </p>

      {tab === "deposit" && (
        <button
          data-cy="open-deposit-modal"
          onClick={() => setModal("deposit")}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
        >
          Deposit
        </button>
      )}

      {tab === "withdraw" && (
        <button
          data-cy="open-withdraw-modal"
          onClick={() => setModal("withdraw")}
          className="w-full rounded-lg bg-zinc-900 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-black dark:hover:bg-zinc-300"
        >
          Withdraw
        </button>
      )}

      {modal && (
        <TransactionModal
          type={modal}
          balance={balance}
          onClose={() => setModal(null)}
        />
      )}
    </section>
  );
}
