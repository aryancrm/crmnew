// The exported home page's sections (public/home-export), shown under the sign-in page for now,
// before they are redesigned. Its styles are scoped to the `.hx` box by
// scripts/scope-home-export.mjs, so the rest of the app looks the same.

import { type ReactNode, useEffect } from "react";
import {
  Capabilities,
  CtaBand,
  DashboardStage,
  HowItWorks,
  Integrations,
  PeoplePills,
  QuoteBand,
  Statement,
  StatsBand,
  WordsSplit,
  WorkflowStages,
} from "./HomePage.jsx";
import { ApproveSection } from "./approve-section";
import { HeroSplit } from "./hero-split";
import { Footer, Navbar } from "./site-nav";
import { ProductShowcase, SystemsRail } from "./systems-section";

const FONTS =
  "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700;800;900&family=Inter:wght@400;500;600;700&family=Poppins:wght@400;500;600&display=swap";

/** The export's fonts, added to the page once, only where these sections show. */
function useFonts() {
  useEffect(() => {
    if (document.querySelector(`link[href="${FONTS}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = FONTS;
    document.head.append(link);
  }, []);
}

/** The page's first screen: the export's navbar and our two-column hero (hero-split.tsx). The systems section and the rest come under it (HomeExport). */
export function HomeTop() {
  useFonts();
  return (
    <div className="hx">
      <Navbar />
      <HeroSplit />
    </div>
  );
}

export default function HomeExport() {
  useFonts();
  // Opened from another page's Sign in (/login#systems): once these sections are in, go there.
  useEffect(() => {
    if (window.location.hash === "#systems") document.getElementById("systems")?.scrollIntoView();
  }, []);

  // The rest of the export's page, section by section. The systems row and the showcase are
  // ours (systems-section.tsx): the export's eight systems plus the portal's 14 workspaces.
  return (
    <div className="hx">
      <SystemsRail />
      <ProductShowcase />
      <DashboardStage />
      <Statement />
      <PeoplePills />
      <QuoteBand />
      <WordsSplit />
      <WorkflowStages />
      <ApproveSection />
      <Capabilities />
      <StatsBand />
      <HowItWorks />
      <Integrations />
      <CtaBand />
      <Footer />
    </div>
  );
}

/** The About page (/about): the navbar, what is inside Bishnoi One (portal/about.tsx, kept outside
 *  `.hx` so the export's styles leave it alone), then the footer. */
export function AboutPage({ children }: { children: ReactNode }) {
  useFonts();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);
  return (
    <>
      <div className="hx">
        <Navbar />
      </div>
      <div className="pt-[66px]">{children}</div>
      <div className="hx">
        <Footer />
      </div>
    </>
  );
}
