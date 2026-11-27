// Made by scripts/scope-home-export.mjs from public/home-export. Edit the export, then run it again.
/* Bishnoi One home page: the whole page in one file.
   Needs React 18, HomePage.css next to this file, and the images from the
   images/ folder in the site's public/ folder (they load from /CRM.png etc.).

   Usage:
     import HomePage, { Navbar, Footer } from './HomePage.jsx'
     <Navbar />          // optional, skip if the site has its own
     <main id="main"><HomePage /></main>
     <Footer />          // optional
*/
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import './HomePage.css'
import { MedrepScreen } from './medrep-screen'

/* ===== components/ui/OrbitLogo.jsx ===== */
/**
 * Bishnoi One logo: the "B" orbit mark (public/bishnoi-logo.png, cropped from
 * the master artwork in public/favicon.ico) beside a typeset wordmark.
 *
 * - `variant="lockup"` is the larger navbar size.
 * - `tone="light"` flips the word white for dark backgrounds.
 * - `compact` shows the mark only.
 */
function OrbitLogo({
  variant = 'mark',
  tone = 'dark',
  compact = false,
  className = '',
}) {
  return (
    <span
      className={`orbit-logo ${variant === 'lockup' ? 'orbit-logo--lockup' : ''} ${className}`.trim()}
    >
      <img
        className="orbit-logo__mark"
        src="/home-export/images/bishnoi-logo.png"
        width="320"
        height="256"
        alt={compact ? 'Bishnoi One' : ''}
        decoding="async"
      />
      {!compact && (
        <span className="orbit-logo__word" data-tone={tone}>
          Bishnoi <span className="orbit-logo__accent">One</span>
        </span>
      )}
    </span>
  )
}

/* ===== components/ui/Icon.jsx ===== */
/**
 * One inline SVG sprite for the whole site — keeps the bundle free of an icon
 * dependency and lets every glyph inherit currentColor.
 */
const paths = {
  arrowRight: (
    <path
      d="M5 12h13m0 0-5.5-5.5M18 12l-5.5 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  arrowUpRight: (
    <path
      d="M7 17 17 7m0 0H9m8 0v8"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  arrowLeft: (
    <path
      d="M19 12H6m0 0 5.5-5.5M6 12l5.5 5.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  chevronDown: (
    <path
      d="m6 9.5 6 6 6-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  check: (
    <path
      d="m5 12.5 4.5 4.5L19 7"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  close: (
    <path
      d="M6 6 18 18M18 6 6 18"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  ),
  search: (
    <path
      d="M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Zm4.6-1.9L20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
  menu: (
    <path
      d="M4 7h16M4 12h16M4 17h16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
    />
  ),
  play: <path d="M9 7.5v9l7.5-4.5z" fill="currentColor" />,
  plus: (
    <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  ),
  minus: <path d="M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />,
  star: (
    <path
      d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.05 5.9L12 17l-5.25 2.8L7.8 13.9 3.5 9.8l5.9-.8z"
      fill="currentColor"
    />
  ),
  sparkle: (
    <path
      d="M12 3.2 13.9 9l5.8 1.9-5.8 1.9L12 18.6 10.1 12.8 4.3 10.9 10.1 9zM18.6 3l.8 2.3 2.3.8-2.3.8-.8 2.3-.8-2.3-2.3-.8 2.3-.8z"
      fill="currentColor"
    />
  ),
  bolt: (
    <path d="M13.5 2 5 13.4h5.2L9.8 22 19 10.4h-5.4z" fill="currentColor" />
  ),
  shield: (
    <path
      d="M12 3 5 5.8v5.6c0 4.3 2.9 8.2 7 9.6 4.1-1.4 7-5.3 7-9.6V5.8z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
    />
  ),
  globe: (
    <g fill="none" stroke="currentColor" strokeWidth="1.9">
      <circle cx="12" cy="12" r="8.6" />
      <path d="M3.4 12h17.2M12 3.4c2.2 2.4 3.4 5.4 3.4 8.6S14.2 18.2 12 20.6C9.8 18.2 8.6 15.2 8.6 12S9.8 5.8 12 3.4z" />
    </g>
  ),
  pipeline: (
    <g fill="currentColor">
      <rect x="3" y="4.5" width="5" height="15" rx="2" opacity="0.45" />
      <rect x="9.5" y="4.5" width="5" height="10" rx="2" opacity="0.75" />
      <rect x="16" y="4.5" width="5" height="6" rx="2" />
    </g>
  ),
  people: (
    <g fill="currentColor">
      <circle cx="9" cy="8.5" r="3.6" />
      <path d="M2.8 20c0-3.4 2.8-5.6 6.2-5.6s6.2 2.2 6.2 5.6z" opacity="0.75" />
      <circle cx="17.4" cy="9.4" r="2.7" opacity="0.55" />
      <path d="M15 20h6.4c0-2.6-1.6-4.4-3.9-4.7" opacity="0.4" />
    </g>
  ),
  board: (
    <g fill="currentColor">
      <rect x="3" y="4" width="18" height="16" rx="3.4" opacity="0.28" />
      <rect x="6" y="7.4" width="6.4" height="2.6" rx="1.3" />
      <rect x="6" y="11.4" width="10.4" height="2.6" rx="1.3" opacity="0.8" />
      <rect x="6" y="15.4" width="4.4" height="2.6" rx="1.3" opacity="0.6" />
    </g>
  ),
  headset: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M4.5 13v-1a7.5 7.5 0 1 1 15 0v1" />
      <rect x="2.8" y="12.6" width="4.2" height="6.4" rx="2.1" fill="currentColor" stroke="none" />
      <rect x="17" y="12.6" width="4.2" height="6.4" rx="2.1" fill="currentColor" stroke="none" />
      <path d="M19.2 19v.6a2.6 2.6 0 0 1-2.6 2.6H13" />
    </g>
  ),
  chart: (
    <g fill="currentColor">
      <rect x="3.5" y="12" width="4" height="8" rx="1.8" opacity="0.5" />
      <rect x="10" y="7" width="4" height="13" rx="1.8" opacity="0.78" />
      <rect x="16.5" y="3.5" width="4" height="16.5" rx="1.8" />
    </g>
  ),
  automation: (
    <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="6.5" cy="6.5" r="3" />
      <circle cx="17.5" cy="17.5" r="3" />
      <path d="M9.5 6.5h5a3 3 0 0 1 3 3v5M14.5 17.5h-5a3 3 0 0 1-3-3v-5" />
    </g>
  ),
  puzzle: (
    <path
      d="M10.2 3h3.6v2a1.8 1.8 0 1 0 3.6 0h2.6v3.6h-2a1.8 1.8 0 1 0 0 3.6h2V21h-6v-2.4a1.8 1.8 0 1 0-3.6 0V21H4V15h2a1.8 1.8 0 1 0 0-3.6H4V6.6h2.6a1.8 1.8 0 1 0 3.6 0z"
      fill="currentColor"
    />
  ),
  quote: (
    <path
      d="M9.4 6C6.3 7.4 4.4 10.2 4.4 13.6c0 2.8 1.7 4.6 4 4.6 2 0 3.5-1.5 3.5-3.4 0-1.9-1.3-3.3-3.1-3.3-.3 0-.7 0-.9.1.4-1.6 1.7-3 3.4-3.8zm9.2 0c-3.1 1.4-5 4.2-5 7.6 0 2.8 1.7 4.6 4 4.6 2 0 3.5-1.5 3.5-3.4 0-1.9-1.3-3.3-3.1-3.3-.3 0-.7 0-.9.1.4-1.6 1.7-3 3.4-3.8z"
      fill="currentColor"
    />
  ),
}

function Icon({ name, size = 20, className = '', ...rest }) {
  const glyph = paths[name]
  if (!glyph) return null
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {glyph}
    </svg>
  )
}

/* ===== hooks/useScrollPosition.js ===== */
/** Tracks vertical scroll offset, throttled to one read per animation frame. */
function useScrollPosition() {
  const [y, setY] = useState(0)

  useEffect(() => {
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        setY(window.scrollY)
        frame = 0
      })
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      window.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [])

  return y
}

/* ===== data/site.js ===== */
/* ==========================================================================
   Bishnoi One — marketing site content
   Every string the site renders lives here so copy can change without
   touching a component.
   ========================================================================== */

const products = [
  {
    id: 'inventory',
    name: 'Inventory',
    short: 'Inventory',
    tagline: 'Always know what is in stock',
    icon: 'board',
    logo: '/home-export/images/Inventory.png',
    accent: 'blue',
    menuBlurb: 'Stock, orders and fulfilment in one place',
    headline: 'Every item and order, from shelf to doorstep',
    description:
      'Know what is in stock, what is on order and what is running late before the customer calls. Bishnoi One keeps stock and fulfilment moving without a spreadsheet in sight.',
    bullets: [
      'Live stock levels across every warehouse and branch',
      'One queue for online, phone and in-store orders',
      'Reorder alerts before a shelf runs empty',
    ],
    stat: { value: '98%', label: 'of orders delivered on time' },
  },
  {
    id: 'people',
    name: 'People',
    short: 'People',
    tagline: 'One record per person',
    icon: 'people',
    logo: '/home-export/images/People.png',
    accent: 'green',
    menuBlurb: 'Employee records, onboarding and time off',
    headline: 'Give every new hire a great first week',
    description:
      'From the offer letter to the one-year review, Bishnoi One carries the whole employee record, so nothing falls through the cracks between HR, IT and the hiring manager.',
    bullets: [
      'Onboarding plans that start themselves on day one',
      'Time off, documents and reviews in a single record',
      'Reminders that reach the right manager, not a shared inbox',
    ],
    stat: { value: '6 hrs', label: 'saved per new hire, every time' },
  },
  {
    id: 'crm',
    name: 'CRM',
    short: 'CRM',
    tagline: 'Close more, chase less',
    icon: 'pipeline',
    logo: '/home-export/images/CRM.png',
    accent: 'violet',
    menuBlurb: 'Contacts, pipeline and revenue forecasting',
    headline: 'Your pipeline, finally in focus',
    description:
      'Every deal, contact and follow-up in one place. Bishnoi One CRM keeps the next step obvious, so your reps spend the day selling instead of updating records.',
    bullets: [
      'Deal stages that match how your team actually sells',
      'Follow-ups scheduled the moment a stage changes',
      'Forecasts that update themselves, every night',
    ],
    stat: { value: '32%', label: 'shorter sales cycle on average' },
  },
  {
    id: 'analytics',
    name: 'Analytics',
    short: 'Analytics',
    tagline: 'Every number, live',
    icon: 'chart',
    logo: '/home-export/images/Analytics.png',
    accent: 'coral',
    menuBlurb: 'Live dashboards and reports across every system',
    headline: 'One dashboard for the whole company',
    description:
      'Analytics reads straight from the other seven systems, so sales, stock, people, cash and support sit on one screen, and the numbers are already up to date when you open it.',
    bullets: [
      'Ready-made dashboards for every department',
      'Reports that pull from all eight systems at once',
      'Scheduled summaries sent to leadership each morning',
    ],
    stat: { value: '0', label: 'spreadsheets stitched together by hand' },
  },
  {
    id: 'books',
    name: 'Books',
    short: 'Books',
    tagline: 'Bookkeeping, done daily',
    icon: 'board',
    logo: '/home-export/images/Books.png',
    accent: 'yellow',
    menuBlurb: 'Invoices, bills and day-to-day bookkeeping',
    headline: 'Invoices out, bills paid, books balanced',
    description:
      'Every sale from Inventory and CRM becomes an invoice automatically, and every bill is matched as it arrives, so month-end close takes hours instead of days.',
    bullets: [
      'Invoices raised the moment an order ships',
      'Bills and receipts matched to payments automatically',
      'Tax-ready ledgers that are always up to date',
    ],
    stat: { value: '3 days', label: 'faster month-end close' },
  },
  {
    id: 'finance',
    name: 'Finance',
    short: 'Finance',
    tagline: 'Plan with confidence',
    icon: 'chart',
    logo: '/home-export/images/Finance.png',
    accent: 'leaf',
    menuBlurb: 'Budgets, cash flow and financial planning',
    headline: 'Budgets and cash flow you can plan around',
    description:
      'Set budgets per department, watch spending against them as it happens, and see cash flow weeks ahead, built from the real numbers in Books.',
    bullets: [
      'Department budgets tracked against actual spend',
      'Cash flow forecasts that look weeks ahead',
      'Approvals that route spend to the right person',
    ],
    stat: { value: '13 wks', label: 'of cash flow visible ahead' },
  },
  {
    id: 'workdrive',
    name: 'WorkDrive',
    short: 'WorkDrive',
    tagline: 'Every file, one shared drive',
    icon: 'board',
    logo: '/home-export/images/WorkDrive.png',
    accent: 'violet',
    menuBlurb: 'Shared files, folders and document control',
    headline: 'Every file your team needs, in one shared drive',
    description:
      'Contracts, price lists, payslips and invoices land in the right team folder on their own, so everyone works from the latest version and nobody digs through email attachments again.',
    bullets: [
      'Team folders with access set by role, not by hand',
      'Version history on every file, with one-click restore',
      'Documents from the other systems filed automatically',
    ],
    stat: { value: '30 days', label: 'of version history on every file' },
  },
  {
    id: 'desk',
    name: 'Desk',
    short: 'Desk',
    tagline: 'Support that never drops a ticket',
    icon: 'people',
    logo: '/home-export/images/desk.png',
    accent: 'blue',
    menuBlurb: 'Customer support tickets and help desk',
    headline: 'Answer every customer, with their whole story in view',
    description:
      'Emails, calls and chats become tickets in one queue, and each one shows the customer’s orders, invoices and past conversations, so your team answers the first time.',
    bullets: [
      'One queue for email, phone and chat requests',
      'Order and invoice history beside every ticket',
      'Escalations that reach the right team before a deadline slips',
    ],
    stat: { value: '2x', label: 'faster first reply to customers' },
  },
]

/* The eight Bishnoi One systems, one per logo in public/. Drives the Products
   menu (desktop mega menu and mobile drawer). */
const systems = [
  { id: 'inventory', name: 'Inventory', logo: '/home-export/images/Inventory.png', href: '#/systems/inventory', blurb: 'Stock, orders and fulfilment in one place' },
  { id: 'people', name: 'People', logo: '/home-export/images/People.png', href: '#/systems/people', blurb: 'Employee records, onboarding and time off' },
  { id: 'crm', name: 'CRM', logo: '/home-export/images/CRM.png', href: '#/systems/crm', blurb: 'Contacts, pipeline and revenue forecasting' },
  { id: 'analytics', name: 'Analytics', logo: '/home-export/images/Analytics.png', href: '#/systems/analytics', blurb: 'Live dashboards and reports across every system' },
  { id: 'books', name: 'Books', logo: '/home-export/images/Books.png', href: '#showcase-books', blurb: 'Invoices, bills and day-to-day bookkeeping' },
  { id: 'finance', name: 'Finance', logo: '/home-export/images/Finance.png', href: '#showcase-finance', blurb: 'Budgets, cash flow and financial planning' },
  { id: 'workdrive', name: 'WorkDrive', logo: '/home-export/images/WorkDrive.png', href: '#showcase-workdrive', blurb: 'Shared files, folders and document control' },
  { id: 'desk', name: 'Desk', logo: '/home-export/images/desk.png', href: '#showcase-desk', blurb: 'Customer support tickets and help desk' },
]

const platformMenu = [
  { icon: 'automation', grad: ['#e57a44', '#251351'], title: 'Automations', slug: 'automations', blurb: 'If this happens, Bishnoi One does that. No code.' },
  { icon: 'chart', grad: ['#02c3bd', '#4e148c'], title: 'Dashboards', slug: 'dashboards', blurb: 'Live numbers your leadership team trusts.' },
  { icon: 'sparkle', grad: ['#ffc145', '#ec368d'], title: 'Bishnoi One AI', slug: 'ai', blurb: 'Drafts, summaries and next-step suggestions.' },
  { icon: 'puzzle', grad: ['#414288', '#b0db43'], title: 'Integrations', slug: 'integrations', blurb: '200+ tools connected in a couple of clicks.' },
  { icon: 'shield', grad: ['#007cbe', '#5fd3c4'], title: 'Security', slug: 'security', blurb: 'SOC 2 Type II, SSO and regional data storage.' },
  { icon: 'globe', grad: ['#629460', '#f4d35e'], title: 'Bishnoi One Mobile', slug: 'mobile', blurb: 'The whole platform, in a pocket-sized app.' },
]

const solutionsMenu = [
  { title: 'Startups', blurb: 'Run the whole company before you hire ops.' },
  { title: 'Agencies', blurb: 'Clients, projects and retainers side by side.' },
  { title: 'Professional services', blurb: 'Billable work, tracked to the hour.' },
  { title: 'Operations teams', blurb: 'Replace the spreadsheet graveyard.' },
  { title: 'Sales leaders', blurb: 'A forecast you can take to the board.' },
  { title: 'People teams', blurb: 'One home for the employee lifecycle.' },
]

const resourcesMenu = [
  { title: 'Blog', blurb: 'Playbooks from teams running on Bishnoi One' },
  { title: 'Help centre', blurb: 'Guides, answers and quick fixes' },
  { title: 'Templates', blurb: '180+ ready-made starting points' },
  { title: 'Webinars', blurb: 'Live sessions, twice a week' },
  { title: 'Customer stories', blurb: 'How other teams made the switch' },
  { title: 'Developers', blurb: 'API docs, SDKs and webhooks' },
  { title: 'About', blurb: 'Who we are and why Bishnoi One exists', href: '#/about' },
]

/* Departments shown under the hero. */
const departments = [
  'Regulatory',
  'Inlicensing',
  'Finance',
  'HR',
  'RX',
  'Hospital',
  'B2B',
  'Digital/IT',
]

const stats = [
  { value: 180, suffix: 'K+', label: 'teams run on Bishnoi One' },
  { value: 99.98, suffix: '%', label: 'platform uptime', decimals: 2 },
  { value: 200, suffix: '+', label: 'tools you can connect' },
  { value: 4.8, suffix: '/5', label: 'average customer rating', decimals: 1 },
]

const capabilities = [
  {
    icon: 'automation',
    accent: 'blue',
    title: 'Automate the boring half',
    body: 'Build a rule in plain language and Bishnoi One runs it forever. Assign the owner, send the reminder, move the stage, notify the channel.',
  },
  {
    icon: 'chart',
    accent: 'green',
    title: 'See everything at a glance',
    body: 'Pull any number from any corner of the platform into one live view. No exports, no stale slides, no Monday morning scramble.',
  },
  {
    icon: 'sparkle',
    accent: 'violet',
    title: 'Let Bishnoi One AI do the first draft',
    body: 'Summarise a long thread, draft the reply, suggest the next step. You stay in charge. Bishnoi One just removes the blank page.',
  },
  {
    icon: 'puzzle',
    accent: 'amber',
    title: 'Connect the tools you keep',
    body: 'Slack, Gmail, Outlook, Zoom, Xero, Stripe, GitHub and 190 more. Two clicks each, and the data flows both ways.',
  },
  {
    icon: 'shield',
    accent: 'sky',
    title: 'Enterprise grade from day one',
    body: 'SOC 2 Type II, GDPR, SSO and granular permissions come standard, not as a line item on an enterprise quote.',
  },
  {
    icon: 'bolt',
    accent: 'coral',
    title: 'Live in an afternoon',
    body: 'Start from a template, import your spreadsheet, invite the team. Most companies are fully running before the week is out.',
  },
]

const steps = [
  {
    number: '01',
    title: 'Pick a starting point',
    body: 'Choose one of 180 templates built for real teams, or start from a blank workspace and shape it yourself.',
  },
  {
    number: '02',
    title: 'Make it yours',
    body: 'Drag in the fields you need, name your stages, set who sees what. Everything is editable, none of it needs code.',
  },
  {
    number: '03',
    title: 'Invite everyone',
    body: 'Bring in your team, your clients and your contractors, each with the right level of access.',
  },
  {
    number: '04',
    title: 'Let it run',
    body: 'Automations handle the routine, dashboards keep leadership in the loop, and you get your afternoons back.',
  },
]

const testimonials = [
  {
    quote:
      'We replaced four tools and a wall of spreadsheets with Bishnoi One. Onboarding a new client used to take a week of coordination. It is now a single button.',
    name: 'Priya Raghavan',
    role: 'COO, Cascade Studio',
    company: 'Cascade',
    accent: 'blue',
    metric: { value: '11 hrs', label: 'saved per week, per manager' },
  },
  {
    quote:
      'Our forecast used to be a guess dressed up in a spreadsheet. Now the board sees the same live number we do, and nobody argues about whose version is right.',
    name: 'Daniel Okafor',
    role: 'VP Revenue, Meridian',
    company: 'Meridian',
    accent: 'green',
    metric: { value: '32%', label: 'shorter sales cycle' },
  },
  {
    quote:
      'I set up our entire onboarding flow on a Thursday afternoon. No IT ticket, no consultant, no three month implementation. It simply worked.',
    name: 'Hannah Lindqvist',
    role: 'Head of People, Lumen Labs',
    company: 'Lumen Labs',
    accent: 'violet',
    metric: { value: '1 day', label: 'from signup to fully live' },
  },
]

const pricing = {
  tiers: [
    {
      id: 'free',
      name: 'Free',
      tagline: 'For getting a feel for it',
      monthly: 0,
      yearly: 0,
      cta: 'Get started free',
      features: [
        'Up to 3 seats',
        'Unlimited items and docs',
        '2 workspaces',
        '200+ templates',
        'iOS and Android apps',
      ],
    },
    {
      id: 'basic',
      name: 'Basic',
      tagline: 'For small teams finding their rhythm',
      monthly: 11,
      yearly: 9,
      cta: 'Start free trial',
      features: [
        'Everything in Free',
        'Unlimited seats and viewers',
        '5GB file storage',
        'Priority customer support',
        'One dashboard per workspace',
      ],
    },
    {
      id: 'standard',
      name: 'Standard',
      tagline: 'The one most teams choose',
      monthly: 15,
      yearly: 12,
      cta: 'Start free trial',
      popular: true,
      features: [
        'Everything in Basic',
        'Timeline, calendar and map views',
        '250 automation runs per month',
        'Guest access for clients',
        'Dashboards across 5 workspaces',
      ],
    },
    {
      id: 'pro',
      name: 'Pro',
      tagline: 'For teams running the whole company',
      monthly: 24,
      yearly: 19,
      cta: 'Start free trial',
      features: [
        'Everything in Standard',
        '25,000 automation runs per month',
        'Private workspaces and docs',
        'Time tracking and approvals',
        'Dashboards across 20 workspaces',
      ],
    },
  ],
  enterprise: {
    name: 'Enterprise',
    blurb:
      'Advanced security, tailored onboarding and a named success manager. Built for organisations rolling Bishnoi One out to hundreds of people.',
    points: [
      'SSO, SCIM and audit logs',
      'Regional data residency',
      '99.9% uptime SLA',
      'Dedicated success manager',
    ],
  },
}

const faqs = [
  {
    q: 'How long does it take to get started?',
    a: 'Most teams are running the same day. Pick a template, import your existing spreadsheet, invite your team. The free plan needs no card and no call with sales.',
  },
  {
    q: 'Can I try Bishnoi One before paying?',
    a: 'Yes. Every paid plan comes with a 14 day trial of the full product, and the Free plan stays free for up to three seats with no time limit.',
  },
  {
    q: 'What counts as a seat?',
    a: 'Anyone who creates or edits work needs a seat. Viewers and clients you invite as guests are free on Standard and above, and never count towards your seat total.',
  },
  {
    q: 'Do you integrate with the tools we already use?',
    a: 'Bishnoi One connects to more than 200 tools including Slack, Gmail, Outlook, Zoom, Stripe, Xero, HubSpot and GitHub. Anything not on the list can be wired up through our open API.',
  },
  {
    q: 'How secure is my data?',
    a: 'Bishnoi One is SOC 2 Type II certified and GDPR compliant, with encryption in transit and at rest, SSO on every paid plan, and the option to store your data in the EU, US or Australia.',
  },
  {
    q: 'Can I change or cancel my plan later?',
    a: 'Any time, from your billing page. Upgrades apply immediately and downgrades take effect at the end of your current period. No phone call, no retention script.',
  },
]

/* Footer link columns. The Product column is built from `systems` (with
   their logos); these columns pair each link with a small line icon. */
const footerColumns = [
  {
    title: 'Solutions',
    links: [
      ['Startups', 'rocket'],
      ['Agencies', 'briefcase'],
      ['Professional services', 'user'],
      ['Operations', 'gear'],
      ['Sales teams', 'trend'],
      ['People teams', 'users'],
    ],
  },
  {
    title: 'Resources',
    links: [
      ['Blog', 'pen'],
      ['Help centre', 'help'],
      ['Templates', 'grid'],
      ['Webinars', 'video'],
      ['Customer stories', 'chat'],
      ['Developers', 'code'],
      ['Community', 'users'],
    ],
  },
  {
    title: 'Company',
    links: [
      ['About us', 'info', '#/about'],
      ['Careers', 'briefcase'],
      ['Press', 'news'],
      ['Partners', 'link'],
      ['Contact', 'mail'],
      ['Trust centre', 'shield'],
    ],
  },
]

/* ===== components/Navbar.jsx ===== */
const MENUS = [
  { id: 'products', label: 'Products' },
  { id: 'platform', label: 'Platform' },
  { id: 'solutions', label: 'Solutions' },
  { id: 'resources', label: 'Resources' },
]

function ProductsPanel({ onNavigate }) {
  return (
    <div className="mega mega--products">
      <div className="mega__main">
        <p className="mega__label">The Bishnoi One suite</p>
        <div className="mega__grid">
          {systems.map((system) => (
            <a key={system.id} className="mega-card" href={system.href} onClick={onNavigate}>
              <span className="mega-card__icon has-logo">
                <img src={system.logo} alt="" width="28" height="28" className="product-logo" decoding="async" />
              </span>
              <span className="mega-card__text">
                <span className="mega-card__title">
                  {system.name}
                  <Icon name="arrowRight" size={16} />
                </span>
                <span className="mega-card__blurb">{system.blurb}</span>
              </span>
            </a>
          ))}
        </div>
      </div>
      <aside className="mega__aside">
        <img
          className="mega__promo"
          src="/home-export/images/addone-menu.jpg"
          alt="Work smarter with a powerful system: automate workflows, manage your data, boost productivity and grow with confidence"
          width="600"
          height="800"
          decoding="async"
        />
        <a className="link-arrow" href="#/pricing">
          Compare plans <Icon name="arrowRight" size={16} />
        </a>
      </aside>
    </div>
  )
}

function PlatformPanel({ onNavigate }) {
  return (
    <div className="mega mega--platform">
      <div className="mega__grid mega__grid--three">
        {platformMenu.map((item) => (
          <a
            key={item.title}
            className="mega-card mega-card--plain"
            href={`#/platform/${item.slug}`}
            onClick={onNavigate}
          >
            <span
              className="mega-card__icon mega-card__icon--grad"
              style={{ '--g1': item.grad[0], '--g2': item.grad[1] }}
            >
              <Icon name={item.icon} size={20} />
            </span>
            <span className="mega-card__text">
              <span className="mega-card__title">{item.title}</span>
              <span className="mega-card__blurb">{item.blurb}</span>
            </span>
          </a>
        ))}
      </div>
      <div className="mega__footer">
        <span>New to Bishnoi One?</span>
        <a className="link-arrow" href="#/platform" onClick={onNavigate}>
          See the whole platform <Icon name="arrowRight" size={16} />
        </a>
      </div>
    </div>
  )
}

function SearchBar({ className = '' }) {
  return (
    <form
      className={`nav__search ${className}`}
      role="search"
      onSubmit={(event) => event.preventDefault()}
      onClick={(event) => event.currentTarget.querySelector('input')?.focus()}
    >
      <Icon name="search" size={18} />
      <input type="search" name="q" placeholder="Search Workspaces" aria-label="Search Workspaces" />
    </form>
  )
}

function ListPanel({ items, footer, onNavigate }) {
  return (
    <div className="mega mega--list">
      <div className="mega__grid mega__grid--three">
        {items.map((item) => (
          <a key={item.title} className="mega-link" href={item.href ?? '#platform'} onClick={onNavigate}>
            <span className="mega-card__title">{item.title}</span>
            <span className="mega-card__blurb">{item.blurb}</span>
          </a>
        ))}
      </div>
      {footer && <div className="mega__footer">{footer}</div>}
    </div>
  )
}

function Navbar() {
  const [openMenu, setOpenMenu] = useState(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [mobileSection, setMobileSection] = useState(null)
  const closeTimer = useRef(null)
  const scrollY = useScrollPosition()
  const isScrolled = scrollY > 12

  useEffect(() => {
    document.body.classList.toggle('is-locked', mobileOpen)
    return () => document.body.classList.remove('is-locked')
  }, [mobileOpen])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape') return
      setOpenMenu(null)
      setMobileOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* Hover intent: a short grace period stops the panel flickering shut when the
     pointer crosses the gap between the trigger and the panel. */
  const openWithIntent = (id) => {
    window.clearTimeout(closeTimer.current)
    setOpenMenu(id)
  }

  const closeWithIntent = () => {
    window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setOpenMenu(null), 140)
  }

  const renderPanel = (id) => {
    if (id === 'products') return <ProductsPanel onNavigate={() => setOpenMenu(null)} />
    if (id === 'platform') return <PlatformPanel onNavigate={() => setOpenMenu(null)} />
    if (id === 'solutions') return <ListPanel items={solutionsMenu} />
    if (id === 'resources')
      return (
        <ListPanel
          items={resourcesMenu}
          onNavigate={() => setOpenMenu(null)}
          footer={
            <>
              <span>Not sure where to start?</span>
              <a className="link-arrow" href="#how">
                Take the 3 minute tour <Icon name="arrowRight" size={16} />
              </a>
            </>
          }
        />
      )
    return null
  }

  return (
    <>
      <header className={`nav ${isScrolled ? 'is-scrolled' : ''}`} onMouseLeave={closeWithIntent}>
        <div className="nav__inner shell shell--wide">
          <a className="nav__brand" href="#top" aria-label="Bishnoi One home">
            <OrbitLogo variant="lockup" />
          </a>

          <nav className="nav__links" aria-label="Main">
            {MENUS.map((menu) => (
              <div
                key={menu.id}
                className="nav__item"
                onMouseEnter={() => openWithIntent(menu.id)}
                onFocus={() => openWithIntent(menu.id)}
              >
                <button
                  type="button"
                  className={`nav__trigger ${openMenu === menu.id ? 'is-open' : ''}`}
                  aria-expanded={openMenu === menu.id}
                  onClick={() => setOpenMenu(openMenu === menu.id ? null : menu.id)}
                >
                  {menu.label}
                  <Icon name="chevronDown" size={16} />
                </button>
              </div>
            ))}
            <a className="nav__trigger" href="#/pricing">
              Pricing
            </a>
          </nav>

          <SearchBar />

          <div className="nav__actions">
            <a className="btn btn--gradient btn--sm nav__login" href="#top">
              Log in
            </a>
            <button
              type="button"
              className="nav__burger"
              aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((open) => !open)}
            >
              <Icon name={mobileOpen ? 'close' : 'menu'} size={24} />
            </button>
          </div>
        </div>

        <div
          className={`nav__panel ${openMenu ? 'is-open' : ''}`}
          onMouseEnter={() => openWithIntent(openMenu)}
          onMouseLeave={closeWithIntent}
        >
          <div className="nav__panel-inner shell">{renderPanel(openMenu)}</div>
        </div>
      </header>

      {/* --- Mobile drawer --- */}
      {/* `inert` keeps the off-canvas links out of the tab order while hidden. */}
      <div
        className={`drawer ${mobileOpen ? 'is-open' : ''}`}
        aria-hidden={!mobileOpen}
        inert={mobileOpen ? undefined : ''}
      >
        <div className="drawer__scroll">
          <SearchBar className="nav__search--drawer" />
          <nav className="drawer__nav" aria-label="Mobile">
            {MENUS.map((menu) => {
              const items =
                menu.id === 'products'
                  ? systems.map((s) => ({ title: s.name, blurb: s.blurb, href: s.href }))
                  : menu.id === 'platform'
                    ? platformMenu
                    : menu.id === 'solutions'
                      ? solutionsMenu
                      : resourcesMenu
              const open = mobileSection === menu.id
              return (
                <div key={menu.id} className={`drawer__group ${open ? 'is-open' : ''}`}>
                  <button
                    type="button"
                    className="drawer__trigger"
                    aria-expanded={open}
                    onClick={() => setMobileSection(open ? null : menu.id)}
                  >
                    {menu.label}
                    <Icon name="chevronDown" size={20} />
                  </button>
                  <div className="drawer__sub">
                    {/* Single wrapper: the 0fr-to-1fr collapse only sizes one
                        grid row, so the links must share it. */}
                    <div className="drawer__sub-inner">
                      {items.map((item) => (
                        <a
                          key={item.title}
                          href={
                            menu.id === 'platform'
                              ? `#/platform/${item.slug}`
                              : (item.href ?? '#platform')
                          }
                          onClick={() => setMobileOpen(false)}
                        >
                          <strong>{item.title}</strong>
                          <span>{item.blurb}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
            <a className="drawer__trigger" href="#/pricing" onClick={() => setMobileOpen(false)}>
              Pricing
            </a>
          </nav>

          <div className="drawer__actions">
            <a className="btn btn--gradient btn--block btn--lg" href="#top" onClick={() => setMobileOpen(false)}>
              Log in
            </a>
          </div>
        </div>
      </div>
      <button
        type="button"
        className={`drawer__scrim ${mobileOpen ? 'is-open' : ''}`}
        aria-label="Close menu"
        inert={mobileOpen ? undefined : ''}
        onClick={() => setMobileOpen(false)}
      />
    </>
  )
}

/* ===== components/ui/HeroDemo.jsx ===== */
/**
 * Hero "video": a camera tours three connected Bishnoi One screens on a loop.
 * It zooms into the Operations board while two teammates work, glides along
 * the connection to Inventory, then to Analytics, pulls back to show all
 * three linked, and starts again. Purely visual: not clickable, not
 * focusable, hidden from screen readers.
 */

const H = 280 // design height of the viewport
const GAP = 190 // space between screens (holds the connection lines)

const STATUS = {
  new: { label: 'New', tone: 'grey' },
  working: { label: 'Working on it', tone: 'orange' },
  review: { label: 'In review', tone: 'blue' },
  stuck: { label: 'Stuck', tone: 'red' },
  done: { label: 'Done', tone: 'green' },
}

const START_ROWS = [
  { id: 'r1', item: 'Order #5521 · St. Luke’s', sys: 'crm', owner: ['MR', '#f36b21'], status: 'working', pct: 60, due: 'Today' },
  { id: 'r2', item: 'Payroll · November', sys: 'people', owner: ['JS', '#173f2a'], status: 'review', pct: 80, due: 'Fri' },
  { id: 'r3', item: 'Restock Paracetamol 500mg', sys: 'inventory', owner: ['AL', '#5a6dff'], status: 'stuck', pct: 30, due: 'Tomorrow' },
  { id: 'r4', item: 'Q4 marketing budget', sys: 'finance', owner: ['KC', '#59ba43'], status: 'done', pct: 100, due: 'Mon' },
]

const NEW_TEXT = 'Invoice INV-5531 · Mercury Clinic'

const STOCK = [
  { id: 'p1', name: 'Paracetamol 500mg', units: 120, pct: 14, tone: 'red' },
  { id: 'p2', name: 'Amoxicillin 250mg', units: 860, pct: 46, tone: 'orange' },
  { id: 'p3', name: 'Vitamin C 1000mg', units: 2140, pct: 72, tone: 'green' },
  { id: 'p4', name: 'Insulin pens', units: 410, pct: 88, tone: 'green' },
]

const CHART = [30, 42, 38, 55, 49, 66, 61, 74, 70, 86]

const initial = () => ({
  rows: START_ROWS.map((r) => ({ ...r })),
  newRow: null,
  done: 7,
  ordered: false,
  chart: false,
  tip: false,
  kpi: { revenue: 4.61, orders: 1236 },
  toast: null,
  cam: { screen: 0, target: null, zoom: 1 },
  ana: { x: -80, y: 120, click: 0 },
  mark: { x: -80, y: 320, click: 0 },
})

const wait = (ms, signal) =>
  new Promise((res, rej) => {
    const t = setTimeout(res, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      rej(new Error('stop'))
    })
  })

// Position of an element inside the track, ignoring CSS transforms.
function offsetIn(el, root) {
  let x = 0
  let y = 0
  let n = el
  while (n && n !== root) {
    x += n.offsetLeft
    y += n.offsetTop
    n = n.offsetParent
  }
  return { x, y, w: el.offsetWidth, h: el.offsetHeight }
}

function HeroDemo({ className = '' }) {
  const wrapRef = useRef(null)
  const trackRef = useRef(null)
  const [box, setBox] = useState({ scale: 1, w: 1100 })
  const [s, setS] = useState(initial)
  const [still, setStill] = useState(false)

  // Fit: fixed design height, width fills the band.
  useLayoutEffect(() => {
    const el = wrapRef.current
    const fit = () => {
      const { width, height } = el.getBoundingClientRect()
      const scale = Math.min(Math.max(height / H, 0.5), 1.25)
      setBox({ scale, w: width / scale })
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const SW = Math.round(Math.min(box.w - 70, 1040)) // screen width
  const SH = 244 // screen height
  const narrow = SW < 760
  const screenX = (i) => i * (SW + GAP)

  // Camera: centre the viewport on a screen or element, at a zoom level.
  const camFocus = (() => {
    const { screen, target, zoom } = s.cam
    let fx = screenX(screen) + SW / 2
    let fy = SH / 2
    if (target === 'all') fx = screenX(1) + SW / 2
    else if (target && trackRef.current) {
      const el = trackRef.current.querySelector(`[data-t="${target}"]`)
      if (el) {
        const o = offsetIn(el, trackRef.current)
        fx = o.x + o.w / 2
        fy = o.y + o.h / 2
      }
    }
    // Keep zoomed-in views from showing past the screen's edges.
    if (zoom > 1) {
      const halfW = box.w / 2 / zoom
      const halfH = H / 2 / zoom
      const left = screenX(screen)
      fx = Math.min(Math.max(fx, left + halfW - 20), left + SW - halfW + 20)
      fy = Math.min(Math.max(fy, halfH - 18), SH - halfH + 18)
    }
    return { fx, fy, zoom }
  })()

  // The looping script.
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setStill(true)
      return
    }
    const ctrl = new AbortController()
    const sig = ctrl.signal
    const set = (fn) => setS((p) => ({ ...p, ...fn(p) }))
    const at = (target) => {
      const root = trackRef.current
      const el = root?.querySelector(`[data-t="${target}"]`)
      if (!el) return null
      const o = offsetIn(el, root)
      return { x: o.x + o.w * 0.55, y: o.y + o.h * 0.6 }
    }
    const move = async (who, target, ms = 1000) => {
      const p = at(target)
      if (p) set((st) => ({ [who]: { ...st[who], ...p } }))
      await wait(ms, sig)
    }
    const click = async (who) => {
      set((st) => ({ [who]: { ...st[who], click: st[who].click + 1 } }))
      await wait(280, sig)
    }
    const cam = (screen, target = null, zoom = 1) => set(() => ({ cam: { screen, target, zoom } }))
    const row = (id, patch) => set((p) => ({ rows: p.rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) }))
    const toast = (text) => set(() => ({ toast: { text, key: Math.random() } }))
    const tween = async (from, to, ms, apply) => {
      const steps = 16
      for (let i = 1; i <= steps; i++) {
        apply(from + ((to - from) * i) / steps)
        await wait(ms / steps, sig)
      }
    }

    const run = async () => {
      for (;;) {
        // --- Screen 1: Operations board --------------------------------
        setS(initial())
        await wait(700, sig)
        cam(0, 'col-status', 1.3)
        await wait(500, sig)
        await move('ana', 'status-r3', 1100)
        await click('ana')
        row('r3', { status: 'working', pct: 55 })
        await wait(700, sig)
        await move('ana', 'status-r2', 900)
        await click('ana')
        row('r2', { status: 'done', pct: 100 })
        set((p) => ({ done: p.done + 1 }))
        toast('Payslips released in People')
        await wait(900, sig)

        cam(0, null, 1)
        await move('mark', 'add', 1300)
        await click('mark')
        set(() => ({ newRow: { text: '', status: 'new', pct: 0 } }))
        cam(0, 'row-new', 1.3)
        await wait(450, sig)
        for (let i = 1; i <= NEW_TEXT.length; i++) {
          set((p) => ({ newRow: { ...p.newRow, text: NEW_TEXT.slice(0, i) } }))
          await wait(34, sig)
        }
        await move('ana', 'status-new', 900)
        await click('ana')
        set((p) => ({ newRow: { ...p.newRow, status: 'working', pct: 25 } }))
        toast('Restock request sent to Inventory')
        await wait(900, sig)

        // --- Glide along the connection to Inventory --------------------
        cam(0, null, 0.82)
        await wait(700, sig)
        cam(1, null, 0.82)
        await wait(1400, sig)
        cam(1, null, 1)
        await wait(600, sig)
        await move('ana', 'reorder-p1', 1100)
        cam(1, 'tile-p1', 1.35)
        await wait(500, sig)
        await click('ana')
        set(() => ({ ordered: true }))
        toast('Purchase order PO-2292 created')
        await wait(1500, sig)

        // --- Glide to Analytics -----------------------------------------
        cam(1, null, 0.82)
        await wait(700, sig)
        cam(2, null, 0.82)
        set(() => ({ chart: true }))
        await wait(1400, sig)
        cam(2, null, 1)
        await tween(4.61, 4.82, 900, (v) => set((p) => ({ kpi: { ...p.kpi, revenue: v } })))
        await tween(1236, 1284, 700, (v) => set((p) => ({ kpi: { ...p.kpi, orders: Math.round(v) } })))
        await move('mark', 'point', 1100)
        cam(2, 'point', 1.3)
        set(() => ({ tip: true }))
        await wait(1700, sig)

        // --- Pull back: all three screens, connected --------------------
        cam(1, 'all', Math.min(0.6, box.w / (SW * 3 + GAP * 2 + 60)))
        await wait(2600, sig)
        cam(0, null, 0.82)
        await wait(1300, sig)
      }
    }
    run().catch(() => {})
    return () => ctrl.abort()
    // The script restarts if the band is resized (screen sizes change).
  }, [SW, box.w])

  const byId = Object.fromEntries(systems.map((x) => [x.id, x]))
  const allRows = s.newRow
    ? [...s.rows, { id: 'new', item: s.newRow.text, sys: 'books', owner: ['AB', '#c4500f'], status: s.newRow.status, pct: s.newRow.pct, due: 'Next week', typing: true }]
    : s.rows

  const chartPath = CHART.map((v, i) => `${i ? 'L' : 'M'}${(i / (CHART.length - 1)) * 100},${100 - v}`).join(' ')

  const Cursor = ({ who, name, color }) => (
    <div className="demo__cursor" style={{ transform: `translate(${s[who].x}px, ${s[who].y}px)`, '--c': color }}>
      <span key={s[who].click} className={`demo__ripple ${s[who].click ? 'is-on' : ''}`} />
      <svg width="18" height="20" viewBox="0 0 18 20">
        <path d="M1 1l15 7.2-6.6 1.9-3.1 6.4z" fill={color} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="demo__name">{name}</span>
    </div>
  )

  const Side = ({ active }) => (
    <aside className="demo__side">
      <span className="demo__logo" />
      {systems.map((x) => (
        <span key={x.id} className={`demo__nav ${x.id === active ? 'is-on' : ''}`}>
          <img src={x.logo} alt="" width="18" height="18" />
        </span>
      ))}
    </aside>
  )

  const { fx, fy, zoom } = camFocus

  return (
    <div className={`helix demo ${className}`.trim()} ref={wrapRef} aria-hidden="true">
      <div className="demo__viewport" style={{ width: box.w, height: H, transform: `scale(${box.scale})` }}>
        <div
          ref={trackRef}
          className={`demo__track ${narrow ? 'is-narrow' : ''}`}
          style={{ transform: `translate(${box.w / 2}px, ${H / 2}px) scale(${zoom}) translate(${-fx}px, ${-fy}px)` }}
        >
          {/* Screen 1 — Operations board */}
          <div className="demo__window" style={{ left: screenX(0), width: SW, height: SH }}>
            <Side active="crm" />
            <div className="demo__main">
              <header className="demo__head">
                <div>
                  <b>Operations board</b>
                  <small>This week · 8 systems connected</small>
                </div>
                <div className="demo__head-right">
                  <span className="demo__count">
                    <b key={s.done}>{s.done}</b> done this week
                  </span>
                  <span className="demo__add" data-t="add">
                    + New item
                  </span>
                </div>
              </header>
              <div className="demo__table">
                <div className="demo__row demo__row--head">
                  <span>Item</span>
                  <span className="demo__col-owner">Owner</span>
                  <span data-t="col-status">Status</span>
                  <span className="demo__col-progress">Progress</span>
                  <span className="demo__col-due">Due</span>
                </div>
                {allRows.map((r) => (
                  <div key={r.id} className={`demo__row ${r.typing ? 'is-new' : ''}`} data-t={r.typing ? 'row-new' : undefined}>
                    <span className="demo__item">
                      <img src={byId[r.sys]?.logo} alt="" width="14" height="14" />
                      <span>
                        {r.item}
                        {r.typing && r.item.length < NEW_TEXT.length && <span className="demo__caret" />}
                      </span>
                    </span>
                    <span className="demo__col-owner">
                      <i className="demo__owner" style={{ background: r.owner[1] }}>
                        {r.owner[0]}
                      </i>
                    </span>
                    <span>
                      <span key={r.status} className={`demo__status demo__status--${STATUS[r.status].tone}`} data-t={`status-${r.id}`}>
                        {STATUS[r.status].label}
                      </span>
                    </span>
                    <span className="demo__col-progress">
                      <span className="demo__bar">
                        <span style={{ width: `${r.pct}%` }} />
                      </span>
                      <small>{r.pct}%</small>
                    </span>
                    <span className="demo__col-due">{r.due}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Connection 1 → 2 */}
          <div className="demo__link" style={{ left: screenX(0) + SW, width: GAP, top: SH / 2 }}>
            <span className="demo__link-line" />
            <span className="demo__link-dot" />
            <span className="demo__link-dot" style={{ animationDelay: '-0.9s' }} />
            <span className="demo__link-pill">Orders → Stock</span>
          </div>

          {/* Screen 2 — Inventory */}
          <div className="demo__window" style={{ left: screenX(1), width: SW, height: SH }}>
            <Side active="inventory" />
            <div className="demo__main">
              <header className="demo__head">
                <div>
                  <b>Inventory · Manila DC</b>
                  <small>4 products need attention</small>
                </div>
                <span className="demo__chip">Stock value ₱18.6M</span>
              </header>
              <div className="demo__tiles">
                {STOCK.map((p) => {
                  const done = p.id === 'p1' && s.ordered
                  return (
                    <div key={p.id} className={`demo__tile ${done ? 'is-done' : ''}`} data-t={`tile-${p.id}`}>
                      <img src={byId.inventory?.logo} alt="" width="16" height="16" />
                      <b>{p.name}</b>
                      <small>{done ? 'Arriving Thursday' : `${p.units.toLocaleString()} units`}</small>
                      <span className={`demo__meter demo__meter--${done ? 'green' : p.tone}`}>
                        <span style={{ width: `${done ? 100 : p.pct}%` }} />
                      </span>
                      {p.id === 'p1' ? (
                        <span className={`demo__btn ${done ? 'is-done' : ''}`} data-t="reorder-p1">
                          {done ? '✓ Ordered' : 'Reorder'}
                        </span>
                      ) : (
                        <span className="demo__ok">In stock</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* Connection 2 → 3 */}
          <div className="demo__link" style={{ left: screenX(1) + SW, width: GAP, top: SH / 2 }}>
            <span className="demo__link-line" />
            <span className="demo__link-dot" />
            <span className="demo__link-dot" style={{ animationDelay: '-0.9s' }} />
            <span className="demo__link-pill">Stock → Reports</span>
          </div>

          {/* Screen 3 — Analytics */}
          <div className="demo__window" style={{ left: screenX(2), width: SW, height: SH }}>
            <Side active="analytics" />
            <div className="demo__main">
              <header className="demo__head">
                <div>
                  <b>Analytics · This month</b>
                  <small>Live from all eight systems</small>
                </div>
                <span className="demo__chip demo__chip--live">● Live</span>
              </header>
              <div className="demo__kpis">
                <div className="demo__kpi">
                  <small>Revenue</small>
                  <b>₱{s.kpi.revenue.toFixed(2)}M</b>
                </div>
                <div className="demo__kpi">
                  <small>Orders</small>
                  <b>{s.kpi.orders.toLocaleString()}</b>
                </div>
                <div className="demo__kpi">
                  <small>Tasks done</small>
                  <b>{s.done}</b>
                </div>
              </div>
              <div className={`demo__chart ${s.chart ? 'is-on' : ''}`}>
                <svg viewBox="0 0 100 100" preserveAspectRatio="none">
                  <path d={`${chartPath} L100,100 L0,100 Z`} className={`demo__area ${s.chart ? 'is-on' : ''}`} />
                  <path d={chartPath} className={`demo__line ${s.chart ? 'is-on' : ''}`} />
                </svg>
                <span className="demo__point" data-t="point" style={{ left: '77.7%', top: `${100 - CHART[7]}%` }} />
                <span className={`demo__tip ${s.tip ? 'is-on' : ''}`} style={{ left: '77.7%', top: `${100 - CHART[7]}%` }}>
                  <b>Week 8</b> Orders up 18%
                </span>
              </div>
            </div>
          </div>

          {!still && (
            <>
              <Cursor who="mark" name="Mark · Finance" color="#173f2a" />
              <Cursor who="ana" name="Ana · Operations" color="#f36b21" />
            </>
          )}
        </div>
      </div>

      {s.toast && (
        <div key={s.toast.key} className="demo__toast">
          <span className="demo__toast-dot" /> {s.toast.text}
        </div>
      )}
    </div>
  )
}

/* ===== components/Hero.jsx ===== */
// Team faces shown beside the headline, each on a brand accent colour.
// x/y shift each photo so the head sits in the centre of its circle.
const TEAM = [
  { img: '/home-export/images/MAMMALOU.png', bg: '#5a6dff', x: '-74.8%', y: '-4.8%' },
  { img: '/home-export/images/MAMVAN.png', bg: '#ffd900', x: '-82%', y: '-9.6%' },
  { img: '/home-export/images/SIRJAVED.png', bg: '#fd4040', x: '-72.4%', y: '-4.8%' },
  { img: '/home-export/images/SIRSUBIR.png', bg: '#59ba43', x: '-72.4%', y: '-9.6%' },
]

/* Hero: a large headline with the system logos stacked inline, a short
   promise and call to action on the right, then a wide band
   showing the systems connected by flowing data. */
function Hero() {
  return (
    <section className="hero" id="top">
      <div className="shell shell--wide">
        <div className="hero__top">
          <h1 className="hero__title">
            Run your whole company
            <br />
            <span className="hero__accent">in one place</span>
            <br />
            <span className="hero__line3">
              <span className="hero__stack" aria-hidden="true">
                {TEAM.map((p, i) => (
                  <span key={p.img} className="hero__face" style={{ '--i': i, '--bg': p.bg, '--x': p.x, '--y': p.y }}>
                    <img src={p.img} alt="" width="80" height="80" />
                  </span>
                ))}
              </span>
              from one login
            </span>
          </h1>

          <div className="hero__aside">
            <p className="hero__lead">
              Eight connected systems for stock, people, customers, reporting, books, finance, files and support. Set
              Bishnoi One up in an afternoon.
            </p>
            <a className="hero__cta" href="#cta">
              Get started free
              <span className="hero__cta-icon">
                <Icon name="arrowUpRight" size={16} />
              </span>
            </a>
            <p className="hero__fineprint">Free forever plan · No credit card</p>
          </div>
        </div>

        <div className="hero__stage">
          <HeroDemo className="hero__helix" />
        </div>

        <div className="hero__trust">
          <p className="hero__trust-label">Built for every department</p>
          <ul className="hero__trust-logos">
            {departments.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ===== hooks/useInView.js ===== */
/**
 * Adds an IntersectionObserver to a node and reports the first time it enters
 * the viewport. Used by every scroll-reveal on the site, so it stays cheap:
 * one observer per node, disconnected as soon as it has fired.
 */
function useInView({ threshold = 0.18, rootMargin = '0px 0px -10% 0px', once = true } = {}) {
  const ref = useRef(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return

    if (typeof IntersectionObserver === 'undefined') {
      setInView(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true)
          if (once) observer.disconnect()
        } else if (!once) {
          setInView(false)
        }
      },
      { threshold, rootMargin },
    )

    observer.observe(node)
    return () => observer.disconnect()
  }, [threshold, rootMargin, once])

  return [ref, inView]
}

/* ===== components/SystemsRail.jsx ===== */
/* "Every department, one platform": the eight systems as a sliding row of
   cards in alternating brand styles. Arrow buttons and dots move the row;
   it can also be dragged or swiped. */
const STYLES = ['orange', 'light', 'forest', 'light']

function SystemsRail() {
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [sectionRef, inView] = useInView({ threshold: 0.2 })

  // Keep the dots in sync with the scroll position.
  useEffect(() => {
    const track = trackRef.current
    if (!track) return
    const onScroll = () => {
      const card = track.firstElementChild
      if (!card) return
      const step = card.getBoundingClientRect().width + 16
      setIndex(Math.min(products.length - 1, Math.round(track.scrollLeft / step)))
    }
    track.addEventListener('scroll', onScroll, { passive: true })
    return () => track.removeEventListener('scroll', onScroll)
  }, [])

  const go = (to) => {
    const track = trackRef.current
    const card = track?.children[to]
    if (!card) return
    track.scrollTo({ left: card.offsetLeft - track.firstElementChild.offsetLeft, behavior: 'smooth' })
  }

  return (
    <section className={`rail ${inView ? 'is-in' : ''}`} id="systems" ref={sectionRef}>
      <div className="shell shell--wide rail__head">
        <h2 className="rail__title">
          Every department,
          <span className="rail__title-2">
            <em>one connected</em> platform
          </span>
        </h2>

        <div className="rail__side">
          <p>
            Start with the system your team needs today. Add the rest whenever you are ready — they
            share one record from the very first day.
          </p>
          <div className="rail__controls">
            <div className="rail__dots" role="tablist" aria-label="Choose a system">
              {products.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={i === index}
                  aria-label={p.name}
                  className={i === index ? 'is-active' : ''}
                  onClick={() => go(i)}
                />
              ))}
            </div>
            <div className="rail__arrows">
              <button
                type="button"
                className="rail__arrow"
                aria-label="Previous system"
                disabled={index === 0}
                onClick={() => go(Math.max(0, index - 1))}
              >
                <Icon name="arrowLeft" size={18} />
              </button>
              <button
                type="button"
                className="rail__arrow rail__arrow--next"
                aria-label="Next system"
                disabled={index === products.length - 1}
                onClick={() => go(Math.min(products.length - 1, index + 1))}
              >
                <Icon name="arrowRight" size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>

      <ul className="rail__track" ref={trackRef}>
        {products.map((p, i) => (
          <li
            key={p.id}
            className={`rail__card rail__card--${STYLES[i % STYLES.length]}`}
            style={{ '--i': i }}
          >
            <div className="rail__card-top">
              <span className="rail__logo">
                <img src={p.logo} alt="" width="30" height="30" />
              </span>
              <h3>{p.name}</h3>
              <p className="rail__tagline">{p.tagline}</p>
            </div>
            <div className="rail__card-bottom">
              <p>{p.menuBlurb}.</p>
              <div className="rail__card-foot">
                <a className="rail__go" href={`#showcase-${p.id}`} aria-label={`Open ${p.name}`}>
                  <Icon name="arrowUpRight" size={16} />
                </a>
                <a className="rail__more" href={`#showcase-${p.id}`}>
                  Learn more
                </a>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

/* ===== components/ui/SystemDemo.jsx ===== */
/* A small, scripted "live" board for each system in the showcase. Two team
   cursors (with name tags, like a multiplayer design tool) move around
   and do that system's everyday job: reorder stock, approve time off, move a
   deal, send an invoice and so on. Pure illustration — nothing is real. */

const PEOPLE = {
  mark: { name: 'Mark', c: '#5a6dff', d: '0s' },
  john: { name: 'John', c: '#ffd900', ci: '#1a1a1a', d: '-0.8s' },
  joshua: { name: 'Joshua', c: '#fd4040', d: '-1.4s' },
  angel: { name: 'Angel', c: '#3e8e2d', d: '-2s' },
  jane: { name: 'Jane', c: '#f36b21', d: '-0.5s' },
  kate: { name: 'Kate', c: '#173f2a', d: '-1.1s' },
}

const Chip = ({ tone, children }) => (
  <span className="sd__chip" data-tone={tone}>
    {children}
  </span>
)

const Bar = ({ pct, low, t }) => (
  <span className={`sd__bar ${low ? 'is-low' : ''}`} data-t={t}>
    <i style={{ width: `${pct}%` }} />
  </span>
)

// Owner avatar: initial on the person's colour.
const Av = ({ k }) => (
  <span className="sd__av" style={{ '--c': PEOPLE[k].c, '--ci': PEOPLE[k].ci || '#fff' }}>
    {PEOPLE[k].name[0]}
  </span>
)

/* Small extra table under each board: a header row in the group colour,
   then [title, sub, owner, middle, chip tone, chip label] rows. */
const MiniTable = ({ title, grp, cols, head, rows }) => (
  <div className="sd__table" style={{ '--cols': cols, '--grp': grp }}>
    <div className="sd__tr sd__th">
      <span className="sd__grp">{title}</span>
      <span>Owner</span>
      <span>{head}</span>
      <span>Status</span>
    </div>
    {rows.map(([name, sub, who, mid, tone, label]) => (
      <div key={name} className="sd__tr">
        <span><b>{name}</b>{sub ? <small>{sub}</small> : null}</span>
        <span><Av k={who} /></span>
        <span>{mid}</span>
        <span><Chip tone={tone}>{label}</Chip></span>
      </div>
    ))}
  </div>
)

/* --- Scenes ------------------------------------------------------------ */
const SCENES = {
  inventory: {
    nav: ['Dashboard', 'Items', 'Orders', 'Purchases', 'Warehouses'],
    on: 1,
    title: 'Items',
    action: '+ New item',
    people: ['mark', 'joshua'],
    init: { msg: 'Watching stock across 3 branches' },
    scripts: [
      [
        { to: 'r0', fx: 0.3, wait: 250 },
        { to: 'reorder', click: 1, set: { ordered: 1, msg: 'PO-2041 sent to MedSupply Co.' }, wait: 1700 },
      ],
      [
        { wait0: 1700 },
        { to: 'r2', fx: 0.3, wait: 250 },
        { to: 'receive', click: 1, set: { received: 1, msg: 'Vitamin C delivery received' }, wait: 700 },
        { to: 'bar2', fx: 0.8, wait: 600 },
      ],
    ],
    View: ({ st }) => (
      <>
        <div className="sd__table" style={{ '--cols': '1.7fr 46px 1fr 0.95fr 68px', '--grp': '#5a6dff' }}>
          <div className="sd__tr sd__th">
            <span className="sd__grp">Pharmacy stock</span>
            <span>Owner</span>
            <span>Stock</span>
            <span>Status</span>
            <span />
          </div>
          <div className="sd__tr" data-t="r0">
            <span><b>Paracetamol 500mg</b><small>PCM-500 · 8 boxes</small></span>
            <span><Av k="mark" /></span>
            <span><Bar pct={8} low /></span>
            <span>{st.ordered ? <Chip tone="blue">On order</Chip> : <Chip tone="red">Low</Chip>}</span>
            <span><span className={`sd__btn ${st.ordered ? 'is-done' : ''}`} data-t="reorder">{st.ordered ? 'PO-2041' : 'Reorder'}</span></span>
          </div>
          <div className="sd__tr">
            <span><b>Amoxicillin 250mg</b><small>AMX-250 · 310 boxes</small></span>
            <span><Av k="kate" /></span>
            <span><Bar pct={62} /></span>
            <span><Chip tone="green">In stock</Chip></span>
            <span />
          </div>
          <div className="sd__tr" data-t="r2">
            <span><b>Vitamin C 1000mg</b><small>VTC-1K · {st.received ? '440' : '230'} boxes</small></span>
            <span><Av k="joshua" /></span>
            <span><Bar pct={st.received ? 88 : 46} t="bar2" /></span>
            <span>{st.received ? <Chip tone="green">Received</Chip> : <Chip tone="yellow">Arriving</Chip>}</span>
            <span><span className={`sd__btn is-ghost ${st.received ? 'is-done' : ''}`} data-t="receive">{st.received ? 'Done' : 'Receive'}</span></span>
          </div>
          <div className="sd__tr">
            <span><b>Cetirizine 10mg</b><small>CTZ-10 · 205 boxes</small></span>
            <span><Av k="angel" /></span>
            <span><Bar pct={71} /></span>
            <span><Chip tone="green">In stock</Chip></span>
            <span />
          </div>
          <div className="sd__tr">
            <span><b>Ibuprofen 400mg</b><small>IBU-400 · 96 boxes</small></span>
            <span><Av k="jane" /></span>
            <span><Bar pct={34} /></span>
            <span><Chip tone="yellow">Reorder soon</Chip></span>
            <span />
          </div>
        </div>
        <MiniTable
          title="Purchase orders"
          grp="#f36b21"
          cols="1.7fr 46px 1fr 1fr"
          head="Units"
          rows={[
            ['PO-2041', 'MedSupply Co.', 'mark', st.ordered ? '200' : '—', st.ordered ? 'blue' : undefined, st.ordered ? 'Sent' : 'Draft'],
            ['PO-2038', 'PharmaHub', 'joshua', '220', 'yellow', 'In transit'],
          ]}
        />
      </>
    ),
  },

  people: {
    nav: ['Home', 'Employees', 'Onboarding', 'Time off', 'Reviews'],
    on: 2,
    title: 'Onboarding',
    action: '+ New hire',
    people: ['john', 'angel'],
    init: { c0: 1, c1: 1, msg: 'Preparing Ria’s first week' },
    scripts: [
      [
        { to: 'c2', click: 1, set: { c2: 1 }, wait: 650 },
        { to: 'c3', click: 1, set: { c3: 1, msg: 'Ria is ready for day one' }, wait: 1200 },
      ],
      [
        { wait0: 1900 },
        { to: 'approve', click: 1, set: { approved: 1, msg: 'Time off approved for Leo' }, wait: 800 },
      ],
    ],
    View: ({ st }) => {
      const tasks = [
        ['Offer signed', 'angel', 'Nov 28', 'c0'],
        ['Contract filed', 'john', 'Nov 29', 'c1'],
        ['Laptop shipped', 'john', 'Dec 1', 'c2'],
        ['Week one plan', 'angel', 'Dec 2', 'c3'],
      ]
      const cols = { '--cols': '1.6fr 46px 0.8fr 1fr 62px' }
      return (
        <>
          <div className="sd__table" style={{ ...cols, '--grp': '#3e8e2d' }}>
            <div className="sd__tr sd__th">
              <span className="sd__grp">Ria Santos · onboarding</span>
              <span>Owner</span>
              <span>Due</span>
              <span>Status</span>
              <span />
            </div>
            {tasks.map(([task, who, due, key], i) => (
              <div key={task} className="sd__tr">
                <span><b>{task}</b></span>
                <span><Av k={who} /></span>
                <span>{due}</span>
                <span data-t={key}>
                  {st[key] ? <Chip tone="green">Done</Chip> : i === 2 ? <Chip tone="yellow">Working on it</Chip> : <Chip>Not started</Chip>}
                </span>
                <span />
              </div>
            ))}
          </div>
          <div className="sd__table" style={{ ...cols, '--grp': '#5a6dff' }}>
            <div className="sd__tr sd__th">
              <span className="sd__grp">Time off requests</span>
              <span>Owner</span>
              <span>Days</span>
              <span>Status</span>
              <span />
            </div>
            <div className="sd__tr">
              <span><b>Leo Cruz</b><small>Dec 4 – 5</small></span>
              <span><Av k="mark" /></span>
              <span>2 days</span>
              <span>{st.approved ? <Chip tone="green">Approved</Chip> : <Chip tone="yellow">Pending</Chip>}</span>
              <span><span className={`sd__btn ${st.approved ? 'is-done' : ''}`} data-t="approve">{st.approved ? 'Done' : 'Approve'}</span></span>
            </div>
            <div className="sd__tr">
              <span><b>Ana Reyes</b><small>Dec 12</small></span>
              <span><Av k="jane" /></span>
              <span>1 day</span>
              <span><Chip tone="green">Approved</Chip></span>
              <span />
            </div>
          </div>
          <MiniTable
            title="Performance reviews"
            grp="#f36b21"
            cols="1.6fr 46px 0.8fr 1fr"
            head="Due"
            rows={[
              ['Carlo Mendoza', 'Sales · Q4', 'kate', 'Dec 8', 'yellow', 'In review'],
            ]}
          />
        </>
      )
    },
  },

  crm: {
    nav: ['Leads', 'Deals', 'Contacts', 'Forecast', 'Reports'],
    on: 1,
    title: 'Deals pipeline',
    action: '+ New deal',
    people: ['joshua', 'kate'],
    init: { msg: 'Updating the sales pipeline' },
    scripts: [
      [
        { to: 'd-acme', wait: 250 },
        { click: 1, carry: 'Acme Pharma · ₱120k', set: { lift_acme: 1 }, wait: 120 },
        { to: 'col-won', fy: 0.62, move: 1000 },
        { click: 1, carry: null, set: { acme: 'won', lift_acme: 0, msg: 'Acme Pharma moved to Won' }, wait: 900 },
      ],
      [
        { wait0: 2900 },
        { to: 'd-zen', wait: 200 },
        { click: 1, carry: 'Zen Clinic · ₱64k', set: { lift_zen: 1 }, wait: 120 },
        { to: 'col-prop', fy: 0.75, move: 900 },
        { click: 1, carry: null, set: { zen: 'prop', lift_zen: 0 }, wait: 600 },
      ],
    ],
    View: ({ st }) => {
      const deals = [
        { id: 'zen', name: 'Zen Clinic', amt: 64, col: st.zen || 'qual' },
        { id: 'lab', name: 'LabOne', amt: 42, col: 'qual' },
        { id: 'acme', name: 'Acme Pharma', amt: 120, col: st.acme || 'prop' },
        { id: 'north', name: 'North Hospital', amt: 210, col: 'prop' },
        { id: 'mega', name: 'MegaDrug', amt: 88, col: 'won' },
      ]
      const cols = [['qual', 'Qualified'], ['prop', 'Proposal'], ['won', 'Won']]
      return (
        <>
        <div className="sd__cols">
          {cols.map(([key, label]) => {
            const list = deals.filter((d) => d.col === key)
            const sum = list.reduce((a, d) => a + d.amt, 0)
            return (
              <div key={key} className="sd__col" data-t={`col-${key}`} data-won={key === 'won' || undefined}>
                <h6>
                  {label}
                  <span key={sum}>₱{sum}k</span>
                </h6>
                {list.map((d) =>
                  st[`lift_${d.id}`] ? (
                    <div key={d.id} className="sd__deal is-ghost" />
                  ) : (
                    <div key={`${d.id}-${d.col}`} className="sd__deal" data-t={`d-${d.id}`}>
                      {d.name}
                      <small>₱{d.amt}k</small>
                    </div>
                  ),
                )}
              </div>
            )
          })}
        </div>
        <MiniTable
          title="Next follow-ups"
          grp="#5a6dff"
          cols="1.6fr 46px 0.9fr 1fr"
          head="When"
          rows={[
            ['North Hospital', 'Send revised quote', 'kate', 'Today', 'red', 'Due today'],
            ['Zen Clinic', 'Product demo', 'joshua', 'Thu', 'blue', 'Booked'],
          ]}
        />
        </>
      )
    },
  },

  analytics: {
    nav: ['Overview', 'Sales', 'Stock', 'People', 'Finance'],
    on: 0,
    title: 'Company overview',
    action: 'Share report',
    people: ['angel', 'jane'],
    init: { msg: 'Reading live numbers from every system' },
    scripts: [
      [
        { to: 'month', click: 1, set: { range: 'month' }, wait: 1000 },
        { to: 'bar6', fy: 0.25, set: { tip: 6 }, wait: 1300 },
      ],
      [
        { wait0: 2600 },
        { to: 'action', click: 1, set: { msg: 'Report sent to leadership' }, wait: 1800 },
      ],
    ],
    View: ({ st }) => {
      const month = st.range === 'month'
      const vals = month ? [55, 62, 58, 70, 74, 82, 94] : [42, 58, 50, 72, 64, 80, 76]
      const labels = month ? ['Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] : ['M', 'T', 'W', 'T', 'F', 'S', 'S']
      return (
        <>
          <div className="sd__chart">
            <div className="sd__chart-head">
              <b>Sales</b>
              <span className="sd__seg">
                <span className={!month ? 'is-on' : ''} data-t="week">Week</span>
                <span className={month ? 'is-on' : ''} data-t="month">Month</span>
              </span>
            </div>
            <div className="sd__bars">
              {vals.map((v, i) => (
                <span key={i} data-t={`bar${i}`} className={st.tip === i ? 'is-hot' : ''} style={{ height: `${v}%` }}>
                  {st.tip === i ? <em className="sd__tip">₱1.42M · best month</em> : null}
                </span>
              ))}
            </div>
            <div className="sd__axis">
              {labels.map((l, i) => (
                <span key={i}>{l}</span>
              ))}
            </div>
          </div>
          <MiniTable
            title="Top products"
            grp="#3e8e2d"
            cols="1.6fr 46px 0.9fr 1fr"
            head="Sales"
            rows={[
              ['Paracetamol 500mg', 'Pharmacy', 'mark', month ? '₱1.9M' : '₱460k', 'green', '▲ 12%'],
              ['Vitamin C 1000mg', 'Wellness', 'jane', month ? '₱1.1M' : '₱270k', 'yellow', '▼ 3%'],
            ]}
          />
        </>
      )
    },
  },

  books: {
    nav: ['Dashboard', 'Invoices', 'Bills', 'Banking', 'Reports'],
    on: 1,
    title: 'Invoices',
    action: '+ New invoice',
    people: ['jane', 'mark'],
    init: { msg: 'Closing this month’s invoices' },
    scripts: [
      [
        { to: 'r0', fx: 0.3, wait: 200 },
        { to: 'send', click: 1, set: { sent: 1, msg: 'INV-1044 emailed to Acme Pharma' }, wait: 1700 },
      ],
      [
        { wait0: 1900 },
        { to: 'pay', click: 1, set: { paid: 1, msg: 'Payment matched to INV-1043' }, wait: 1300 },
      ],
    ],
    View: ({ st }) => (
      <>
        <div className="sd__table" style={{ '--cols': '1.4fr 46px 0.9fr 0.85fr 88px', '--grp': '#3e8e2d' }}>
          <div className="sd__tr sd__th">
            <span className="sd__grp">This month</span>
            <span>Owner</span>
            <span>Amount</span>
            <span>Status</span>
            <span />
          </div>
          <div className="sd__tr" data-t="r0">
            <span><b>INV-1044</b><small>Acme Pharma</small></span>
            <span><Av k="jane" /></span>
            <span>₱24,800</span>
            <span>{st.sent ? <Chip tone="blue">Sent</Chip> : <Chip>Draft</Chip>}</span>
            <span><span className={`sd__btn ${st.sent ? 'is-done' : ''}`} data-t="send">{st.sent ? 'Sent' : 'Send'}</span></span>
          </div>
          <div className="sd__tr">
            <span><b>INV-1043</b><small>Zen Clinic</small></span>
            <span><Av k="mark" /></span>
            <span>₱18,400</span>
            <span>{st.paid ? <Chip tone="green">Paid</Chip> : <Chip tone="yellow">Due Fri</Chip>}</span>
            <span><span className={`sd__btn is-ghost ${st.paid ? 'is-done' : ''}`} data-t="pay">{st.paid ? 'Matched' : 'Record'}</span></span>
          </div>
          <div className="sd__tr">
            <span><b>INV-1042</b><small>North Hospital</small></span>
            <span><Av k="kate" /></span>
            <span>₱36,200</span>
            <span><Chip tone="red">Overdue</Chip></span>
            <span><span className="sd__btn is-ghost">Remind</span></span>
          </div>
          <div className="sd__tr">
            <span><b>BILL-208</b><small>MedSupply Co.</small></span>
            <span><Av k="angel" /></span>
            <span>₱52,000</span>
            <span><Chip tone="green">Matched</Chip></span>
            <span />
          </div>
        </div>
        <MiniTable
          title="Bills to pay"
          grp="#5a6dff"
          cols="1.4fr 46px 0.9fr 1fr"
          head="Amount"
          rows={[
            ['BILL-211', 'PharmaHub', 'angel', '₱31,500', 'yellow', 'Due Mon'],
            ['BILL-210', 'City Power', 'mark', '₱8,900', 'green', 'Scheduled'],
          ]}
        />
      </>
    ),
  },

  finance: {
    nav: ['Overview', 'Budgets', 'Cash flow', 'Approvals', 'Reports'],
    on: 1,
    title: 'Budgets · Q4',
    action: 'Export',
    people: ['kate', 'john'],
    init: { msg: 'Reviewing Q4 budgets' },
    scripts: [
      [
        { to: 'approve', click: 1, set: { approved: 1, msg: 'Trade fair spend approved' }, wait: 500 },
        { to: 'b-mkt', fx: 0.7, wait: 1000 },
      ],
      [
        { wait0: 1500 },
        { to: 'b-ppl', set: { msg: 'People budget at 88% · flagged early' }, wait: 1200 },
      ],
    ],
    View: ({ st }) => {
      const rows = [
        ['Sales', 'jane', 72, '₱720k of ₱1M'],
        ['Operations', 'mark', 54, '₱430k of ₱800k'],
        ['Marketing', 'kate', st.approved ? 58 : 40, st.approved ? '₱58k of ₱100k' : '₱40k of ₱100k', 'b-mkt'],
        ['People', 'angel', 88, '₱350k of ₱400k', 'b-ppl'],
      ]
      const cols = { '--cols': '1.2fr 46px 1.5fr 0.9fr 62px' }
      return (
        <>
          <div className="sd__table" style={{ ...cols, '--grp': '#f36b21' }}>
            <div className="sd__tr sd__th">
              <span className="sd__grp">Q4 budgets</span>
              <span>Owner</span>
              <span>Spent</span>
              <span>Status</span>
              <span />
            </div>
            {rows.map(([dept, who, pct, note, t]) => (
              <div key={dept} className="sd__tr" data-t={t}>
                <span><b>{dept}</b></span>
                <span><Av k={who} /></span>
                <span className="sd__spent">
                  <Bar pct={pct} low={pct > 85} />
                  <small key={note}>{note}</small>
                </span>
                <span>{pct > 85 ? <Chip tone="yellow">At risk</Chip> : <Chip tone="green">On track</Chip>}</span>
                <span />
              </div>
            ))}
          </div>
          <div className="sd__table" style={{ ...cols, '--grp': '#5a6dff' }}>
            <div className="sd__tr sd__th">
              <span className="sd__grp">Spend requests</span>
              <span>Owner</span>
              <span>Amount</span>
              <span>Status</span>
              <span />
            </div>
            <div className="sd__tr">
              <span><b>Trade fair booth</b><small>Marketing</small></span>
              <span><Av k="kate" /></span>
              <span>₱18,000</span>
              <span>{st.approved ? <Chip tone="green">Approved</Chip> : <Chip tone="yellow">Pending</Chip>}</span>
              <span><span className={`sd__btn ${st.approved ? 'is-done' : ''}`} data-t="approve">{st.approved ? 'Done' : 'Approve'}</span></span>
            </div>
          </div>
          <MiniTable
            title="Cash flow · this week"
            grp="#3e8e2d"
            cols="1.2fr 46px 1.5fr 0.9fr"
            head="Amount"
            rows={[
              ['Money in', 'Customer payments', 'jane', '₱860,000', 'green', 'Healthy'],
              ['Money out', 'Payroll + suppliers', 'mark', '₱640,000', 'blue', 'Planned'],
            ]}
          />
        </>
      )
    },
  },

  workdrive: {
    nav: ['My files', 'Team folders', 'Shared', 'Recent', 'Trash'],
    on: 1,
    title: 'Team folders',
    action: '+ Upload',
    people: ['kate', 'joshua'],
    init: { msg: 'Filing team documents' },
    scripts: [
      [
        { to: 'file0', fx: 0.3, wait: 200 },
        { click: 1, carry: 'Supplier contract.pdf', set: { lift: 1 }, wait: 120 },
        { to: 'f-contracts', move: 1000, set: { hot: 1 } },
        { click: 1, carry: null, set: { moved: 1, lift: 0, hot: 0, msg: 'Moved to Contracts' }, wait: 1600 },
      ],
      [
        { wait0: 2600 },
        { to: 'share', click: 1, set: { shared: 1, msg: 'Price list shared with Sales' }, wait: 700 },
      ],
    ],
    View: ({ st }) => {
      const folders = [
        ['f-contracts', 'Contracts', st.moved ? 13 : 12, '#5a6dff'],
        ['f-price', 'Price lists', 8, '#59ba43'],
        ['f-hr', 'HR documents', 24, '#ffd900'],
        ['f-inv', 'Invoices', 96, '#f36b21'],
      ]
      return (
        <>
          <div className="sd__folders">
            {folders.map(([t, name, count, color]) => (
              <div key={t} className={`sd__folder ${t === 'f-contracts' && st.hot ? 'is-hot' : ''}`} data-t={t} style={{ '--f': color }}>
                <span className="sd__fico" />
                <b>{name}</b>
                <small key={count}>{count} files</small>
              </div>
            ))}
          </div>
          <div className="sd__table" style={{ '--cols': '1.9fr 1fr 96px', '--grp': '#f36b21' }}>
            <div className="sd__tr sd__th">
              <span className="sd__grp">Recent files</span>
              <span>Folder</span>
              <span />
            </div>
            <div className={`sd__tr ${st.lift ? 'is-lifted' : ''}`} data-t="file0">
              <span className="sd__file"><span className="sd__ftype" data-type="PDF">PDF</span><span><b>Supplier contract.pdf</b><small>Edited 2 min ago</small></span></span>
              <span>{st.moved ? <Chip tone="blue">Contracts</Chip> : <Chip>Uploads</Chip>}</span>
              <span />
            </div>
            <div className="sd__tr">
              <span className="sd__file"><span className="sd__ftype" data-type="XLS">XLS</span><span><b>Price list 2026.xlsx</b><small>Version 12</small></span></span>
              <span><Chip tone="green">Price lists</Chip></span>
              <span><span className={`sd__btn is-ghost ${st.shared ? 'is-done' : ''}`} data-t="share">{st.shared ? 'Shared' : 'Share'}</span></span>
            </div>
            <div className="sd__tr">
              <span className="sd__file"><span className="sd__ftype" data-type="DOC">DOC</span><span><b>Onboarding guide.docx</b><small>Version 2</small></span></span>
              <span><Chip tone="yellow">HR documents</Chip></span>
              <span />
            </div>
          </div>
          <MiniTable
            title="Waiting for approval"
            grp="#5a6dff"
            cols="1.9fr 46px 0.8fr 1fr"
            head="Size"
            rows={[
              ['NDA · LabOne.pdf', 'Contracts', 'kate', '1.2 MB', 'yellow', 'Needs sign-off'],
              ['Q4 price update.xlsx', 'Price lists', 'joshua', '340 KB', 'green', 'Approved'],
            ]}
          />
        </>
      )
    },
  },

  desk: {
    nav: ['Inbox', 'My tickets', 'Customers', 'Reports', 'Settings'],
    on: 0,
    title: 'Inbox',
    action: '+ New ticket',
    people: ['mark', 'angel'],
    init: { open: -1, msg: 'Answering customer tickets' },
    scripts: [
      [
        { to: 't0', fx: 0.4, click: 1, set: { open: 0 }, wait: 500 },
        { to: 'reply', fx: 0.3, click: 1, wait: 100 },
        { type: ['reply', 'Sorry about that! Two new boxes ship today.'], wait: 250 },
        { to: 'send', click: 1, set: { solved: 1, msg: 'Reply sent · ticket solved' }, wait: 1600 },
      ],
      [
        { wait0: 1300 },
        { to: 'assign', click: 1, set: { assigned: 1 }, wait: 700 },
      ],
    ],
    View: ({ st }) => (
      <>
      <div className="sd__desk">
        <div className="sd__tickets">
          <div className={`sd__ticket ${st.open === 0 ? 'is-on' : ''}`} data-t="t0">
            <b>Order arrived damaged</b>
            <small>Acme Pharma · #2081</small>
            {st.solved ? <Chip tone="green">Solved</Chip> : <Chip tone="red">High · Open</Chip>}
          </div>
          <div className="sd__ticket">
            <b>Change delivery address</b>
            <small>Zen Clinic · #2080</small>
            <span className={`sd__assign ${st.assigned ? 'is-done' : ''}`} data-t="assign">
              {st.assigned ? 'Angel' : 'Assign to me'}
            </span>
          </div>
          <div className="sd__ticket">
            <b>Invoice copy request</b>
            <small>North Hospital · #2079</small>
            <Chip tone="blue">Replied</Chip>
          </div>
        </div>
        <div className="sd__card sd__detail">
          {st.open === 0 ? (
            <>
              <h6>Acme Pharma · order history</h6>
              <span className="sd__ctx">
                <Chip tone="blue">SO-3318 · delivered Tue</Chip>
                <Chip tone="yellow">INV-1044 · ₱24,800</Chip>
              </span>
              <p className="sd__msg">Two boxes of Paracetamol arrived crushed. Can you replace them?</p>
              <div className={`sd__reply ${st.reply !== undefined && !st.solved ? 'is-typing' : ''}`} data-t="reply">
                {st.reply || <span className="sd__ph">Write a reply…</span>}
              </div>
              <span className={`sd__btn sd__send ${st.solved ? 'is-done' : ''}`} data-t="send">{st.solved ? 'Sent' : 'Send'}</span>
            </>
          ) : (
            <span className="sd__empty">Select a ticket to see the customer’s orders, invoices and history.</span>
          )}
        </div>
      </div>
      <MiniTable
        title="SLA watch"
        grp="#fd4040"
        cols="1.6fr 46px 0.9fr 1fr"
        head="Time left"
        rows={[
          ['#2078 · Refund request', 'MegaDrug', 'mark', '25 min', 'red', 'At risk'],
          ['#2077 · Login help', 'LabOne', 'angel', '3 h', 'green', 'On track'],
        ]}
      />
      </>
    ),
  },
}

function Cursor({ c, p }) {
  return (
    <div className={`sd__cursor ${c.flip ? "is-flip" : ""}`} style={{ transform: `translate(${c.x}px, ${c.y}px)`, '--c': p.c, '--ci': p.ci || '#fff' }}>
      <span className="sd__ptr" style={{ '--d': p.d }}>
      <span key={c.click} className={`sd__ripple ${c.click ? 'is-on' : ''}`} />
      <svg width="16" height="18" viewBox="0 0 18 20">
        <path d="M1 1l15 7.2-6.6 1.9-3.1 6.4z" fill={p.c} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span className="sd__tag">
        <span className="sd__face">{p.name[0]}</span>
        {p.name}
      </span>
      {c.carry ? <span className="sd__carry">{c.carry}</span> : null}
      </span>
    </div>
  )
}

function SystemDemo({ id }) {
  const scene = SCENES[id] || SCENES.inventory
  const sys = systems.find((s) => s.id === id) || systems[0]
  const rootRef = useRef(null)
  const [st, setSt] = useState(scene.init || {})
  const [cycle, setCycle] = useState(0)
  const startCursors = () =>
    scene.people.map((_, i) => ({ x: i ? 420 : 150, y: i ? 70 : 300, click: 0, carry: null }))
  const [cur, setCur] = useState(startCursors)

  useEffect(() => {
    let dead = false
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const upd = (i, fn) => setCur((list) => list.map((v, j) => (j === i ? { ...v, ...fn(v) } : v)))

    // Target position inside the window, corrected for any scale on an
    // ancestor (the panel pops in with a transform).
    const posOf = (t, fx = 0.5, fy = 0.55) => {
      const root = rootRef.current
      const el = root?.querySelector(`[data-t="${t}"]`)
      if (!el) return null
      const a = root.getBoundingClientRect()
      const b = el.getBoundingClientRect()
      const k = root.offsetWidth ? a.width / root.offsetWidth : 1
      const x = (b.left - a.left + b.width * fx) / k
      return { x, y: (b.top - a.top + b.height * fy) / k, flip: x > root.offsetWidth - 120 }
    }

    const run = async (steps, i) => {
      for (const s of steps) {
        if (s.wait0) await sleep(s.wait0)
        if (dead) return
        if (s.to) {
          const p = posOf(s.to, s.fx, s.fy)
          if (p) upd(i, () => p)
          await sleep(s.move ?? 850)
        }
        if (dead) return
        if (s.click) {
          upd(i, (v) => ({ click: v.click + 1 }))
          await sleep(180)
        }
        if ('carry' in s) upd(i, () => ({ carry: s.carry }))
        if (s.set) setSt((prev) => ({ ...prev, ...s.set }))
        if (s.type) {
          const [key, text] = s.type
          for (let n = 0; n <= text.length; n++) {
            if (dead) return
            setSt((prev) => ({ ...prev, [key]: text.slice(0, n) }))
            await sleep(30)
          }
        }
        await sleep(s.wait ?? 450)
      }
    }

    const loop = async () => {
      await sleep(750)
      while (!dead) {
        await Promise.all(scene.scripts.map((steps, i) => run(steps, i)))
        await sleep(2200)
        if (dead) return
        // Reset and replay, with the rows animating in again.
        setSt(scene.init || {})
        setCur((list) => list.map((v, i) => ({ ...startCursors()[i], click: v.click })))
        setCycle((n) => n + 1)
        await sleep(1100)
      }
    }
    loop()
    return () => {
      dead = true
    }
  }, [scene])

  const View = scene.View

  return (
    <div className="sd" ref={rootRef} aria-hidden="true">
      <div className="sd__header">
        <div className="sd__titlebar">
          <img src={sys.logo} alt="" width="20" height="20" />
          <h5>{scene.title}</h5>
          <span className="sd__live">
            <i /> Live
          </span>
          <span className="sd__team">
            {scene.people.map((k) => (
              <span key={k} className="sd__face sd__face--sm" style={{ '--c': PEOPLE[k].c, '--ci': PEOPLE[k].ci || '#fff' }}>
                {PEOPLE[k].name[0]}
              </span>
            ))}
          </span>
        </div>
        <div className="sd__tabs">
          {scene.nav.slice(0, 4).map((n, i) => (
            <span key={n} className={i === scene.on ? 'is-on' : ''}>
              {n}
            </span>
          ))}
          <span className="sd__tab-add">+</span>
          <span className="sd__btn sd__action" data-t="action">
            {scene.action}
          </span>
        </div>
      </div>

      <div className="sd__main">
        <div className="sd__view" key={cycle}>
          <View st={st} />
        </div>
      </div>

      {/* What the team is doing right now */}
      <div className="sd__caption">
        <span className="sd__caption-logo">
          <img src={sys.logo} alt="" width="16" height="16" />
        </span>
        <span key={st.msg}>{st.msg}</span>
      </div>

      {scene.people.map((k, i) => (
        <Cursor key={k} c={cur[i]} p={PEOPLE[k]} />
      ))}
    </div>
  )
}

/* ===== components/ProductShowcase.jsx ===== */
// Long enough for each system demo to play through once.
const DURATION = 10500

function ProductShowcase() {
  const [active, setActive] = useState(0)
  const [paused, setPaused] = useState(false)
  const [sectionRef, inView] = useInView({ threshold: 0.25, once: false })

  useEffect(() => {
    if (paused || !inView) return
    const id = window.setTimeout(() => setActive((i) => (i + 1) % products.length), DURATION)
    return () => window.clearTimeout(id)
  }, [active, paused, inView])

  // Links such as #showcase-books (from the hero and Products menu) open
  // the matching system and scroll the section into view.
  useEffect(() => {
    const openFromHash = () => {
      const match = window.location.hash.match(/^#showcase-(.+)$/)
      if (!match) return
      const index = products.findIndex((p) => p.id === match[1])
      if (index === -1) return
      setActive(index)
      setPaused(true)
      document.getElementById('showcase')?.scrollIntoView({ behavior: 'smooth' })
    }
    openFromHash()
    window.addEventListener('hashchange', openFromHash)
    return () => window.removeEventListener('hashchange', openFromHash)
  }, [])

  const product = products[active]

  return (
    <section className="section showcase" id="showcase" ref={sectionRef} aria-label="The eight Bishnoi One systems">
      <div className="shell">
        <div
          className="showcase__panel"
          data-accent={product.accent}
          id={`panel-${product.id}`}
          aria-live="polite"
          aria-label={`${product.name} overview`}
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          <div className="showcase__copy" key={product.id}>
            <span className="showcase__badge">
              {product.logo ? <img src={product.logo} alt="" width="18" height="18" className="product-logo" decoding="async" /> : <Icon name={product.icon} size={16} />}
              {product.name}
            </span>
            <h3>{product.headline}</h3>
            <p>{product.description}</p>
            <ul className="showcase__bullets">
              {product.bullets.map((bullet) => (
                <li key={bullet}>
                  <span className="showcase__check">
                    <Icon name="check" size={14} />
                  </span>
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="showcase__footer">
              <a className="btn btn--primary showcase__cta" href="#cta">
                Try {product.short}
                <Icon name="arrowRight" size={17} />
              </a>
              <div className="showcase__stat">
                <strong>{product.stat.value}</strong>
                <span>{product.stat.label}</span>
              </div>
            </div>
          </div>

          <div className="showcase__art" key={`${product.id}-art`}>
            <SystemDemo id={product.id} />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ===== hooks/useCountUp.js ===== */
const prefersReducedMotion = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** Eases a number from 0 to `target` once `active` flips true. */
function useCountUp(target, active, duration = 1600) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    if (!active) return
    if (prefersReducedMotion()) {
      setValue(target)
      return
    }

    let frame = 0
    const start = performance.now()
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(target * eased)
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target, active, duration])

  return value
}

/* ===== components/DashboardStage.jsx ===== */
/* A tilted desktop monitor showing a live-looking Bishnoi One overview:
   KPI tiles, an orders chart, a feed that keeps receiving new activity,
   approvals, stock levels and who is in today. All sample data. */

const ORDERS = [42, 58, 51, 74, 66, 88, 79, 95, 84, 102, 97, 118]
const RETURNS = [18, 22, 30, 26, 34, 29, 38, 31, 36, 33, 41, 37]
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function smooth(values, w, h, max) {
  const step = w / (values.length - 1)
  const pts = values.map((v, i) => [i * step, h - (v / max) * h])
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i]
    const p1 = pts[i]
    const p2 = pts[i + 1]
    const p3 = pts[i + 2] || p2
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6]
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
    d += ` C${c1[0]},${c1[1]} ${c2[0]},${c2[1]} ${p2[0]},${p2[1]}`
  }
  return d
}

const KPIS = [
  { label: 'Revenue this month', value: 4.82, prefix: '₱', suffix: 'M', digits: 2, delta: '+12.4%', up: true, spark: [3, 5, 4, 6, 5, 7, 8] },
  { label: 'Orders today', value: 1284, digits: 0, delta: '+8.1%', up: true, spark: [4, 4, 6, 5, 7, 6, 8] },
  { label: 'Stock value', value: 18.6, prefix: '₱', suffix: 'M', digits: 1, delta: '-2.3%', up: false, spark: [8, 7, 7, 6, 6, 5, 5] },
  { label: 'Team members', value: 214, digits: 0, delta: '+3 new', up: true, spark: [5, 5, 6, 6, 6, 7, 7] },
]

const APPROVALS = [
  { level: 'Urgent', tone: 'red', title: 'Stock reorder', note: 'Paracetamol 500mg below minimum', due: '1 hr' },
  { level: 'Today', tone: 'orange', title: 'Payroll run', note: '214 payslips ready to release', due: '3 hrs' },
  { level: 'This week', tone: 'green', title: 'Supplier invoice', note: 'Matched to PO-2291', due: '2 days' },
]

const FEED = [
  { system: 'inventory', event: 'Batch B-1182 received at Manila DC', status: 'Posted' },
  { system: 'crm', event: 'Quote sent to St. Luke’s Pharmacy', status: 'Sent' },
  { system: 'books', event: 'Invoice INV-5530 paid', status: 'Matched' },
  { system: 'people', event: 'Leave approved for J. Santos', status: 'Approved' },
  { system: 'finance', event: 'Budget Q4 marketing updated', status: 'Saved' },
  { system: 'analytics', event: 'Weekly sales report refreshed', status: 'Ready' },
  { system: 'inventory', event: 'Transfer TR-418 to Cebu branch', status: 'Shipped' },
  { system: 'crm', event: 'New lead from Mercury Clinic', status: 'Assigned' },
]

const DASH_STOCK = [
  { name: 'Paracetamol 500mg', pct: 18, tone: 'red' },
  { name: 'Amoxicillin 250mg', pct: 46, tone: 'orange' },
  { name: 'Vitamin C 1000mg', pct: 72, tone: 'green' },
  { name: 'Insulin pens', pct: 88, tone: 'green' },
]

const DASH_TEAM = [
  { i: 'MR', c: '#f36b21' },
  { i: 'JS', c: '#173f2a' },
  { i: 'AL', c: '#5a6dff' },
  { i: 'KC', c: '#59ba43' },
  { i: 'PD', c: '#e02f2f' },
]

function Kpi({ k, active, d }) {
  const v = useCountUp(k.value, active, 1800)
  const max = Math.max(...k.spark)
  const pts = k.spark.map((s, i) => `${(i / (k.spark.length - 1)) * 60},${18 - (s / max) * 16}`).join(' ')
  return (
    <div className="dash__card dash__kpi" style={{ '--d': d }}>
      <span className="dash__kpi-label">{k.label}</span>
      <strong className="dash__kpi-value">
        {k.prefix}
        {v.toLocaleString('en-US', { minimumFractionDigits: k.digits, maximumFractionDigits: k.digits })}
        {k.suffix}
      </strong>
      <div className="dash__kpi-foot">
        <span className={`dash__delta ${k.up ? 'is-up' : 'is-down'}`}>{k.delta}</span>
        <svg viewBox="0 0 60 20" className="dash__spark">
          <polyline points={pts} />
        </svg>
      </div>
    </div>
  )
}

function clock(offsetMin) {
  const t = 9 * 60 + 42 - offsetMin
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

function DashboardStage() {
  const [ref, inView] = useInView({ threshold: 0.2 })
  const [tick, setTick] = useState(0)

  // Feed: a new item arrives every few seconds while the section is visible.
  useEffect(() => {
    if (!inView || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const id = setInterval(() => setTick((t) => t + 1), 3200)
    return () => clearInterval(id)
  }, [inView])

  const W = 520
  const H = 130
  const max = 130
  const peak = 9
  const px = (peak / (ORDERS.length - 1)) * W
  const py = H - (ORDERS[peak] / max) * H
  const byId = Object.fromEntries(products.map((p) => [p.id, p]))
  const feed = Array.from({ length: 4 }, (_, k) => {
    const n = tick - k
    return { ...FEED[((n % FEED.length) + FEED.length) % FEED.length], key: n, time: clock(k * 17 - tick * 3) }
  })

  return (
    <section className={`stage ${inView ? 'is-in' : ''}`} ref={ref} aria-labelledby="stage-title">
      <div className="shell shell--wide stage__head">
        <p className="stage__eyebrow">One screen for the whole company</p>
        <h2 id="stage-title" className="stage__title">
          See every system <em>at a glance</em>
        </h2>
        <p className="stage__lead">
          Sales, stock, people and money update on one live dashboard, so every team works from the
          same numbers.
        </p>
      </div>

      <div className="stage__scene" aria-hidden="true">
        <div className="stage__rings" />
        <div className="monitor">
          {/* A MedRep's Home, made-up figures only (medrep-screen.tsx, Aryan 27 Nov). */}
          <div className="monitor__screen monitor__screen--app">
            <MedrepScreen />
          </div>
          <div className="monitor__chin" />
          <div className="monitor__neck" />
          <div className="monitor__foot" />
        </div>
      </div>
    </section>
  )
}

/* ===== components/Statement.jsx ===== */
/* A large statement sentence with small visual "pills" set inline between
   the words. As the reader scrolls through, the words darken one by one. */

const LogoStack = () => (
  <span className="stm-pill stm-pill--logos">
    {systems.slice(0, 4).map((s, i) => (
      <img key={s.id} src={s.logo} alt="" width="34" height="34" style={{ '--i': i }} />
    ))}
  </span>
)

const Tag = () => <span className="stm-pill stm-pill--tag">only the exceptions</span>

const Target = () => (
  <span className="stm-pill stm-pill--target">
    <span className="stm-pill__ring" />
    <span className="stm-pill__ring" />
    <span className="stm-pill__ring" />
    <span className="stm-pill__core" />
  </span>
)

const Bars = () => (
  <span className="stm-pill stm-pill--bars">
    <span />
    <span />
    <span />
  </span>
)

// Text pieces and inline pills, in reading order.
const PARTS = [
  'Bishnoi',
  'One',
  <LogoStack key="logos" />,
  'keeps',
  'every',
  'department',
  'on',
  'one',
  'record,',
  'sends',
  <Tag key="tag" />,
  'to',
  'the',
  'right',
  'person',
  <Target key="target" />,
  'and',
  'keeps',
  'the',
  'numbers',
  <Bars key="bars" />,
  'behind',
  'every',
  'decision.',
]

const WORD_COUNT = PARTS.filter((p) => typeof p === 'string').length

function Statement() {
  const ref = useRef(null)
  const [lit, setLit] = useState(0)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setLit(WORD_COUNT)
      return
    }
    let frame = 0
    const update = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      // 0 when the text enters the lower part of the screen, 1 by the middle.
      const p = (vh * 0.85 - r.top) / (vh * 0.85 - vh * 0.3 + r.height * 0.5)
      setLit(Math.round(Math.min(Math.max(p, 0), 1) * WORD_COUNT))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [])

  let w = 0
  return (
    <section className="statement" aria-label="What Bishnoi One does">
      <div className="shell shell--wide">
        <p className="statement__text" ref={ref}>
          {PARTS.map((part, i) => {
            if (typeof part !== 'string') return <span key={i}>{part} </span>
            const on = w++ < lit
            return (
              <span key={i}>
                <span className={`statement__word ${on ? 'is-on' : ''}`}>{part}</span>{' '}
              </span>
            )
          })}
        </p>
      </div>
    </section>
  )
}

/* ===== components/PeoplePills.jsx ===== */
/* A row of tall rounded pills of different heights: brand colour blocks,
   short messages and two team members photographed against office scenes.
   The pills rise into place one after another when the row scrolls in. */

const Mark = ({ size = 'md' }) => (
  <span className={`pp__mark pp__mark--${size}`}>
    <img src="/home-export/images/bishnoi-logo.png" alt="" width="40" height="40" />
  </span>
)

function PeoplePills() {
  const [ref, inView] = useInView({ threshold: 0.2 })

  return (
    <section className={`pp ${inView ? 'is-in' : ''}`} ref={ref} aria-labelledby="pp-title">
      <div className="shell shell--wide">
        <h2 id="pp-title" className="pp__title">
          Eight systems run the day.
          <span>Your people make the calls.</span>
        </h2>
      </div>

      <ul className="pp__row">
        <li className="pp__pill pp__pill--orange" style={{ '--h': 0.6, '--i': 0 }}>
          <Mark size="lg" />
          <span className="pp__foot">Bishnoi One</span>
        </li>

        <li className="pp__pill pp__pill--photo" style={{ '--h': 0.72, '--i': 1 }}>
          <img className="pp__bg" src="/home-export/images/office.jpg" alt="" style={{ objectPosition: '82% 50%' }} />
          <img className="pp__person" src="/home-export/images/maamdebbie.png" alt="Debbie, Bishnoi One team" />
        </li>

        <li className="pp__pill pp__pill--dark" style={{ '--h': 0.86, '--i': 2 }}>
          <p>Every department on one record.</p>
        </li>

        <li className="pp__pill pp__pill--rings" style={{ '--h': 1, '--i': 3 }}>
          <span className="pp__rings" aria-hidden="true" />
          <span className="pp__brand">
            <Mark size="sm" /> Bishnoi One
          </span>
        </li>

        <li className="pp__pill pp__pill--photo" style={{ '--h': 0.86, '--i': 4 }}>
          <img className="pp__bg" src="/home-export/images/office2.jpg" alt="" style={{ objectPosition: '60% 50%' }} />
          <img className="pp__person pp__person--sumit" src="/home-export/images/sirsumit.png" alt="Sumit, Bishnoi One team" />
        </li>

        <li className="pp__pill pp__pill--blue" style={{ '--h': 0.72, '--i': 5 }}>
          <p>Approve exceptions as they happen.</p>
          <span className="pp__chip">Needs you</span>
        </li>

        <li className="pp__pill pp__pill--white" style={{ '--h': 0.86, '--i': 6 }}>
          <p>Built so every team works from the same numbers.</p>
          <a className="pp__btn" href="#systems">
            Explore systems
          </a>
        </li>
      </ul>
    </section>
  )
}

/* ===== components/QuoteBand.jsx ===== */
/* Orange band: a large statement on the left with key phrases in bold, and a
   round team photo on the right inside thin concentric rings. */
function QuoteBand() {
  const [ref, inView] = useInView({ threshold: 0.25 })

  return (
    <section className={`qb ${inView ? 'is-in' : ''}`} ref={ref} aria-labelledby="qb-quote">
      <div className="shell shell--wide qb__inner">
        <figure className="qb__text">
          <span className="qb__mark" aria-hidden="true">
            “
          </span>
          <blockquote id="qb-quote">
            <p>
              We wanted <b>one place</b> where the everyday work <b>runs by itself</b>, and every
              team only stops for <b>what truly needs a person.</b>
            </p>
          </blockquote>
          <figcaption>
            <strong>The Bishnoi One team</strong>
            <span>Why we built it</span>
          </figcaption>
        </figure>

        <div className="qb__visual">
          <div className="qb__rings" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <span key={i} style={{ '--n': i }} />
            ))}
          </div>
          <div className="qb__photo">
            <img src="/home-export/images/howwework.jpg" alt="Our team meeting around a desk in the office" loading="lazy" />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ===== components/WordsSplit.jsx ===== */
/* Split band: team photo on the left, three big stacked words on a dark
   panel on the right, with the middle word in brand orange. */
const WORDS = [
  { word: 'Connect' },
  { word: 'Approve', accent: true },
  { word: 'Grow' },
]

function WordsSplit() {
  const [ref, inView] = useInView({ threshold: 0.25 })

  return (
    <section className={`ws ${inView ? 'is-in' : ''}`} ref={ref} aria-label="Connect, approve, grow">
      <div className="ws__photo">
        <img src="/home-export/images/image.JPG" alt="Two team members reviewing work on a laptop in the office" loading="lazy" />
      </div>

      <div className="ws__panel">
        <ul className="ws__words">
          {WORDS.map((w, i) => (
            <li key={w.word} className={`ws__word ${w.accent ? 'is-accent' : ''}`} style={{ '--i': i }}>
              <span className="ws__text">{w.word}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ===== components/WorkflowStages.jsx ===== */
/* "Where workflows shape growth": oversized staggered headline over four
   workflow stages that step down the page, each with its tasks as pills.
   tone: one highlighted pill per stage — blue, yellow, red, green. */
const STAGES = [
  {
    label: 'Connect',
    items: [
      { text: 'link your business systems' },
      { text: 'import existing spreadsheets' },
      { text: 'map who owns each process', tone: 'blue' },
      { text: 'invite team & clients' },
      { text: 'set access levels' },
    ],
  },
  {
    label: 'Approve',
    items: [
      { text: 'route incoming requests' },
      { text: 'manager sign-off rules' },
      { text: 'flag exceptions instantly' },
      { text: 'approved in one tap', tone: 'yellow' },
    ],
  },
  {
    label: 'Automate',
    items: [
      { text: 'trigger follow-up tasks & alerts' },
      { text: 'sync records across systems', tone: 'red' },
      { text: 'auto-assign to the right owner' },
      { text: 'full audit trail + timestamps' },
    ],
  },
  {
    label: 'Grow',
    items: [
      { text: 'live dashboards', tone: 'green' },
      { text: 'weekly performance & team feedback' },
    ],
  },
]

function WorkflowStages() {
  const [ref, inView] = useInView({ threshold: 0.15 })

  return (
    <section className={`wfs ${inView ? 'is-in' : ''}`} ref={ref} aria-labelledby="wfs-title">
      <div className="wfs__glow wfs__glow--a" aria-hidden="true" />
      <div className="wfs__glow wfs__glow--b" aria-hidden="true" />
      <div className="wfs__glow wfs__glow--c" aria-hidden="true" />

      <div className="shell wfs__inner">
        <h2 className="wfs__title" id="wfs-title">
          <span className="wfs__line wfs__line--1" style={{ '--i': 0 }}>Where</span>
          <span className="wfs__line wfs__line--2" style={{ '--i': 1 }}>Workflows</span>
          <span className="wfs__line wfs__line--3" style={{ '--i': 2 }}>
            <span>Shape</span>
            <span className="wfs__accent">Growth</span>
          </span>
        </h2>

        <ol className="wfs__stages">
          {STAGES.map((stage, i) => (
            <li className="wfs__stage" key={stage.label} style={{ '--i': i }}>
              <h3 className="wfs__label">
                <svg className="wfs__marker" viewBox="0 0 36 14" aria-hidden="true">
                  <rect x="0.75" y="0.75" width="34.5" height="12.5" rx="6.25" />
                  <path d="M8 7h19M23.5 4l3.5 3-3.5 3" />
                </svg>
                {stage.label}
              </h3>
              <ul className="wfs__items">
                {stage.items.map((item, j) => (
                  <li
                    key={item.text}
                    className={`wfs__pill ${item.tone ? `wfs__pill--${item.tone}` : ''}`}
                    style={{ '--j': j }}
                  >
                    {item.text}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

/* ===== components/ApproveSmarter.jsx ===== */
/* "Approve smarter." band: two product panels on top (preview the workflow,
   customise each step), then a big orange headline with a photo pill. */

const STEPS = [
  ['People', 'Leave request submitted', 'Trigger · from the People app, any team'],
  ['Books', 'Check leave balance', 'Action · reads balance and payroll period'],
  ['Desk', 'Confirm cover for the shift', 'Action · checks open tickets for that day'],
  ['Finance', 'Flag unpaid days over limit', 'Rule · only if balance is below 0'],
  ['People', 'Manager approves in one tap', 'Approval · reminder after 4 hours'],
  ['Books', 'Update payroll', 'Action · synced to this month’s run'],
]

// Icon files in public/ (Desk's is lowercase)
const icon = (sys) => (sys === 'Desk' ? '/home-export/images/desk.png' : `/${sys}.png`)

const SYSTEMS = [
  ['People', 'is-on'],
  ['Books', 'is-on'],
  ['Desk', ''],
]

// Laptop dashboard content (design width; see .aps__dash in the CSS)
const DASH_W = 440

const NAV = [
  ['Dashboard', null, 'board'],
  ['Approvals', null, 'check'],
  ['People', 'People'],
  ['Books', 'Books'],
  ['Finance', 'Finance'],
  ['Desk', 'Desk'],
  ['Inventory', 'Inventory'],
  ['CRM', 'CRM'],
  ['Analytics', 'Analytics'],
  ['WorkDrive', 'WorkDrive'],
  ['Automations', null, 'automation'],
  ['Settings', null, 'shield'],
]

// Owner avatars (same people and colours as the system dashboards)
const OWNERS = {
  J: '#f36b21',
  M: '#5a6dff',
  K: '#173f2a',
  A: '#3e8e2d',
  R: '#fd4040',
}

// Grouped tables in the Invoices style.
// rows: [request, requester, owner initial, amount, status tone, status, button]
const GROUPS = [
  {
    title: 'Waiting for you',
    color: '#f36b21',
    rows: [
      ['Leave · Dec 4–5', 'Leo Cruz · People', 'J', '2 days', 'yellow', 'Pending', 'Approve'],
      ['Trade fair booth', 'Marketing · Finance', 'K', '₱18,000', 'yellow', 'Pending', 'Approve'],
      ['Refund #2078', 'MegaDrug · Desk', 'R', '₱4,200', 'red', 'Escalated', 'Review'],
      ['Overtime · Nov wk 4', 'Ana Reyes · People', 'A', '6 hrs', 'blue', 'In review', 'Approve'],
    ],
  },
  {
    title: 'Approved today',
    color: '#3e8e2d',
    rows: [
      ['BILL-211 · PharmaHub', 'Purchasing · Books', 'M', '₱31,500', 'green', 'Approved', null],
      ['PO-2041 · MedSupply', 'Inventory · Books', 'A', '₱52,000', 'green', 'Approved', null],
    ],
  },
  {
    title: 'Due this week',
    color: '#5a6dff',
    rows: [
      ['Contract renewal · LabOne', 'Sales · CRM', 'K', '₱120,000', 'blue', 'Due Thu', 'Approve'],
      ['New laptop · Ria Santos', 'Onboarding · People', 'J', '₱58,000', 'yellow', 'Due Fri', 'Approve'],
    ],
  },
]

function ApproveSmarter() {
  const [ref, inView] = useInView({ threshold: 0.15 })
  const fitRef = useRef(null)

  // The dashboard is designed at a fixed size (DASH_W px wide) and scaled to
  // whatever width the laptop screen ends up at.
  useEffect(() => {
    const el = fitRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => el.style.setProperty('--s', el.offsetWidth / DASH_W))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <section className={`aps ${inView ? 'is-in' : ''}`} ref={ref} aria-labelledby="aps-title">
      <div className="aps__panels">
        {/* Preview the workflow */}
        <div className="aps__panel aps__panel--peach">
          <span className="aps__tag">Preview the workflow</span>

          <div className="aps__modal" aria-hidden="true">
            <div className="aps__modal-head">
              <span className="aps__dot aps__dot--orange" />
              <div>
                <b>Leave request to payroll</b>
                <small>Route time-off requests, check cover and balance, then update payroll once approved.</small>
              </div>
              <span className="aps__x">×</span>
            </div>

            <div className="aps__modal-body">
              <ol className="aps__steps">
                {STEPS.map(([sys, title, sub], i) => (
                  <li key={title} style={{ '--i': i }}>
                    <img src={icon(sys)} alt="" />
                    <span>
                      <b>{title}</b>
                      <small>{sub}</small>
                    </span>
                  </li>
                ))}
              </ol>

              <div className="aps__side">
                <em>Systems</em>
                {SYSTEMS.map(([sys, on]) => (
                  <div key={sys} className="aps__sys">
                    <img src={icon(sys)} alt="" />
                    <span>{sys}</span>
                    <i className={on}>{on ? 'Connected' : 'Connect'}</i>
                  </div>
                ))}
                <em>Preview</em>
                <dl>
                  <dt>Runs / mo</dt><dd>2,431</dd>
                  <dt>Avg. approval</dt><dd>6 min</dd>
                  <dt>Saved</dt><dd>~14 h / wk</dd>
                </dl>
              </div>
            </div>

            <div className="aps__modal-foot">
              <span>Preview in sandbox</span>
              <span className="aps__btn aps__btn--ghost">Close</span>
              <span className="aps__btn">Use this flow</span>
            </div>
          </div>
        </div>

        {/* Approve from one dashboard */}
        <div className="aps__panel aps__panel--lilac">
          <span className="aps__tag">Approve from one dashboard</span>

          <div className="aps__scene" aria-hidden="true">
            <img className="aps__scene-img" src="/home-export/images/tablelaptop.png" alt="" loading="lazy" />
            {/* Live dashboard laid over the laptop screen (below the browser bar) */}
            <div className="aps__screen-fit" ref={fitRef}>
            <div className="aps__dash">
              <aside className="aps__side-nav">
                <span className="aps__brandmini">
                  <img src="/home-export/images/bishnoi-logo.png" alt="" /> Bishnoi One
                </span>
                {NAV.map(([label, sys, glyph], i) => (
                  <span key={label} className={`aps__nav-item ${i === 1 ? 'is-on' : ''}`}>
                    {sys ? <img src={icon(sys)} alt="" /> : <Icon name={glyph} size={8} className="aps__nav-ico" />}
                    {label}
                  </span>
                ))}
              </aside>

              <div className="aps__dash-main">
                <div className="aps__dash-head">
                  <b>Approvals</b>
                  <span className="aps__search">Search requests…</span>
                  <span className="aps__me">M</span>
                </div>

                {GROUPS.map((g) => (
                  <div key={g.title} className="aps__table" style={{ '--grp': g.color }}>
                    <div className="aps__tr aps__th">
                      <span>{g.title}</span>
                      <span>Owner</span>
                      <span>Amount</span>
                      <span>Status</span>
                      <span />
                    </div>
                    {g.rows.map(([title, sub, owner, amt, tone, status, action]) => (
                      <div key={title} className="aps__tr">
                        <span>
                          <b>{title}</b>
                          <small>{sub}</small>
                        </span>
                        <span><i className="aps__av" style={{ '--c': OWNERS[owner] }}>{owner}</i></span>
                        <span>{amt}</span>
                        <span className="aps__status" data-tone={tone}>{status}</span>
                        <span>{action ? <i className={`aps__btn ${action === 'Review' ? 'aps__btn--ghost' : ''}`}>{action}</i> : null}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
            </div>
          </div>
        </div>
      </div>

      {/* Big headline band */}
      <div className="aps__band">
        <h2 className="aps__title" id="aps-title">
          <span className="aps__row">
            <span className="aps__word">Decide faster and approve</span>
            <span className="aps__photo">
              <img src="/home-export/images/howwework.jpg" alt="" aria-hidden="true" loading="lazy" />
            </span>
          </span>
          <span className="aps__row">
            <span className="aps__word">all in one place.</span>
            <a className="aps__cta" href="#cta">Explore now</a>
          </span>
        </h2>
        <p className="aps__note">Every request, approval and sign-off in one place.</p>
      </div>
    </section>
  )
}

/* ===== components/ui/Reveal.jsx ===== */
/**
 * Wraps children in a scroll-triggered reveal. Pass `as` to change the element,
 * `direction` for the entry vector and `delay` (ms) to stagger a group.
 */
function Reveal({
  children,
  as: Tag = 'div',
  direction = 'up',
  delay = 0,
  className = '',
  threshold,
  ...rest
}) {
  const [ref, inView] = useInView(threshold ? { threshold } : undefined)

  return (
    <Tag
      ref={ref}
      data-direction={direction}
      className={`reveal ${inView ? 'is-visible' : ''} ${className}`.trim()}
      style={{ '--reveal-delay': `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  )
}

/* ===== components/Capabilities.jsx ===== */
function Capabilities() {
  return (
    <section className="section caps" id="platform">
      <div className="shell">
        <div className="caps__head">
          <Reveal className="section-head" direction="left">
            <span className="eyebrow">
              <Icon name="sparkle" size={14} /> The platform underneath
            </span>
            <h2>
              The clever bits that make
              <br />
              the whole thing click
            </h2>
          </Reveal>
          <Reveal direction="right" delay={100}>
            <p className="lead caps__head-lead">
              Every Bishnoi One product sits on the same platform, so automations, dashboards and
              integrations work the same way wherever you are.
            </p>
            <a className="link-arrow" href="#cta">
              See the full platform <Icon name="arrowRight" size={16} />
            </a>
          </Reveal>
        </div>

        <div className="caps__grid">
          {capabilities.map((item, index) => (
            <Reveal
              key={item.title}
              className="cap-card"
              data-accent={item.accent}
              delay={index * 70}
              direction="scale"
            >
              <span className="cap-card__icon">
                <Icon name={item.icon} size={24} />
              </span>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
              <span className="cap-card__link">
                Learn more <Icon name="arrowRight" size={15} />
              </span>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ===== components/StatsBand.jsx ===== */
function Stat({ value, suffix, label, decimals = 0, delay }) {
  const [ref, inView] = useInView({ threshold: 0.4 })
  const current = useCountUp(value, inView, 1700)

  return (
    <li ref={ref} className={`stat ${inView ? 'is-visible' : ''}`} style={{ '--reveal-delay': `${delay}ms` }}>
      <strong>
        {current.toLocaleString(undefined, {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        })}
        <span>{suffix}</span>
      </strong>
      <span className="stat__label">{label}</span>
    </li>
  )
}

function StatsBand() {
  return (
    <section className="statsband">
      <div className="statsband__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="shell statsband__inner">
        <h2 className="statsband__title">
          Numbers from teams
          <br />
          already on board
        </h2>
        <ul className="statsband__grid">
          {stats.map((item, index) => (
            <Stat key={item.label} {...item} delay={index * 90} />
          ))}
        </ul>
      </div>
    </section>
  )
}

/* ===== components/HowItWorks.jsx ===== */
/* Three posters hanging on wires against a dark wall:
   1. orange — "Fix it once. Clear it everywhere." with a dashboard peeking in
   2. dark   — "Eight systems. One login." with glowing rings and the app icon
   3. cream  — "Faster sign-offs. Fewer follow-ups." with a 92.4% progress ring */

const EXCEPTIONS = [
  ['PO not found in Books', 'RECORD_NOT_FOUND', 'Critical', 'red', 64],
  ['Desk API timeout (30s)', 'TIMEOUT', 'High', 'orange', 96],
  ['Email token expired', 'invalid_grant', 'Critical', 'red', 22],
  ['Low confidence: vendor name', 'CONFIDENCE_BELOW_0.70', 'Medium', 'amber', 41],
  ['Duplicate invoice detected', 'DUPLICATE_HASH', 'Low', 'pink', 22],
  ['CRM rate limited', 'HTTP_429', 'Medium', 'amber', 12],
]

const SIDEBAR = [
  ['Workspace', ['Overview', 'Workflows', 'Templates', 'Workflow Builder', 'AI Configuration', 'Test Run', 'Review Queue', 'Analytics']],
  ['Operations', ['Runs & Logs', 'Exceptions', 'Connections', 'Data Sources']],
  ['Administration', ['Team & Permissions', 'Notifications', 'Usage & Billing', 'Audit Log', 'System Settings']],
]

// Tiny sparkline paths for the "Runs" column
const SPARKS = [
  'M0 6 L5 5 L10 6 L15 3 L20 4 L25 1',
  'M0 4 L4 1 L8 6 L12 2 L16 6 L20 2 L25 4',
  'M0 6 L6 5 L12 5 L18 2 L25 1',
  'M0 4 L6 3 L12 4 L18 3 L25 3',
  'M0 5 L5 2 L10 6 L15 3 L20 5 L25 2',
  'M0 6 L6 6 L10 2 L14 6 L20 4 L25 5',
]

const Brand = ({ tone }) => (
  <span className={`hw__brand hw__brand--${tone}`}>
    <span className="hw__brand-mark">
      <img src="/home-export/images/bishnoi-logo.png" alt="" />
    </span>
    Bishnoi One
  </span>
)

function HowItWorks() {
  const [ref, inView] = useInView({ threshold: 0.15 })

  // Scroll progress through the section (-1 entering → 1 leaving) drives a
  // gentle drift and tilt on each poster, like paper moving on its wires.
  useEffect(() => {
    const el = ref.current
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let frame = 0
    const update = () => {
      frame = 0
      const r = el.getBoundingClientRect()
      const vh = window.innerHeight
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / ((vh + r.height) / 2)))
      el.style.setProperty('--p', p.toFixed(3))
    }
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update)
    }
    update()
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
    }
  }, [ref])
  const pct = 92.4
  const R = 52
  const C = 2 * Math.PI * R

  return (
    <section className={`hw ${inView ? 'is-in' : ''}`} id="how" ref={ref} aria-label="Bishnoi One in practice">
      <div className="hw__wall">
        {/* 1 — Orange poster */}
        <article className="hw__poster hw__poster--orange" style={{ '--i': 0 }}>
          <span className="hw__wire hw__wire--l" aria-hidden="true" />
          <span className="hw__wire hw__wire--r" aria-hidden="true" />
          <h3>Fix it once. Clear it everywhere.</h3>

          <div className="hw__shot" aria-hidden="true">
            <div className="hw__chrome">
              <i /><i /><i />
              <span className="hw__url">Bishnoi One · Exceptions</span>
            </div>
            <div className="hw__app">
              <aside className="hw__side">
                <span className="hw__side-brand">
                  <img src="/home-export/images/bishnoi-logo.png" alt="" /> Bishnoi One
                </span>
                {SIDEBAR.map(([group, items]) => (
                  <div key={group} className="hw__side-group">
                    <em>{group}</em>
                    {items.map((item) => (
                      <span key={item} className={item === 'Exceptions' ? 'is-on' : ''}>
                        {item}
                        {item === 'Templates' ? <b>180</b> : null}
                        {item === 'Notifications' ? <b>78</b> : null}
                      </span>
                    ))}
                  </div>
                ))}
              </aside>
              <div className="hw__main">
                <span className="hw__crumb">Operations › Exceptions</span>
                <b className="hw__h">Exceptions</b>
                <small>Grouped by root cause; one fix clears many runs.</small>
                <div className="hw__kpis">
                  <span><i className="hw__ico hw__ico--red">!</i><em>Open</em><b>23</b> 6 groups</span>
                  <span><i className="hw__ico hw__ico--green">✓</i><em>Auto-resolved today</em><b>41</b> by rules</span>
                </div>
                <div className="hw__tabs">
                  <span className="is-on">Open 23</span>
                  <span>Snoozed 4</span>
                  <span>Resolved 112</span>
                </div>
                <div className="hw__table">
                  <div className="hw__tr hw__th">
                    <span />
                    <span>Exception</span>
                    <span>Severity</span>
                    <span>Runs</span>
                  </div>
                  {EXCEPTIONS.map(([title, code, sev, tone, runs], i) => (
                    <div key={title} className="hw__tr">
                      <span><i className="hw__check" /></span>
                      <span>
                        <b>{title}</b>
                        <small>{code}</small>
                      </span>
                      <span><i className="hw__sev" data-tone={tone}>{sev}</i></span>
                      <span className="hw__runs">
                        {runs}
                        <svg viewBox="0 0 25 7"><path d={SPARKS[i]} /></svg>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="hw__note">3 of 6 open groups share one cause: connector credentials. Rotating the email token…</div>
                <b className="hw__h hw__h--sm">Rules at work</b>
                <small>Exceptions handled automatically before they reach you</small>
                <span className="hw__rule">Route “PO not found” to AP review</span>
                <span className="hw__rule">Retry HTTP 429 with exponential backoff</span>
              </div>
            </div>
          </div>

          <Brand tone="dark" />
        </article>

        {/* 2 — Dark poster (hangs a little higher) */}
        <article className="hw__poster hw__poster--dark" style={{ '--i': 1 }}>
          <span className="hw__wire hw__wire--l" aria-hidden="true" />
          <span className="hw__wire hw__wire--r" aria-hidden="true" />
          <h3>Eight systems. One login.</h3>

          <div className="hw__rings" aria-hidden="true" />
          <span className="hw__appicon" aria-hidden="true">
            <img src="/home-export/images/bishnoi-logo.png" alt="" />
          </span>
          <span className="hw__domain">Bishnoi One</span>
        </article>

        {/* 3 — Cream poster */}
        <article className="hw__poster hw__poster--cream" style={{ '--i': 2 }}>
          <span className="hw__wire hw__wire--l" aria-hidden="true" />
          <span className="hw__wire hw__wire--r" aria-hidden="true" />
          <h3>
            Faster sign-offs.
            <br />
            <span>Fewer follow-ups.</span>
          </h3>

          <div className="hw__gauge" aria-label={`${pct}% auto-processed this week`}>
            <svg viewBox="0 0 120 120">
              <defs>
                <linearGradient id="hw-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ff6a3d" />
                  <stop offset="55%" stopColor="#f59a7f" />
                  <stop offset="100%" stopColor="#c9b3e6" />
                </linearGradient>
              </defs>
              <circle className="hw__gauge-track" cx="60" cy="60" r={R} />
              <circle
                className="hw__gauge-arc"
                cx="60"
                cy="60"
                r={R}
                stroke="url(#hw-grad)"
                strokeDasharray={C}
                strokeDashoffset={inView ? C * (1 - pct / 100) : C}
              />
            </svg>
            <span className="hw__gauge-label">
              <b>{pct}%</b>
              <small>auto-processed this week</small>
            </span>
          </div>

          <Brand tone="cream" />
        </article>
      </div>
    </section>
  )
}

/* ===== components/Integrations.jsx ===== */
// Platform features shared by all eight systems. Each icon sits in a circle
// coloured from the brand palette.
const ROW_ONE = [
  { name: 'Single sign-on', icon: 'shield', tone: 'orange' },
  { name: 'Role-based access', icon: 'people', tone: 'blue' },
  { name: 'Live dashboards', icon: 'chart', tone: 'yellow' },
  { name: 'Workflow automation', icon: 'automation', tone: 'red' },
  { name: 'Approval flows', icon: 'check', tone: 'green' },
  { name: 'Full audit trail', icon: 'board', tone: 'forest' },
  { name: 'Real-time sync', icon: 'bolt', tone: 'orange' },
  { name: 'Works on any device', icon: 'globe', tone: 'blue' },
]

const ROW_TWO = [
  { name: 'Multi-branch stock', icon: 'pipeline', tone: 'green' },
  { name: 'Payroll and leave', icon: 'people', tone: 'yellow' },
  { name: 'Invoices and bills', icon: 'board', tone: 'orange' },
  { name: 'Budgets and forecasts', icon: 'chart', tone: 'forest' },
  { name: 'Smart alerts', icon: 'sparkle', tone: 'red' },
  { name: 'Custom reports', icon: 'pipeline', tone: 'blue' },
  { name: 'Bank-grade security', icon: 'shield', tone: 'green' },
  { name: 'Help whenever you need it', icon: 'headset', tone: 'yellow' },
]

function Row({ items, reverse = false }) {
  const doubled = [...items, ...items]
  return (
    <div className={`marquee ${reverse ? 'marquee--reverse' : ''}`}>
      <div className="marquee__track">
        {doubled.map((item, index) => (
          <span key={`${item.name}-${index}`} className="int-chip" data-tone={item.tone}>
            <span className="int-chip__mark">
              <Icon name={item.icon} size={16} />
            </span>
            {item.name}
          </span>
        ))}
      </div>
    </div>
  )
}

function Integrations() {
  return (
    <section className="section section--tight integrations">
      <div className="shell">
        <Reveal className="section-head section-head--center">
          <span className="eyebrow">
            <Icon name="sparkle" size={14} /> Everything included
          </span>
          <h2>Every feature, in every system</h2>
          <p className="lead">
            One login gives every team the same tools: access control, automation, approvals and live
            reporting, working the same way across all eight systems.
          </p>
        </Reveal>
      </div>

      <div className="integrations__rows">
        <Row items={ROW_ONE} />
        <Row items={ROW_TWO} reverse />
      </div>

      <div className="shell integrations__foot">
        <a className="link-arrow" href="#showcase">
          Explore the eight systems <Icon name="arrowRight" size={16} />
        </a>
      </div>
    </section>
  )
}

/* ===== components/CtaBand.jsx ===== */
/* Closing CTA banner: three colour columns, two-line headline and sub line on
   the left; on the right, the two buttons sit above an orange dome whose right
   foot lands on the screen edge. Inside the dome, two white orbit rings turn
   in opposite directions carrying feature icons. */

// Two orbit rings inside the dome; icons ride the rings as they turn.
// [glyph, angle on the ring in degrees]
const INNER = [
  ['shield', 200],
  ['check', 320],
  ['people', 80],
]
const OUTER = [
  ['automation', 160],
  ['chart', 235],
  ['board', 300],
  ['bolt', 20],
  ['headset', 90],
]

function Ring({ which, items }) {
  // Arc covers 78% of the circle, leaving a gap; a dot caps each end.
  const end = (0.78 * 360 * Math.PI) / 180
  return (
    <div className={`cta__ring cta__ring--${which}`}>
      <svg viewBox="0 0 100 100" className="cta__ring-line">
        <circle cx="50" cy="50" r="49" pathLength="100" strokeDasharray="78 22" />
        <circle className="cta__ring-dot" cx="99" cy="50" r="1.3" />
        <circle className="cta__ring-dot" cx={50 + 49 * Math.cos(end)} cy={50 + 49 * Math.sin(end)} r="1.3" />
      </svg>
      {items.map(([glyph, deg]) => (
        <span
          key={glyph}
          className="cta__node"
          style={{
            left: `${50 + 49 * Math.cos((deg * Math.PI) / 180)}%`,
            top: `${50 + 49 * Math.sin((deg * Math.PI) / 180)}%`,
          }}
        >
          <Icon name={glyph} size={18} />
        </span>
      ))}
    </div>
  )
}

function CtaBand() {
  const [ref, inView] = useInView({ threshold: 0.2 })

  return (
    <section className={`cta ${inView ? 'is-in' : ''}`} id="cta" ref={ref} aria-labelledby="cta-title">
      <div className="cta__inner">
        <div className="cta__copy">
          <h2 className="cta__title" id="cta-title">
            <span className="cta__word cta__word--1">Your business,</span>
            <span className="cta__word cta__word--2">finally connected.</span>
          </h2>

          <p className="cta__sub">
            Guides, templates and live sessions to help you set up every system and get your team running on
            Bishnoi One.
          </p>
        </div>
      </div>

      <div className="cta__stage">
        <div className="cta__actions">
          <a className="cta__btn cta__btn--solid" href="#systems">
            Access Systems
          </a>
          <a className="cta__btn cta__btn--outline" href="#how">
            Learn More
          </a>
        </div>

        <div className="cta__sun" aria-hidden="true">
          <div className="cta__orbit">
            <Ring which="outer" items={OUTER} />
            <Ring which="inner" items={INNER} />
          </div>
        </div>
      </div>
    </section>
  )
}

/* ===== components/Footer.jsx ===== */
const SOCIALS = ['LinkedIn', 'X', 'YouTube', 'Instagram']
const LEGAL = ['Privacy', 'Terms', 'Cookies', 'Status', 'Accessibility']

// Small stroked line icons for the footer link columns (24px grid).
const GLYPHS = {
  rocket: 'M5 15c-1.5 1.5-2 5-2 5s3.5-.5 5-2M9 15l-3-3c1-4 4-8 9-9 0 0 1 6-6 12zM9 12l-4 1 2-4h3M12 15l-1 4 4-2v-3',
  briefcase: 'M4 7h16v13H4zM9 7V4h6v3M4 13h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  users: 'M16 20v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM17 11a3 3 0 0 0 0-6M21 20v-1a4 4 0 0 0-3-3.9',
  pen: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.5v.7M12 17h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  video: 'M3 6h12v12H3zM15 10l6-3v10l-6-3',
  chat: 'M4 5h16v11H9l-5 4z',
  code: 'M8 8l-4 4 4 4M16 8l4 4-4 4M14 5l-4 14',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7h.01',
  news: 'M4 5h13v14H6a2 2 0 0 1-2-2zM17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
}

const Glyph = ({ name }) => (
  <svg className="footer__glyph" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={GLYPHS[name]} />
  </svg>
)

function Footer() {
  return (
    <footer className="footer">
      <div className="shell footer__top">
        <div className="footer__brand">
          <OrbitLogo />
          <p>
            One platform for the work that runs your company. Built for teams who would rather get on
            with it than configure software.
          </p>
          <form className="footer__signup" onSubmit={(event) => event.preventDefault()}>
            <label className="sr-only" htmlFor="footer-email">
              Work email
            </label>
            <input id="footer-email" type="email" placeholder="you@company.com" required />
            <button type="submit" className="btn btn--gradient btn--sm">
              Get started
            </button>
          </form>
          <p className="footer__signupnote">Free forever plan. No card needed.</p>
        </div>

        <nav className="footer__cols" aria-label="Footer">
          <div className="footer__col">
            <h4>Product</h4>
            <ul>
              {systems.map((system) => (
                <li key={system.id}>
                  <a href={system.href}>
                    <span className="footer__logo">
                      <img src={system.logo} alt="" width="18" height="18" decoding="async" loading="lazy" />
                    </span>
                    {system.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>
          {footerColumns.map((column) => (
            <div key={column.title} className="footer__col">
              <h4>{column.title}</h4>
              <ul>
                {column.links.map(([label, icon, href]) => (
                  <li key={label}>
                    <a href={href || '#top'}>
                      <Glyph name={icon} />
                      {label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="shell footer__badges">
        <span>
          <Icon name="shield" size={16} /> SOC 2 Type II
        </span>
        <span>
          <Icon name="globe" size={16} /> GDPR compliant
        </span>
        <span>
          <Icon name="check" size={16} /> 99.9% uptime SLA
        </span>
        <span>
          <Icon name="star" size={16} /> 4.8 / 5 average rating
        </span>
      </div>

      <div className="shell footer__bottom">
        <p>© {new Date().getFullYear()} Bishnoi One. All rights reserved.</p>
        <ul className="footer__legal">
          {LEGAL.map((item) => (
            <li key={item}>
              <a href="#top">{item}</a>
            </li>
          ))}
        </ul>
        <ul className="footer__social">
          {SOCIALS.map((item) => (
            <li key={item}>
              <a href="#top" aria-label={item}>
                {item.charAt(0)}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </footer>
  )
}

/* ===== Page ===== */
export { Navbar, Footer }

export default function HomePage() {
  return (
    <>
      <Hero />
      <SystemsRail />
      <ProductShowcase />
      <DashboardStage />
      <Statement />
      <PeoplePills />
      <QuoteBand />
      <WordsSplit />
      <WorkflowStages />
      <ApproveSmarter />
      <Capabilities />
      <StatsBand />
      <HowItWorks />
      <Integrations />
      <CtaBand />
    </>
  )
}

// Added by scope-home-export.mjs: shared with site-nav.tsx, systems-section.tsx and index.tsx.
export { OrbitLogo, Icon, useScrollPosition, useInView, products, SystemDemo, Hero, SystemsRail, ProductShowcase, DashboardStage, Statement, PeoplePills, QuoteBand, WordsSplit, WorkflowStages, ApproveSmarter, Capabilities, StatsBand, HowItWorks, Integrations, CtaBand }
