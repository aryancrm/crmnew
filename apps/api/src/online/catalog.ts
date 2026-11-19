// The stock link to a website (Aryan, 19 Nov: "the old CRM's link to the 2MG website: stock,
// points"): the old CRM's catalogue push as it was (backend/apps/store/src/catalog-push.ts), the
// same call and the same fields. Every medicine with its prices (pesos, per piece and per pack)
// and the pieces sellable on the shelf goes to the website's catalogue address, signed with the
// website's secret, 200 a request, only those that changed since the website last took them (a
// hash per medicine and website). The website works out its own packs and takes off its own open
// orders. The website (2MG) knows each medicine by the old CRM's id, kept in medicine.web_id
// (scripts/import-web-ids.ts brings them over); a medicine new here gets a new one when first sent.

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { type Database, rows } from "../db/index";
import { allow, Refusal } from "../http";
import type { Runner } from "../inventory/service";
import type { Me } from "../types";
import { CHANNEL_ROLES } from "./messenger";
import { unseal } from "./secrets";
import { allowedUrl, postToWebsite } from "./websites";

/** One medicine as the website receives it (the old CRM's CatalogProduct). */
export type CatalogProduct = {
  id: string;
  code: string | null;
  name: string;
  strength: string | null;
  genericName: string | null;
  dosageForm: string | null;
  category: string | null;
  /** The piece the CRM counts and prices: Tablet, Vial… */
  unit: string | null;
  prescription: boolean;
  /** The VAT in the price, as a percentage (0 for exempt and zero-rated). */
  vatRate: number;
  /** The SRP of one piece, in pesos. */
  price: number;
  /** The patient price of one piece, when lower than the SRP. */
  patientPrice: number | null;
  /** The price a guarantee letter pays for one piece: the patient list, as this CRM quotes a GL case. */
  glPrice: number | null;
  packPrice: number;
  packPatientPrice: number | null;
  packGlPrice: number | null;
  /** Pieces sellable on the shelf, every warehouse (expired batches left out). */
  onHand: number;
  packLabel: string | null;
  packUnits: number;
  active: boolean;
};

const BATCH = 200;
const pesos = (centavos: number | null | undefined) => Math.round(Number(centavos ?? 0)) / 100;
const textOr = (value: string | null | undefined) => (value?.trim() ? value.trim() : null);

/** Every medicine as the website receives it, with its id there. */
export async function catalogProducts(db: Runner): Promise<{ medicineId: number; product: CatalogProduct }[]> {
  // A medicine without the website's id yet (one new here) gets one.
  await db.execute(sql`update medicine set web_id = gen_random_uuid() where web_id is null`);
  const list = await rows<{
    medicineId: number;
    webId: string;
    code: string | null;
    name: string;
    strength: string | null;
    generic: string | null;
    form: string | null;
    category: string | null;
    unit: string | null;
    rx: boolean;
    vat: string;
    srp: number | null;
    srpPack: number | null;
    pack: string | null;
    packSize: number;
    active: boolean;
    patient: number | null;
    patientPack: number | null;
    onHand: number;
  }>(
    db,
    sql`select m.id::int as "medicineId", m.web_id::text as "webId", coalesce(m.sku, m.code) as code, m.name, m.strength,
        m.generic, m.form, m.category, m.unit, m.rx, m.vat, m.srp::int as srp, m.srp_pack::int as "srpPack", m.pack,
        m.pack_size::int as "packSize", m.active, p.amount::int as patient, p.pack_amount::int as "patientPack",
        coalesce((select sum(s.qty) from stock s join batch b on b.id = s.batch_id
          where b.medicine_id = m.id and b.expires_on >= (now() at time zone 'Asia/Manila')::date), 0)::int as "onHand"
      from medicine m left join medicine_price p on p.medicine_id = m.id and p.buyer_type = 'patient'
      order by m.name, m.id`,
  );
  return list.map((m) => {
    const units = Math.max(1, m.packSize || 1);
    // Each price per piece and per pack, the one not kept worked out from the other.
    const srp = m.srp ?? (m.srpPack !== null ? Math.round(m.srpPack / units) : (m.patient ?? 0));
    const srpPack = m.srpPack ?? srp * units;
    const patient = m.patient ?? 0;
    const patientPack = m.patientPack ?? patient * units;
    const price = pesos(srp);
    const packPrice = pesos(srpPack);
    return {
      medicineId: m.medicineId,
      product: {
        id: m.webId,
        code: textOr(m.code),
        name: m.name.trim(),
        strength: textOr(m.strength),
        genericName: textOr(m.generic),
        dosageForm: textOr(m.form),
        category: textOr(m.category),
        unit: textOr(m.unit),
        prescription: m.rx,
        vatRate: m.vat === "vat12" ? 12 : 0,
        price,
        patientPrice: patient > 0 && pesos(patient) < price ? pesos(patient) : null,
        glPrice: patient > 0 ? pesos(patient) : null,
        packPrice,
        packPatientPrice: patientPack > 0 && pesos(patientPack) < packPrice ? pesos(patientPack) : null,
        packGlPrice: patientPack > 0 ? pesos(patientPack) : null,
        onHand: Math.max(0, m.onHand),
        packLabel: textOr(m.pack),
        packUnits: units,
        active: m.active,
      },
    };
  });
}

const hashOf = (product: CatalogProduct) =>
  createHash("sha256").update(JSON.stringify(product)).digest("hex").slice(0, 24);

/** Sends one website the medicines that changed since it last took them. Off until its
 *  catalogue address is set (Channels → the website → Stock link). */
export async function pushCatalog(
  db: Database,
  accountId: number,
  options: { all?: boolean } = {},
): Promise<{ sent: number; failed: string | null; off: boolean }> {
  const [site] = await rows<{ name: string; secret: string; url: string | null }>(
    db,
    sql`select name, secret, config->>'catalogUrl' as url from channel_account where id = ${accountId} and kind = 'website' and active`,
  );
  const url = allowedUrl(site?.url);
  if (!site || !url) return { sent: 0, failed: null, off: true };
  const secret = unseal(site.secret);
  const products = await catalogProducts(db);
  const known = new Map(
    (
      await rows<{ medicineId: number; hash: string }>(
        db,
        sql`select medicine_id::int as "medicineId", hash from web_catalog_sent where account_id = ${accountId}`,
      )
    ).map((row) => [row.medicineId, row.hash]),
  );
  const changed = products.filter((one) => options.all || known.get(one.medicineId) !== hashOf(one.product));
  let sent = 0;
  let failed: string | null = null;
  for (let i = 0; i < changed.length; i += BATCH) {
    const batch = changed.slice(i, i + BATCH);
    const body = JSON.stringify({
      event: "catalog.products",
      sentAt: new Date().toISOString(),
      products: batch.map((one) => one.product),
    });
    const answer = await postToWebsite(url, body, secret, "catalog.products");
    if (answer.status < 200 || answer.status >= 300) {
      const said = typeof answer.json?.message === "string" ? answer.json.message.slice(0, 300) : null;
      failed = said ?? (answer.status ? `${site.name} answered ${answer.status}.` : `${site.name} didn't answer.`);
      break;
    }
    for (const one of batch)
      await db.execute(
        sql`insert into web_catalog_sent (account_id, medicine_id, hash) values (${accountId}, ${one.medicineId}, ${hashOf(one.product)})
          on conflict (account_id, medicine_id) do update set hash = excluded.hash, sent_at = now()`,
      );
    sent += batch.length;
  }
  // The old CRM's medicines with no match here: once to each website as no longer sold.
  if (!failed) {
    const retired = await rows<{ webId: string; code: string | null; name: string; strength: string | null }>(
      db,
      sql`select web_id::text as "webId", code, name, strength from web_retired_product
        where not (${accountId}::bigint = any(sent_to)) order by name limit ${BATCH}`,
    );
    if (retired.length) {
      const body = JSON.stringify({
        event: "catalog.products",
        sentAt: new Date().toISOString(),
        products: retired.map(
          (one): CatalogProduct => ({
            id: one.webId,
            code: textOr(one.code),
            name: one.name,
            strength: textOr(one.strength),
            genericName: null,
            dosageForm: null,
            category: null,
            unit: null,
            prescription: true,
            vatRate: 0,
            price: 0,
            patientPrice: null,
            glPrice: null,
            packPrice: 0,
            packPatientPrice: null,
            packGlPrice: null,
            onHand: 0,
            packLabel: null,
            packUnits: 1,
            active: false,
          }),
        ),
      });
      const answer = await postToWebsite(url, body, secret, "catalog.products");
      if (answer.status >= 200 && answer.status < 300) {
        await db.execute(
          sql`update web_retired_product set sent_to = array_append(sent_to, ${accountId}::bigint)
            where web_id in (${sql.join(retired.map((one) => sql`${one.webId}::uuid`), sql`, `)})`,
        );
        sent += retired.length;
      } else failed = `${site.name} answered ${answer.status || "nothing"} to the medicines no longer sold.`;
    }
  }
  await db.execute(
    sql`update channel_account set config = config || ${JSON.stringify({
      catalogCheckedAt: new Date().toISOString(),
      catalogError: failed,
      ...(sent ? { catalogSentAt: new Date().toISOString(), catalogSent: sent } : {}),
    })}::jsonb where id = ${accountId}`,
  );
  return { sent, failed, off: false };
}

/** Every website with a stock link: what changed goes (the timer's, every few minutes). */
export async function pushCatalogs(db: Database): Promise<number> {
  const sites = await rows<{ id: number }>(
    db,
    sql`select id::int as id from channel_account where kind = 'website' and active and coalesce(config->>'catalogUrl', '') <> ''`,
  );
  let sent = 0;
  for (const site of sites) sent += (await pushCatalog(db, site.id)).sent;
  return sent;
}

/** The website's catalogue address (2MG: https://www.2mginc.com/api/crm/catalog); empty turns
 *  the stock link off. */
export async function setCatalogUrl(db: Database, me: Me, accountId: number, raw: string): Promise<void> {
  allow(me, CHANNEL_ROLES, "set a website's stock link");
  const url = raw.trim() ? allowedUrl(raw) : "";
  if (url === null)
    throw new Refusal(400, "invalid", "Type the website's catalogue address (https://…).", "url");
  const changed = await rows<{ id: number }>(
    db,
    sql`update channel_account set config = config || ${JSON.stringify({ catalogUrl: url })}::jsonb
      where id = ${accountId} and kind = 'website' returning id::int as id`,
  );
  if (!changed.length) throw new Refusal(404, "not_found", "No such website.");
}
