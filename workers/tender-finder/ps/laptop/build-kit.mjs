// Builds apps/api/src/tenders/laptop-kit.generated.ts: the files a team laptop needs for the PS-PhilGEPS
// pop-up log-in (no keys, no password: the bidding system's ps-philgeps-session.js connectLaptop asks the
// CRM for the account with a one-time code). The CRM hands them to a signed-in person's setup file
// (apps/api/src/tenders/laptop-login.ts). The API's own server image holds no robot folder, so the files
// travel inside the API. Run after changing any of them:
//   node ps/laptop/build-kit.mjs          (rebuild, from workers/tender-finder)
// The API's tests fail when the built copy is out of date (laptop-login.test.ts).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER = path.join(HERE, '..', '..');
const OUT = path.join(WORKER, '..', '..', 'apps', 'api', 'src', 'tenders', 'laptop-kit.generated.ts');
const read = (file) => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');

export function kitFiles() {
    const robot = JSON.parse(read(path.join(WORKER, 'package.json')));
    const kitPackage = {
        name: 'bishnoi-one-ps-connect',
        private: true,
        description: "PS-PhilGEPS pop-up log-in for a team laptop (set up from Bishnoi One's Tender finder)",
        dependencies: { puppeteer: robot.dependencies.puppeteer, dotenv: robot.dependencies.dotenv },
    };
    return {
        'ps-philgeps-session.js': read(path.join(WORKER, 'ps', 'connect', 'ps-philgeps-session.js')),
        'Connect PS-PhilGEPS.vbs': read(path.join(HERE, 'Connect PS-PhilGEPS.vbs')),
        'register-connect-link.js': read(path.join(HERE, 'register-connect-link.js')),
        'package.json': `${JSON.stringify(kitPackage, null, 2)}\n`,
    };
}

export const kitText = (files) =>
    `// Built by workers/tender-finder/ps/laptop/build-kit.mjs from the robot's own files. Do not edit:\n// change the originals and rebuild.\nexport const LAPTOP_KIT: Record<string, string> = ${JSON.stringify(files, null, 1)};\n`;

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    fs.writeFileSync(OUT, kitText(kitFiles()));
    console.log(`Laptop kit: ${Object.keys(kitFiles()).length} files -> ${path.relative(WORKER, OUT)}`);
}
