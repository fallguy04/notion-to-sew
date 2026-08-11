"use client";

import { useActionState } from "react";
import { Card, CardHead, Field } from "@/components/ui";
import { Submit, Result } from "@/components/form";
import { saveSettingsAction } from "./actions";

export default function SettingsForm({
  settings,
  ratePct,
  categories,
}: {
  settings: Record<string, string>;
  ratePct: string;
  categories: string;
}) {
  const [result, action] = useActionState(saveSettingsAction, null);

  return (
    <form action={action} className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHead title="The shop" hint="Appears on every invoice and receipt." />
        <div className="flex flex-col gap-3.5 px-5 py-5">
          <Field label="Name">
            <input
              name="company_name"
              defaultValue={settings.CompanyName ?? "Notion to Sew"}
              required
              className="field"
            />
          </Field>
          <Field label="Address">
            <textarea
              name="address"
              defaultValue={settings.Address ?? ""}
              rows={3}
              className="field"
            />
          </Field>
          <Field label="Venmo username" hint="Shown at checkout when a customer pays by Venmo.">
            <div className="relative">
              <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
                @
              </span>
              <input
                name="venmo_user"
                defaultValue={settings.VenmoUser ?? ""}
                className="field pl-8"
                autoComplete="off"
              />
            </div>
          </Field>
        </div>
      </Card>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHead title="Sales tax" />
          <div className="px-5 py-5">
            <Field
              label="Rate"
              hint="As a percentage. Individual customers can override this on their profile."
            >
              <div className="relative">
                <input
                  name="tax_rate"
                  type="number"
                  step="0.001"
                  min="0"
                  max="99"
                  defaultValue={ratePct}
                  required
                  className="field pr-8"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-ink-faint">
                  %
                </span>
              </div>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHead
            title="Expense categories"
            hint="Separated by commas. These become the choices when logging an expense."
          />
          <div className="px-5 py-5">
            <textarea
              name="expense_categories"
              defaultValue={categories}
              rows={3}
              className="field"
              aria-label="Expense categories"
            />
          </div>
        </Card>
      </div>

      <div className="lg:col-span-2">
        <Result result={result} />
        <div className="mt-3 flex justify-end">
          <Submit pendingLabel="Saving…">Save settings</Submit>
        </div>
      </div>
    </form>
  );
}
