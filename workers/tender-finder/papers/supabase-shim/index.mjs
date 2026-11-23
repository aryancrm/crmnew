// What the vendored modules (papers/lib: the bidding team's own code, unchanged) get when they
// import '@supabase/supabase-js'. They were written against a database and a file store of their
// own; in the CRM there is neither, so every call they make lands here and goes where it belongs:
//
//   products                  → the CRM's medicines (the only product list)
//   screened_tenders          → what is screened in the CRM
//   login_attempts            → the CRM (the robot's log-ins, kept across runs)
//   activity_log              → the CRM's record of the robot's runs
//   their own records (the last PS-PhilGEPS Sync's lists and notices, each tender's papers'
//   reading, the Sync's status, the saved log-in session…) → the CRM's store for the robots' rows
//   (apps/api/src/tenders/robot-store.ts), each row as they wrote it
//   Storage: a paper downloaded in this run is held on this computer until its tender is on the
//   CRM's finder, then handed to the CRM's file store (papers.mjs, ps.mjs); one the reader finds is
//   not ours is let go of before that; one asked back comes from the CRM; _ocr/… → a folder on this
//   computer, kept between runs
//   anything else             → nothing
//
// Only what those modules use is here: from().select/eq/neq/gte/in/is/not/or/order/range/
// maybeSingle/single/insert/update/upsert/delete, rpc(), storage.from().upload/download/list/remove.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';

const state = {
  crm: null, // ../../crm.js, unless configure() gives another
  screened: null, // refs of the old PhilGEPS's screened notices, when papers.mjs says which
  uploads: new Map(), // path → { bytes (read from disk), contentType, bucket }: held until handed in
  cacheDir: process.env.PAPERS_CACHE_DIR || path.join(os.tmpdir(), 'tender-papers-cache'),
};
const crm = () => (state.crm ||= createRequire(import.meta.url)('../../crm.js'));

/** papers.mjs (or a test) says where the CRM is and which notices it looks after. */
export function configure(next) {
  Object.assign(state, next);
}

/** The papers downloaded in this run and not handed to the CRM yet. */
export const uploads = state.uploads;

const ok = (data = null) => ({ data, error: null });

// The robots' own tables kept in the CRM's store, each with the columns that make a row's key
const STORED = {
  ps_philgeps_snapshot: ['id'],
  ps_philgeps_session: ['id'],
  ps_sync_status: ['id'],
  ps_tender_analysis: ['ref'],
  philgeps_sync_relay: ['id'],
  philgeps_session: ['id'],
  ocr_status: ['id'],
  award_notifications: ['award_no'],
  usage_meter: ['month'],
};
// One-row tables their own database was set up with: an update makes the row when it is not there yet
const ONE_ROW = new Set(['ps_sync_status', 'ocr_status']);
const keyOf = (table, row) => STORED[table].map((column) => String(row[column])).join('|');

// 'details->documents', 'notices->"123"->documents', 'details->>status' → the value at that path
function at(row, expression) {
  const parts = expression.split(/->>?/).map((part) => part.trim().replace(/^"(.*)"$/, '$1'));
  let value = row;
  for (const part of parts) value = value == null ? undefined : value[part];
  return value === undefined ? null : value;
}

// 'ref, documents:details->documents, details->documents_read' → the row with only those, each under its
// alias or the last name of its path
function project(row, columns) {
  if (!columns || columns.trim() === '*') return row;
  const out = {};
  for (const item of columns.split(',').map((one) => one.trim()).filter(Boolean)) {
    const alias = /^([A-Za-z_][A-Za-z0-9_]*):(.+)$/.exec(item);
    const expression = alias ? alias[2] : item;
    const name = alias ? alias[1] : expression.split(/->>?/).pop().trim().replace(/^"(.*)"$/, '$1');
    out[name] = at(row, expression);
  }
  return out;
}

class Query {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.columns = '*';
    this.tests = [];
    this.one = null;
    this.slice = null;
    this.row = null;
  }
  select(columns) {
    this.columns = columns || '*';
    return this;
  }
  insert(row) {
    this.action = 'insert';
    this.row = row;
    return this;
  }
  upsert(row) {
    this.action = 'upsert';
    this.row = row;
    return this;
  }
  update(row) {
    this.action = 'update';
    this.row = row;
    return this;
  }
  delete() {
    this.action = 'delete';
    return this;
  }
  eq(column, value) {
    this.tests.push({ column, value, test: (v) => String(v) === String(value) });
    return this;
  }
  neq(column, value) {
    this.tests.push({ column, test: (v) => String(v) !== String(value) });
    return this;
  }
  gte(column, value) {
    this.tests.push({ column, since: value, test: (v) => v != null && String(v) >= String(value) });
    return this;
  }
  in(column, values) {
    const wanted = new Set(values.map(String));
    this.tests.push({ column, test: (v) => wanted.has(String(v)) });
    return this;
  }
  is(column, value) {
    this.tests.push({ column, test: (v) => (value === null ? v == null : v === value) });
    return this;
  }
  not(column, operator, value) {
    if (operator === 'is' && value === null) this.tests.push({ column, test: (v) => v != null });
    return this;
  }
  // (their "or" filters only narrow by closing date, which the CRM has already done)
  or() {
    return this;
  }
  order() {
    return this;
  }
  range(from, to) {
    this.slice = [from, to + 1];
    return this;
  }
  maybeSingle() {
    this.one = 'maybe';
    return this;
  }
  single() {
    this.one = 'must';
    return this;
  }

  matches(row) {
    return this.tests.every(({ column, test }) => test(at(row, column)));
  }
  answer(rows) {
    let found = rows.filter((row) => this.matches(row));
    if (this.slice) found = found.slice(...this.slice);
    found = found.map((row) => project(row, this.columns));
    if (!this.one) return ok(found);
    if (found.length) return ok(found[0]);
    return this.one === 'must' ? { data: null, error: { message: 'No such row' } } : ok(null);
  }

  async run() {
    const { table } = this;
    if (table === 'login_attempts') {
      if (this.action === 'insert') {
        await crm().login(this.row);
        return ok();
      }
      const site = this.tests.find((t) => t.column === 'site')?.value || 'philgeps';
      return ok(await crm().logins(site, this.tests.find((t) => t.column === 'at')?.since || null));
    }
    if (table === 'screened_tenders') {
      if (this.action !== 'select') return ok();
      const marks = state.screened ? state.screened.map((ref) => ({ source: 'philgeps', ref: String(ref) })) : await crm().screenedList();
      return this.answer(marks);
    }
    if (table === 'products') {
      if (this.action !== 'select') return ok();
      return this.answer((await crm().products()).map((one) => ({ ...one, archived_at: null })));
    }
    if (table === 'activity_log') {
      if (this.action === 'insert') {
        const row = this.row || {};
        await crm()
          .run({ source: /^ps/.test(row.event || '') ? 'ps' : 'philgeps', trigger: row.trigger || 'schedule', status: row.status === 'success' ? 'success' : 'failed', summary: row.summary || row.event })
          .catch(() => {});
      }
      return ok();
    }
    if (!STORED[table]) return this.action === 'select' ? this.answer([]) : ok();

    // One of their own tables, kept row by row in the CRM
    const rows = await crm().store(table);
    if (this.action === 'select') return this.answer(rows);
    if (this.action === 'insert' || this.action === 'upsert') {
      const given = Array.isArray(this.row) ? this.row : [this.row];
      const byKey = new Map(rows.map((row) => [keyOf(table, row), row]));
      await crm().storeWrite(table, { upsert: given.map((row) => ({ key: keyOf(table, row), value: { ...(byKey.get(keyOf(table, row)) || {}), ...row } })) });
      return ok();
    }
    const hit = rows.filter((row) => this.matches(row));
    if (this.action === 'update') {
      const changed = hit.map((row) => ({ ...row, ...this.row }));
      if (!hit.length && ONE_ROW.has(table)) {
        const named = Object.fromEntries(this.tests.filter((t) => 'value' in t).map((t) => [t.column, t.value]));
        if (STORED[table].every((column) => named[column] != null)) changed.push({ ...named, ...this.row });
      }
      if (changed.length) await crm().storeWrite(table, { upsert: changed.map((row) => ({ key: keyOf(table, row), value: row })) });
      return ok();
    }
    if (this.action === 'delete' && hit.length) await crm().storeWrite(table, { remove: hit.map((row) => keyOf(table, row)) });
    return ok();
  }
  then(resolve, reject) {
    return this.run().then(resolve, (error) => (resolve ? resolve({ data: null, error: { message: error.message } }) : reject?.(error)));
  }
}

const cacheFile = (key) => path.join(state.cacheDir, key.replace(/[^A-Za-z0-9._-]+/g, '_'));
const portalOf = (bucket) => (bucket === 'ps-documents' ? 'ps' : 'philgeps');

function storage(bucket) {
  const source = portalOf(bucket);
  return {
    async upload(key, body, options = {}) {
      const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
      // The reader's own notes on a scan (its OCR so far): kept on this computer
      if (key.startsWith('_ocr/')) {
        try {
          fs.mkdirSync(state.cacheDir, { recursive: true });
          fs.writeFileSync(cacheFile(key), bytes);
        } catch {
          // no cache: the scan is read again next time
        }
        return ok({ path: key });
      }
      // Held on disk (a Sync may bring hundreds of files), not in memory
      const file = path.join(state.cacheDir, 'held', bucket, key.replace(/[^A-Za-z0-9._()/-]+/g, '_'));
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
      state.uploads.set(key, {
        file,
        contentType: options.contentType || 'application/octet-stream',
        bucket,
        source,
        get bytes() {
          return fs.readFileSync(file);
        },
      });
      return ok({ path: key });
    },
    async download(key) {
      if (key.startsWith('_ocr/')) {
        try {
          return ok(new Blob([fs.readFileSync(cacheFile(key))]));
        } catch {
          return { data: null, error: { message: 'not found' } };
        }
      }
      const held = state.uploads.get(key);
      if (held) return ok(new Blob([held.bytes]));
      try {
        const bytes = await crm().paper(key.split('/')[0], key, source);
        return bytes ? ok(new Blob([bytes])) : { data: null, error: { message: 'not found' } };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    // The files kept under one notice's number, as their Storage lists a folder
    async list(prefix) {
      try {
        const kept = await crm().papersList(source, String(prefix));
        return ok(kept.map((file) => ({ name: file.path.split('/').slice(1).join('/'), metadata: { size: file.size } })));
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    // A paper still held here (the reader found the tender is not ours) is let go of; one the CRM
    // already keeps is never dropped by the robot (then nothing is removed)
    async remove(keys) {
      if (!keys.every((key) => state.uploads.has(key))) return { data: null, error: { message: 'kept by the CRM' } };
      for (const key of keys) {
        try {
          fs.rmSync(state.uploads.get(key).file, { force: true });
        } catch {
          // a leftover file in the robot's own folder
        }
        state.uploads.delete(key);
      }
      return ok(keys.map((name) => ({ name })));
    },
  };
}

const client = {
  from: (table) => new Query(table),
  rpc: async () => ok(0),
  storage: { from: storage },
};

export function createClient() {
  return client;
}
