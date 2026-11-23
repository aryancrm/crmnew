// Connect: a person makes the PS-PhilGEPS log-in session, once (and again whenever PS-PhilGEPS
// ends it). The site's log-in has a captcha, so a robot cannot: on a computer with Google Chrome
// this opens the log-in window with the account filled in; the person ticks "I'm not a robot" and
// the log-in submits itself. The session is then kept by the CRM (sealed), and the PS-PhilGEPS
// robot (ps/ps.mjs, every hour on GitHub) uses it until PS-PhilGEPS ends it.
//
// The tool itself is the bidding team's own (ps-philgeps-session.js, one path changed). It needs,
// in a file named .env beside package.json (never committed):
//
//   PS_PHILGEPS_USERNAME=…      the company's merchant log-in
//   PS_PHILGEPS_PASSWORD=…
//   CRM_URL=…                   the CRM's API
//   TENDER_FINDER_KEY=…         the robot's key, the same as on the CRM's API server
//
//   node ps/connect/connect.js            open the log-in window
//   node ps/connect/connect.js --check    is the saved session still alive?
require('dotenv').config({ quiet: true });
// The vendored modules ask for these before they talk to "Supabase" (here: the CRM, papers/supabase-shim)
process.env.SUPABASE_URL ||= 'http://crm.invalid';
process.env.SUPABASE_KEY ||= 'the-crm-keeps-it';

const { connect, checkSession } = require('./ps-philgeps-session.js');

const check = process.argv.includes('--check');
(check ? checkSession() : connect())
    .then(() => console.log(check ? 'Still connected to PS-PhilGEPS.' : 'Connected to PS-PhilGEPS: the CRM keeps the session, the robot uses it from its next run.'))
    .catch((e) => {
        console.error(`${e.code || 'ERROR'}: ${e.message}`);
        process.exit(1);
    });
