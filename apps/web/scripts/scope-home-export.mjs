// Makes a scoped copy of the exported home page (public/home-export) in src/home-export, so its
// sections can sit under the sign-in page without changing how the rest of the app looks.
//   - Every CSS rule is limited to the `.hx` wrapper; `:root`, `html` and `body` become `.hx`.
//   - Image paths like "/CRM.png" point at "/home-export/images/CRM.png".
// The export itself is never changed. Run again after replacing the export:
//   node apps/web/scripts/scope-home-export.mjs

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
const from = join(web, "public", "home-export");
const to = join(web, "src", "home-export");
const SCOPE = ".hx";

// postcss is in the workspace through Vite, not a direct dependency: take it from pnpm's store.
const store = join(web, "..", "..", "node_modules", ".pnpm");
const postcssDir = readdirSync(store).filter((name) => /^postcss@\d/.test(name)).sort().pop();
if (!postcssDir) throw new Error("postcss not found in node_modules/.pnpm; run pnpm install");
const { default: postcss } = await import(pathToFileURL(join(store, postcssDir, "node_modules", "postcss", "lib", "postcss.mjs")).href);

// Image paths: only the export's own images, so nothing else is touched.
const images = readdirSync(join(from, "images"));
const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const imagePath = new RegExp(`(['"\`(])/(${images.map(escape).join("|")})(?=['"\`)])`, "g");
const pointImages = (text) => text.replace(imagePath, (_, quote, name) => `${quote}/home-export/images/${name}`);

/** One selector, limited to the wrapper. */
function scope(selector) {
  const trimmed = selector.trim();
  // The page itself becomes the wrapper.
  const page = trimmed.match(/^(:root|html|body)(?=$|[\s.:[>+~])(.*)$/s);
  if (page) return `${SCOPE}${page[2]}`;
  return `${SCOPE} ${trimmed}`;
}

const css = postcss.parse(readFileSync(join(from, "HomePage.css"), "utf8"));
css.walkRules((rule) => {
  // Steps inside @keyframes (from, to, 50%) are not selectors.
  if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
  rule.selectors = rule.selectors.map(scope);
});

mkdirSync(to, { recursive: true });
const note = "/* Made by scripts/scope-home-export.mjs from public/home-export. Edit the export, then run it again. */\n";
writeFileSync(join(to, "HomePage.css"), note + pointImages(css.toString()));
// Shared with our own parts: the logo, icons and scroll hook (site-nav.tsx), and each section on
// its own, so systems-section.tsx can stand in for the systems row and showcase (index.tsx).
const SECTIONS = "Hero, SystemsRail, ProductShowcase, DashboardStage, Statement, PeoplePills, QuoteBand, WordsSplit, WorkflowStages, ApproveSmarter, Capabilities, StatsBand, HowItWorks, Integrations, CtaBand";
const shared = `\n// Added by scope-home-export.mjs: shared with site-nav.tsx, systems-section.tsx and index.tsx.\nexport { OrbitLogo, Icon, useScrollPosition, useInView, products, SystemDemo, ${SECTIONS} }\n`;
writeFileSync(join(to, "HomePage.jsx"), `// ${note.slice(3, -4)}\n` + pointImages(readFileSync(join(from, "HomePage.jsx"), "utf8")) + shared);
console.log(`Scoped ${images.length} image paths into ${to}`);
