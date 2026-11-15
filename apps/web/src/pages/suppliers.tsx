// Suppliers: who the medicines are bought from, and in which currency they bill.

import type { Supplier } from "@2mg/api/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { api } from "../api";
import { useMe } from "../auth";
import {
  Button,
  Card,
  Dialog,
  Field,
  INPUT,
  PageHead,
  PageState,
  Pill,
  Problem,
  useAction,
} from "../ui";

export function Suppliers() {
  const me = useMe().data;
  const query = useQuery({
    queryKey: ["inventory", "suppliers"],
    queryFn: async () => (await api<{ suppliers: Supplier[] }>("/api/suppliers")).suppliers,
  });
  const [editing, setEditing] = useState<Supplier | "new" | null>(null);
  const canEdit = me?.role === "inventory" || me?.role === "admin";

  const data = query.data;
  if (!data) return <PageState query={query} what="the suppliers" />;

  return (
    <div className="mx-auto flex max-w-[88rem] flex-col gap-4">
      <PageHead
        title="Suppliers"
        sub="Who the medicines are bought from"
        actions={
          canEdit && (
            <Button variant="primary" onClick={() => setEditing("new")}>
              <Plus size={16} aria-hidden="true" /> Add supplier
            </Button>
          )
        }
      />
      <Card>
        {data.length === 0 ? (
          <div className="p-8 text-center text-ink-2">No supplier yet.</div>
        ) : (
          <ul className="flex flex-col">
            {data.map((supplier) => (
              <li
                key={supplier.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line-soft px-5 py-3.5 last:border-b-0"
              >
                <div className="min-w-0 flex-1 basis-56">
                  <div className="font-semibold">{supplier.name}</div>
                  <div className="text-[13px] text-ink-2">
                    {[supplier.country, supplier.contact].filter(Boolean).join(" · ") ||
                      "No details yet"}
                  </div>
                </div>
                <Pill>Bills in {supplier.currency}</Pill>
                {!supplier.active && <Pill tone="warn">Not used</Pill>}
                {canEdit && (
                  <Button small onClick={() => setEditing(supplier)}>
                    Edit
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
      {editing && (
        <SupplierDialog
          supplier={editing === "new" ? undefined : editing}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

function SupplierDialog({ supplier, onClose }: { supplier?: Supplier; onClose: () => void }) {
  const queries = useQueryClient();
  const action = useAction();
  const [name, setName] = useState(supplier?.name ?? "");
  const [country, setCountry] = useState(supplier?.country ?? "");
  const [currency, setCurrency] = useState(supplier?.currency ?? "USD");
  const [contact, setContact] = useState(supplier?.contact ?? "");
  const [active, setActive] = useState(supplier?.active ?? true);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const done = await action.run(async () => {
      await api(supplier ? `/api/suppliers/${supplier.id}` : "/api/suppliers", {
        body: { name, country, currency, contact, active },
      });
    });
    if (!done) return;
    await queries.invalidateQueries({ queryKey: ["inventory"] });
    onClose();
  }

  return (
    <Dialog
      title={supplier ? "Edit supplier" : "Add supplier"}
      onClose={onClose}
      busy={action.busy}
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Name" error={action.at("name")}>
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-3">
          <Field label="Country">
            {(field) => (
              <input
                {...field}
                className={INPUT}
                placeholder="India"
                value={country}
                onChange={(event) => setCountry(event.target.value)}
              />
            )}
          </Field>
          <Field label="Bills in (currency code)" error={action.at("currency")}>
            {(field) => (
              <input
                {...field}
                className={INPUT}
                placeholder="USD"
                value={currency}
                onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              />
            )}
          </Field>
        </div>
        <Field label="Contact (optional)">
          {(field) => (
            <input
              {...field}
              className={INPUT}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          )}
        </Field>
        {supplier && (
          <label className="flex min-h-11 items-center gap-2.5">
            <input
              type="checkbox"
              className="size-4.5"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Still buying from this supplier
          </label>
        )}
        <Problem message={action.general(["name", "currency"])} />
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4">
          <Button onClick={onClose} disabled={action.busy}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={action.busy}>
            {action.busy ? "Saving…" : supplier ? "Save" : "Add supplier"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
