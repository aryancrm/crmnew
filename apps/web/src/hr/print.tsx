// A leave or a form as the paper HR files: the company, the person, what it carries, and the boxes
// of the employee, the immediate superior and HR with their signatures once they signed. A clean
// page outside the app's frame: the browser prints it (or saves it as a PDF).

import type { Printout } from "@2mg/api/types";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { useParams } from "react-router-dom";
import { api } from "../api";
import { Button, PageState } from "../ui";

const when = (at: string) =>
  new Date(at).toLocaleDateString("en-PH", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Manila",
  });

export function PrintPage({ of }: { of: "leave" | "form" }) {
  const { id } = useParams();
  const query = useQuery({
    queryKey: ["print", of, id],
    queryFn: () => api<Printout>(`/api/hr/print/${of}/${id}`),
  });
  const paper = query.data;
  if (!paper)
    return (
      <div className="p-6">
        <PageState query={query} what="the form" />
      </div>
    );
  return (
    <div className="min-h-dvh bg-slate-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-[48rem] justify-end gap-2 px-4 print:hidden">
        <Button onClick={() => window.history.back()}>Back</Button>
        <Button variant="primary" onClick={() => window.print()}>
          <Printer size={15} /> Print or save as PDF
        </Button>
      </div>
      <article className="mx-auto flex max-w-[48rem] flex-col gap-5 bg-white p-10 text-[13px] text-slate-900 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-3 text-center">
          <div className="text-sm font-semibold tracking-wide uppercase">{paper.company}</div>
          <h1 className="mt-1 text-xl font-bold">{paper.title}</h1>
          <div className="mt-1 text-xs text-slate-600">
            Filed {paper.filedOn} · {paper.status}
          </div>
        </header>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-1.5">
          {[
            ["Name", paper.person.name],
            ["Employee ID", paper.person.employeeCode],
            ["Position", paper.person.position],
            ["Department", paper.person.department],
          ].map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="font-semibold text-slate-600">{label}</dt>
              <dd className="border-b border-slate-300">{value || " "}</dd>
            </div>
          ))}
        </dl>
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
          {paper.fields.map((field) => (
            <div key={field.label} className="contents">
              <dt className="font-semibold text-slate-600">{field.label}</dt>
              <dd className="whitespace-pre-wrap">{field.value}</dd>
            </div>
          ))}
        </dl>
        {paper.table && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {paper.table.head.map((cell) => (
                  <th key={cell} className="border border-slate-400 bg-slate-50 px-2 py-1 text-left">
                    {cell}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paper.table.rows.map((row, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the rows are fixed as printed.
                <tr key={index}>
                  {row.map((cell, at) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the cells are fixed as printed.
                    <td key={at} className="border border-slate-400 px-2 py-1 align-top whitespace-pre-wrap">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <section className="mt-6 grid gap-6 sm:grid-cols-3 print:grid-cols-3">
          {paper.signers.map((signer) => (
            <div key={signer.box} className="flex flex-col items-center text-center">
              <div className="flex h-16 w-full items-end justify-center">
                {signer.image && (
                  <img src={signer.image} alt={`${signer.name ?? signer.box}'s signature`} className="max-h-16 max-w-full object-contain" />
                )}
              </div>
              <div className="w-full border-t border-slate-900 pt-1 font-semibold">
                {signer.name ?? " "}
              </div>
              <div className="text-xs text-slate-600">{signer.box}</div>
              <div className="text-xs text-slate-500">{signer.at ? when(signer.at) : "Date: __________"}</div>
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}
