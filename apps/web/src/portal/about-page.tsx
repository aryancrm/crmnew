// The About page (/about, Aryan 24 Nov): what Bishnoi One is and how it works, moved off the home
// page, under the home page's navbar and above its footer.

import "@fontsource-variable/inter";
import { lazy, Suspense } from "react";
import { About } from "./about";

const AboutPage = lazy(() => import("../home-export").then((module) => ({ default: module.AboutPage })));

export function AboutRoute() {
  // overflow-x-clip, not -hidden: hidden makes <main> a scroll box, and the questions' pinned
  // block (sticky) would scroll away with the page instead of staying put.
  return (
    <main className="relative isolate min-h-dvh overflow-x-clip bg-white font-[Inter_Variable,Inter,sans-serif] text-[#1f2733]">
      <Suspense fallback={<div className="min-h-dvh bg-white" />}>
        <AboutPage>
          <About />
        </AboutPage>
      </Suspense>
    </main>
  );
}
