// Types for the exported home page, which is plain JavaScript.
import type { JSX, SVGProps } from "react";

export default function HomePage(): JSX.Element;
export function Navbar(): JSX.Element;
export function Footer(): JSX.Element;

/** The Bishnoi One logo: the mark, with the words beside it unless `compact`. */
export function OrbitLogo(props: { variant?: "mark" | "lockup"; tone?: "dark" | "light"; compact?: boolean; className?: string }): JSX.Element;

/** One of the export's line icons. */
export function Icon(
  props: {
    name:
      | "arrowRight" | "arrowUpRight" | "arrowLeft" | "chevronDown" | "check" | "close" | "search" | "menu" | "play"
      | "plus" | "minus" | "star" | "sparkle" | "bolt" | "shield" | "globe" | "pipeline" | "people" | "board"
      | "headset" | "chart" | "automation" | "puzzle" | "quote";
    size?: number;
    className?: string;
  } & Omit<SVGProps<SVGSVGElement>, "name">,
): JSX.Element | null;

/** How far the window is scrolled, read once per frame. */
export function useScrollPosition(): number;

/** Whether an element is on screen: put `ref` on it. */
export function useInView<T extends HTMLElement = HTMLElement>(options?: {
  threshold?: number;
  rootMargin?: string;
  once?: boolean;
}): [import("react").RefObject<T>, boolean];

/** The export's eight systems, with their copy for the cards and the showcase. */
export const products: {
  id: string;
  name: string;
  short: string;
  tagline: string;
  icon: string;
  logo: string;
  accent: string;
  menuBlurb: string;
  headline: string;
  description: string;
  bullets: string[];
  stat: { value: string; label: string };
}[];

/** The animated dashboard of one of the eight systems. */
export function SystemDemo(props: { id: string }): JSX.Element;

// Each section of the page, in its order.
export function Hero(): JSX.Element;
export function SystemsRail(): JSX.Element;
export function ProductShowcase(): JSX.Element;
export function DashboardStage(): JSX.Element;
export function Statement(): JSX.Element;
export function PeoplePills(): JSX.Element;
export function QuoteBand(): JSX.Element;
export function WordsSplit(): JSX.Element;
export function WorkflowStages(): JSX.Element;
export function ApproveSmarter(): JSX.Element;
export function Capabilities(): JSX.Element;
export function StatsBand(): JSX.Element;
export function HowItWorks(): JSX.Element;
export function Integrations(): JSX.Element;
export function CtaBand(): JSX.Element;
