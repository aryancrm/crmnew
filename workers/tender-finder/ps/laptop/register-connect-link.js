const { execFileSync } = require('node:child_process');
const path = require('node:path');

// One-time setup per team laptop (Bishnoi One's "Set up this laptop"): teaches Windows the link
// "bishnoi-ps-connect:", which Bishnoi One's "Connect PS-PhilGEPS" button opens. The link runs
// "Connect PS-PhilGEPS.vbs" from this folder with wscript, so no console window shows: only the Chrome
// log-in window (a person ticks the captcha; the session goes to Bishnoi One).
// Its own link, not the bidding system's "ps-philgeps-connect:": setting up a laptop for Bishnoi One
// never changes where the bidding system's Sync button goes.
// Current Windows user only (HKCU), no admin rights. Undo: node register-connect-link.js --remove
const KEY = 'HKCU\\Software\\Classes\\bishnoi-ps-connect';
const SCRIPT = path.join(__dirname, 'Connect PS-PhilGEPS.vbs');

function reg(...args) {
    execFileSync('reg', args, { stdio: 'pipe' });
}

if (process.platform !== 'win32') {
    console.error('This setup is for Windows.');
    process.exit(1);
}
if (process.argv.includes('--remove')) {
    try {
        reg('delete', KEY, '/f');
    } catch {}
    console.log('Removed the bishnoi-ps-connect: link.');
} else {
    reg('add', KEY, '/ve', '/d', 'URL:Bishnoi One PS-PhilGEPS log-in', '/f');
    reg('add', KEY, '/v', 'URL Protocol', '/d', '', '/f');
    // The link's text reaches the script only to carry Bishnoi One's one-time code ("Connect PS-PhilGEPS.vbs"
    // checks its characters); it can only start the normal log-in
    reg('add', `${KEY}\\shell\\open\\command`, '/ve', '/d', `wscript.exe "${SCRIPT}" "%1"`, '/f');
    console.log(`Done. Bishnoi One's Connect PS-PhilGEPS button can now open the log-in on this laptop (${SCRIPT}).`);
}
