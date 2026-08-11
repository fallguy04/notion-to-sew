"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHead } from "@/components/ui";
import { Spinner } from "@/components/form";
import { useToast } from "@/components/toast";
import { addFreightAction } from "../actions";

/**
 * Shipping added after the fact, which is how it usually happens: the box gets
 * weighed after the invoice is written.
 */
export default function FreightBox({ id }: { id: number }) {
  const [amount, setAmount] = useState("");
  const [pending, start] = useTransition();
  const toast = useToast();
  const router = useRouter();

  return (
    <Card>
      <CardHead
        title="Add shipping"
        hint="Appears as a Shipping line and raises the amount due."
      />
      <form
        className="flex flex-wrap items-end gap-3 px-5 py-4"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const res = await addFreightAction(id, parseFloat(amount));
            toast(res!.message, res!.ok ? "good" : "bad");
            if (res!.ok) {
              setAmount("");
              router.refresh();
            }
          });
        }}
      >
        <label className="block">
          <span className="label">Amount</span>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
              $
            </span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              className="field w-[140px] pl-7"
            />
          </div>
        </label>
        <button type="submit" disabled={pending || !amount} className="btn btn-ghost">
          {pending && <Spinner />}
          Add shipping
        </button>
      </form>
    </Card>
  );
}
