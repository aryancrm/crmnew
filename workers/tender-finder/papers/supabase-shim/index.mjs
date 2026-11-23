// What the vendored modules (papers/lib, the bidding team's tender finder, unchanged) get when
// they import '@supabase/supabase-js'. They were written against Supabase tables and Storage; in
// the CRM there is no Supabase, so every call they make lands here and goes where it belongs:
//
//   login_attempts            → the CRM (the robot's log-ins are kept there, across runs)
//   screened_tenders          → the notices the CRM said to look after (all of them are screened)
//   Storage philgeps-documents: a paper downloaded from PhilGEPS is held here until papers.mjs
//                               hands it to the CRM; one asked back is fetched from the CRM
//   Storage _ocr/…            → a folder on this computer (kept between runs by the workflow), so
//                               a long scan's reading goes on where it stopped
//   everything else (their run status, text cache, usage meter, activity log) → nothing: one run
//                               here is one process, with no dashboard to tell
//
// Only what those modules use is here: from().select/eq/neq/gte/in/is/not/or/order/range/
// maybeSingle/single/insert/update/upsert/delete, rpc(), storage.from().upload/download/remove.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const state = {
  crm: null, // ../../crm.js
  screened: [], // refs
  uploads: new Map(), // path → { bytes: Buffer, contentType }
  cacheDir: process.env.PAPERS_CACHE_DIR || path.join(os.tmpdir(), 'tender-papers-cache'),
};

/** papers.mjs says where the CRM is and which notices it looks after. */
export function configure(next) {
  Object.assign(state, next);
}

/** The papers downloaded in this run and not handed to the CRM yet. */
export const uploads = state.uploads;

const ok = (data = null) => ({ data, error: null });

class Query {
  constructor(table) {
    this.table = table;
    this.action = 'select';
    this.filters = {};
    this.one = false;
    this.row = null;
  }
  select() {
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
    this.filters[column] = value;
    return this;
  }
  gte(column, value) {
    this.filters[`${column}>=`] = value;
    return this;
  }
  neq() {
    return this;
  }
  in() {
    return this;
  }
  is() {
    return this;
  }
  not() {
    return this;
  }
  or() {
    return this;
  }
  order() {
    return this;
  }
  range() {
    return this;
  }
  maybeSingle() {
    this.one = true;
    return this;
  }
  single() {
    this.one = true;
    return this;
  }
  async run() {
    if (this.table === 'login_attempts') {
      if (this.action === 'insert') {
        await state.crm.login(this.row);
        return ok();
      }
      return ok(await state.crm.logins(this.filters.site || 'philgeps', this.filters['at>='] || null));
    }
    if (this.table === 'screened_tenders' && this.action === 'select') {
      return ok(state.screened.map((ref) => ({ source: 'philgeps', ref: String(ref) })));
    }
    if (this.action !== 'select') return ok();
    return ok(this.one ? null : []);
  }
  then(resolve, reject) {
    return this.run().then(resolve, reject);
  }
}

const cacheFile = (key) => path.join(state.cacheDir, key.replace(/[^A-Za-z0-9._-]+/g, '_'));

function storage(bucket) {
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
      state.uploads.set(key, { bytes, contentType: options.contentType || 'application/octet-stream', bucket });
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
        const bytes = await state.crm.paper(key.split('/')[0], key);
        return bytes ? ok(new Blob([bytes])) : { data: null, error: { message: 'not found' } };
      } catch (e) {
        return { data: null, error: { message: e.message } };
      }
    },
    // The papers of a screened notice are never dropped
    async remove() {
      return { data: null, error: { message: 'kept' } };
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
