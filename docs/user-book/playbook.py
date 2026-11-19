# The playbook (Aryan, 19 Nov: "a proper playbook: every single thing shown well, step by step"):
# every task as its own page, numbered steps with what happens next on the left and its own screen
# on the right. Reads the procedures (procedures/*.md, written from the code), the screens (img/p-*,
# taken from the local copy by shoot.mjs from shots.json, which this file writes), and gives
# build.py its pages. The company's password is never written here.
#
#   python3 playbook.py --shots   writes shots.json (what to photograph, for shoot.mjs)

import html
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).parent
PROC = HERE / "procedures"
E = html.escape

# The book's parts, in the order an order travels; each is (file, the ## parts it takes, its title, who it is for).
PARTS = [
    ("leads-hr-ceo-admin", ["Part 1. Everyone's basics"], "Everyone's basics", "Everyone: signing in, your day, messages, leave, payslips"),
    ("sellers", None, "Sellers", "Hospital CHC, Rx CHC, Telesales, NBD, CRR, CLIDP, Bidding, PAP, Modern Trade"),
    ("online", None, "The Online desk", "B2C CHC (Online desk) and the PAP officer's case page"),
    ("leads-hr-ceo-admin", ["Part 2. Team leads and heads"], "Team leads and heads", "Sales coaches, B2B coaches, mentors and heads"),
    ("mgmt-finance", None, "Management and Finance", "The Management desk and the Finance desk"),
    ("dispatch-inventory", None, "Dispatch, Inventory and Buying", "The warehouse, stock and medicines, vendors and bills"),
    ("leads-hr-ceo-admin", ["Part 3. HR", "Part 4. The CEO", "Part 5. The Admin"], "HR, the CEO and the Admin", "People and pay, the company's numbers, the company's setup"),
]
# Notes the writers left for us, never for staff.
SKIP_PART = re.compile(r"not for staff|for the editor|missing or broken", re.I)


def inline(text: str) -> str:
    """Markdown's **bold**, *italic* and `code` inside one line, escaped."""
    text = E(text)
    text = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", text)
    text = re.sub(r"(?<![*\w])\*(?!\s)(.+?)\*(?!\w)", r"<i>\1</i>", text)
    text = re.sub(r"`(.+?)`", r"<span class='mono'>\1</span>", text)
    return text


def parse(path: Path):
    """The file's opening words (before the first task) and each `### title` task: its fields (Who,
    When), its steps (each with the bullets under it), what happens next, good to know, the screen."""
    intro, out = [], []
    part = current = field = None
    for raw in path.read_text().splitlines():
        line = raw.rstrip()
        if line.startswith("# "):
            continue
        if line.startswith("## "):
            part = line[3:].strip()
            current = None
            continue
        if line.startswith("### "):
            title = re.sub(r"^\d+\.\s*", "", line[4:].strip())
            current = {"title": title, "part": part, "fields": {}, "steps": [], "notes": [], "next": [], "screen": ""}
            out.append(current)
            field = None
            continue
        if current is None:
            if part is None and line.strip() and line.strip() != "---":
                intro.append(line)
            continue
        indent = len(raw) - len(raw.lstrip())
        m = re.match(r"^\s*[-*]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$", line)
        if m and indent < 2 and re.match(r"(who|when|steps?|what happens|good to know|screen)", m.group(1).lower()):
            name = m.group(1).strip().rstrip(":").lower()
            rest = m.group(2).strip()
            field = name
            if name.startswith("step"):
                if rest:
                    current["steps"].append([rest, []])
            elif name.startswith("what happens"):
                if rest:
                    current["next"].append(rest)
            elif name.startswith("good to know"):
                if rest:
                    current["notes"].append(rest)
            elif name.startswith("screen"):
                current["screen"] = rest
            else:
                current["fields"][name] = rest
            continue
        step = re.match(r"^\s*(\d+)[.)]\s+(.*)$", line)
        bullet = re.match(r"^\s*[-*]\s+(.*)$", line)
        text = step.group(2) if step else bullet.group(1) if bullet else line.strip()
        if not text or text == "---":
            continue
        if field and field.startswith("step"):
            if step and indent < 5:
                current["steps"].append([text, []])
            elif bullet and current["steps"] and indent >= 4:
                current["steps"][-1][1].append(text)
            elif bullet or not current["steps"]:
                current["steps"].append([text, []])
            elif current["steps"][-1][1]:
                current["steps"][-1][1][-1] += " " + text
            else:
                current["steps"][-1][0] += " " + text
        elif field and (field.startswith("what happens") or field.startswith("good to know")):
            bucket = current["next"] if field.startswith("what happens") else current["notes"]
            if bullet or step or not bucket:
                bucket.append(text)
            else:
                bucket[-1] += " " + text
        elif field and field.startswith("screen"):
            current["screen"] += " " + text
        elif field in ("who", "when"):
            current["fields"][field] += " " + text
    return intro, out


# ---- The screens -------------------------------------------------------------------------------

LOGIN_WORDS = [
    (r"Management desk", "desk:management"), (r"Finance desk", "desk:finance"), (r"Dispatch desk", "desk:dispatch"),
    (r"Management \(mgmt\)|Management own login", "mgmt"), (r"Finance \(fin\)", "fin"), (r"Inventory \(inv2\)", "inv2"),
]
# Seats with no session on the local copy take a like seat's.
LIKE = {"bid1": "bid2", "tl14": "tl3"}


def screen_spec(text: str):
    """The first page a Screen line names: its path, whose login, what to scroll to, a button to press."""
    if not text:
        return None
    first = re.split(r";\s|, then |\. Then | then ", text)[0]
    path = re.search(r"`(/[^`]*)`", first)
    if not path or re.search(r"[<(]", path.group(1)):
        return None
    who = re.search(r"(?:as|login)\s+`([\w:]+)`", first) or re.search(r"(?:as|login)\s+`([\w:]+)`", text)
    who = who.group(1) if who else None
    if not who:
        for pattern, key in LOGIN_WORDS:
            if re.search(pattern, first):
                who = key
                break
    if "signed out" in first:
        who = None
    scroll = re.search(r"[Ss]croll(?:ed)? to:?\s+(?:\*\*|\")(.+?)(?:\*\*|\")", first)
    click = re.search(r"(?:press(?:ing)?|click|tap|after pressing)\s+(?:\*\*|\")(.+?)(?:\*\*|\")", first)
    return {
        "who": LIKE.get(who, who),
        "path": path.group(1),
        "scroll": scroll.group(1) if scroll else None,
        "click": click.group(1) if click else None,
        "phone": "phone width" in first,
    }


def tasks():
    """Every task of the book, in its part, with the screen it shows."""
    files = {}
    book = []
    for key, wanted, title, who in PARTS:
        if key not in files:
            files[key] = parse(PROC / f"proc-{key}.md")
        intro, found = files[key]
        chosen = [t for t in found if (wanted is None or t["part"] in wanted) and not SKIP_PART.search(t["part"] or "")]
        book.append({"title": title, "who": who, "intro": intro if wanted is None else [], "tasks": chosen})
    n = 0
    for part in book:
        for task in part["tasks"]:
            n += 1
            task["n"] = n
            spec = OVERRIDES.get(task["title"], screen_spec(task["screen"]))
            task["shot"] = f"p{n:03d}" if spec else None
            if task["shot"] and not (HERE / "img" / f"{task['shot']}.jpg").exists():
                # Not photographed for the playbook: the screenshot taken earlier of the same page, if any.
                path = spec["path"].split("?")[0]
                task["shot"] = EARLIER_BY_LOGIN.get((spec["who"], path)) or (EARLIER.get(path) if path not in ("/", "/orders") else None)
                if task["shot"]:
                    spec = {**spec, "phone": task["shot"].startswith("phone")}
                    task["spec"] = spec
            task["spec"] = spec
            task["full"] = task["title"] == "The target sheet"
    return book


# Screens the lines above can't read on their own (an order "of hos1's", a window to open), set by hand
# with the local copy's own numbers. None: no picture (the page gives its steps in full instead).
# The screenshots taken for the book's first part (its overview), by the page they show.
EARLIER = {
    "/orders/new": "order-new", "/to-call": "hos-tocall", "/leads": "online-leads", "/inventory/overview": "inventory",
    "/hr/attendance": "hr-working", "/messages": "messages", "/customers/62478": "hospital-history", "/my/area": "my-hospitals",
    "/orders": "my-orders", "/collections": "collections", "/visits": "visits", "/my/score": "score", "/huddle": "huddle",
    "/key-reports/target-sheet": "target-sheet", "/zoho-reports/orders": "old-history", "/finance/prepaid": "fin-prepaid",
    "/medicines": "medicines", "/inventory": "stock", "/pap": "pap-cases", "/tenders": "bid-tenders", "/purchases": "buy-board",
    "/purchases/orders/new": "po-new", "/purchases/orders": "po-list", "/purchases/vendors": "vendors", "/purchases/receives": "receives",
    "/visits/plan": "visit-plan", "/visits/expenses": "expenses", "/me/samples": "samples", "/me/leave": "leave", "/inbox": "inbox",
    "/points": "points", "/returns": "returns", "/refunds": "refunds", "/complaints": "complaints", "/invoices": "invoices",
    "/hr/payroll/2026-11": "payroll", "/transfers": "transfers", "/inventory/trace": "trace", "/inventory/requests": "requests",
    "/admin/data-checks": "data-checks", "/team-scores": "scorecards", "/field/report": "field-report", "/field/live": "field-live",
    "/key-reports/channels": "key-channels", "/collect": "fin-due", "/login": "login", "/leads/133": "online-case", "/leads/134": "online-b2b",
    "/orders/265": "order-checks", "/orders/232": "hos-order-mgmt", "/orders/213": "rx-order", "/orders/224": "clidp-order",
    "/orders/222": "bid-order", "/orders/220": "nbd-pack", "/orders/225": "ts-finance", "/orders/219": "order-timeline",
}


# Home and the order list differ by login: the earlier screenshot of that login's own.
EARLIER_BY_LOGIN = {
    ("hos1", "/"): "hos-home", ("rx1", "/"): "rx-home", ("b2b3", "/"): "crr-home", ("ceo", "/"): "ceo-home",
    ("admin", "/"): "admin-channels", ("tl2", "/"): "tl-home", ("desk:management", "/"): "mgmt-desk",
    ("desk:finance", "/"): "fin-board", ("desk:dispatch", "/"): "dispatch", ("hr1", "/"): "hr-people",
    ("staff3", "/"): "worklog", ("hos1", "/orders"): "my-orders", ("tl2", "/orders"): "team-orders",
}


def _s(who, path, scroll=None, click=None, phone=False):
    return {"who": who, "path": path, "scroll": scroll, "click": click, "phone": phone}


OVERRIDES: dict = {
    "Fix an order Management sent back": _s("hos1", "/orders/201"),
    "Answer a hold, or cancel your order": _s("hos1", "/orders/232"),
    "Ask for a return of delivered goods": _s("hos1", "/orders/199", click="Request refund"),
    "Set a customer's next refill day": _s("online1", "/customers/91939", scroll="Next refill", click="Set the day"),
    "Open a customer's page": _s("hos1", "/customers/62478"),
    "PAP: place the order, send the claim and follow the payment": _s("online1", "/leads/4?step=letter"),
    "Place the order": _s("online1", "/leads/133?step=order"),
    "Hand it over: mark it delivered": None,
    "Decide on a new email sender": _s("online1", "/inbox"),
    "Find your way around on the phone": None,  # every seat's menu needs the page's width
    "Starting and ending your working day": _s("hos1", "/", phone=True),
    "Signing out": _s("hos1", "/", click="RA"),
    "Look at the bank in Books": None,  # the Books screens keep the old look: not in the book (Aryan, 19 Nov)
    "Reject an order": _s("desk:management", "/orders/217?step=management&check=approve", click="Reject"),
    "Cancel an order": _s("desk:management", "/orders/217?step=management"),
    "Hold with a question (ask the Team Lead or Business Mentor)": _s("desk:management", "/orders/206?step=management"),
    "Switching between your teams": _s("tl3", "/my-team"),
}


if __name__ == "__main__" and "--shots" in sys.argv:
    shots = []
    for part in tasks():
        for t in part["tasks"]:
            if t["spec"]:
                shots.append({"name": t["shot"], "title": t["title"], **t["spec"]})
            if t["full"]:
                shots.append({"name": "tracker-full", "title": "The whole target sheet", **_s("ceo", "/key-reports/target-sheet"), "full": True})
    (HERE / "shots.json").write_text(json.dumps(shots, indent=1))
    print(f"shots.json: {len(shots)} screens")


# ---- The pages ---------------------------------------------------------------------------------

def paragraphs(lines):
    """The opening words as paragraphs and bullets, without the notes meant for whoever took the pictures."""
    out = []
    for line in lines:
        bullet = re.match(r"^\s*[-*]\s+(.*)$", line)
        if bullet:
            out.append(["li", bullet.group(1).strip(), len(line) - len(line.lstrip())])
        elif out and out[-1][0] in ("p", "li"):
            out[-1][1] += " " + line.strip()
        else:
            out.append(["p", line.strip(), 0])
    noise = re.compile(r"Screens below|login to take the picture|local copy|Logins are seat IDs|phone width|Each task below is one procedure|Each task is one procedure", re.I)
    keep = [b for b in out if not noise.search(b[1])]
    body, open_list = "", False
    for kind, text, indent in keep:
        if kind == "li" and indent < 2:
            body += ("" if open_list else "<ul>") + f"<li>{inline(text)}</li>"
            open_list = True
            continue
        if kind == "li":  # a bullet under a bullet: kept short, on the line above's list
            body += ("" if open_list else "<ul>") + f"<li class='sub'>{inline(text)}</li>"
            open_list = True
            continue
        if open_list:
            body += "</ul>"
            open_list = False
        body += f"<p>{inline(text)}</p>"
    return body + ("</ul>" if open_list else "")


def cap(text: str) -> str:
    """The first letter made capital (the writers' lines often start after a colon)."""
    return text[:1].upper() + text[1:]


def foot(label: str) -> str:
    return f'<footer><span>Bishnoi One · {E(label)}</span><span class="pg"></span></footer>'


def task_page(part, task, count) -> str:
    f = task["fields"]
    who = f"<span><b>Who</b> {inline(cap(f['who']))}</span>" if f.get("who") else ""
    when = f"<span><b>When</b> {inline(cap(f['when']))}</span>" if f.get("when") else ""
    steps = "".join(
        f"<li>{inline(text)}" + (f"<ul>{''.join(f'<li>{inline(s)}</li>' for s in subs)}</ul>" if subs else "") + "</li>"
        for text, subs in task["steps"]
    )
    nxt = (
        "<div class='next'><h4>What happens next</h4>" + "".join(f"<p>{inline(cap(t))}</p>" for t in task["next"]) + "</div>"
        if task["next"]
        else ""
    )
    notes = (
        "<div class='good'><h4>Good to know</h4><ul>" + "".join(f"<li>{inline(cap(t))}</li>" for t in task["notes"]) + "</ul></div>"
        if task["notes"]
        else ""
    )
    left = f"<ol class='steps'>{steps}</ol>{nxt}"
    if task["shot"]:
        phone = task["spec"]["phone"]
        fig = f"<figure class='shot{' phone' if phone else ''}'><img src='img/{task['shot']}.jpg' alt=''></figure>"
        body = f"<div class='pbody{' withphone' if phone else ''}'><div class='pl fit'>{left}</div><div class='pr fit'>{fig}{notes}</div></div>"
    else:
        body = f"<div class='pbody text'><div class='pl fit'>{left}</div><div class='pr fit'>{notes}</div></div>"
    return (
        f"<section class='slide proc'><header class='phd'><p class='kick'>{E(part['title'])} · {task['in_part']} of {count}</p>"
        f"<h2>{inline(task['title'])}</h2><p class='ww'>{who}{when}</p></header>{body}{foot('Playbook')}</section>"
    )


def part_page(part, number, pages) -> str:
    items = "".join(
        f"<li><span>{inline(t['title'])}</span><b>{pages[t['n']]}</b></li>" for t in part["tasks"]
    )
    intro = paragraphs(part["intro"]) if part["intro"] else ""
    return (
        f"<section class='slide divider'><div class='dl fit'><p class='kick'>Part {number}</p><h1>{E(part['title'])}</h1>"
        f"<p class='for'>{E(part['who'])}</p><div class='intro'>{intro}</div></div>"
        f"<div class='dr fit'><h4>In this part</h4><ol class='toc'>{items}</ol></div>{foot('Playbook')}</section>"
    )


def tracker_page() -> str:
    """The target sheet (Aryan's tracker, 18 Nov: "in one click") whole, in two halves side by side."""
    return (
        "<section class='slide tracker'><header class='thd'><p class='kick'>HR, the CEO and the Admin · the tracker</p>"
        "<h2>The target sheet, whole</h2><p class='sub'>The daily tracker the heads kept in Excel, made by the system from the invoices: "
        "CEO menu › <b>Target sheet</b>. Left the top half, right the rest.</p></header>"
        "<div class='halves'><figure class='shot'><img src='img/tracker-full-1.jpg' alt=''></figure>"
        "<figure class='shot'><img src='img/tracker-full-2.jpg' alt=''></figure></div>" + foot("Playbook") + "</section>"
    )


def render(first_page: int):
    """The playbook's pages, the first being page first_page; and each part's title and first page."""
    book = tasks()
    pages, page = {}, first_page
    starts = []
    for part in book:
        starts.append((part["title"], part["who"], page))
        page += 1
        for i, t in enumerate(part["tasks"], 1):
            t["in_part"] = i
            pages[t["n"]] = page
            page += 2 if t["full"] else 1
    out = []
    for number, part in enumerate(book, 1):
        out.append(part_page(part, number, pages))
        for t in part["tasks"]:
            out.append(task_page(part, t, len(part["tasks"])))
            if t["full"]:
                out.append(tracker_page())
    return out, starts


CSS = """
.proc { padding: 0.42in 0.55in 0.5in; }
.phd .kick { margin: 0; }
.phd h2 { margin: 2px 0 0; font-size: 21pt; line-height: 1.15; font-weight: 800; letter-spacing: -0.01em; }
.ww { margin: 6px 0 0; display: flex; flex-wrap: wrap; gap: 6px 10px; font-size: 9.5pt; color: #334155; }
.ww span { background: #fff; border: 1px solid #e2e8f0; border-radius: 999px; padding: 2px 10px; }
.ww b { color: #1f9d55; margin-right: 4px; }
.pbody { position: absolute; top: var(--top, 1.55in); bottom: 0.5in; left: 0.55in; right: 0.55in; display: grid; grid-template-columns: 1fr 1.12fr; gap: 0.3in; }
.pbody.withphone { grid-template-columns: 1fr 3.1in; }
.pbody.text { grid-template-columns: 1.25fr 1fr; }
.fit { overflow: hidden; font-size: var(--fs, 10.5pt); line-height: 1.42; min-height: 0; }
.steps { margin: 0; padding: 0; list-style: none; counter-reset: st; }
.steps > li { position: relative; padding: 0 0 0 30px; margin: 0 0 0.62em; counter-increment: st; color: #1e293b; }
.steps > li::before { content: counter(st); position: absolute; left: 0; top: 0.05em; width: 20px; height: 20px; border-radius: 999px; background: #1f9d55; color: #fff; font-size: 8.5pt; font-weight: 700; display: grid; place-items: center; }
.steps ul { margin: 0.25em 0 0; padding-left: 1.1em; }
.steps ul li { margin: 0 0 0.18em; }
.steps ul li::marker { color: #94a3b8; }
.next { margin-top: 0.6em; background: #ecfdf5; border: 1px solid #bbf7d0; border-left: 4px solid #1f9d55; border-radius: 10px; padding: 0.5em 0.8em; }
.next h4, .good h4 { margin: 0 0 0.2em; font-size: 0.82em; letter-spacing: .1em; text-transform: uppercase; color: #14532d; }
.next p { margin: 0 0 0.2em; }
.good { margin-top: 0.12in; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 0.5em 0.8em; }
.good h4 { color: #92400e; }
.good ul { margin: 0; padding-left: 1.1em; }
.good li { margin: 0 0 0.2em; }
.good li::marker { color: #d97706; }
.pr .shot img { max-height: var(--imgh, 4.15in); object-fit: cover; object-position: top left; }
.pr .shot.phone { width: 2.9in; border-radius: 22px; border: 5px solid #0f172a; }
.pr .shot.phone img { max-height: var(--imgh, 5.3in); }
.pbody.text .good { margin-top: 0; }
.divider { background: linear-gradient(135deg, #f0fdf4 0%, #f7faf8 60%); }
.dl { position: absolute; top: 0.6in; bottom: 0.6in; left: 0.6in; width: 5.3in; }
.dl h1 { margin: 4px 0 0; font-size: 34pt; line-height: 1.05; font-weight: 800; color: #14532d; letter-spacing: -0.02em; }
.dl .for { margin: 8px 0 14px; font-size: 12pt; color: #1f9d55; font-weight: 600; }
.intro p { margin: 0 0 0.5em; color: #1e293b; }
.intro ul { margin: 0 0 0.5em; padding-left: 1.1em; }
.intro li { margin: 0 0 0.25em; }
.intro li.sub { margin-left: 1.1em; list-style: circle; }
.dr { position: absolute; top: 0.6in; bottom: 0.6in; left: 6.3in; right: 0.6in; background: #fff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 0.2in 0.25in; }
.dr h4 { margin: 0 0 0.4em; font-size: 0.85em; letter-spacing: .1em; text-transform: uppercase; color: #1f9d55; }
.toc { margin: 0; padding: 0; list-style: none; columns: 2; column-gap: 0.3in; counter-reset: t; }
.toc li { break-inside: avoid; display: flex; gap: 8px; justify-content: space-between; padding: 0.22em 0; border-bottom: 1px dotted #cbd5e1; counter-increment: t; }
.toc li span::before { content: counter(t) ". "; color: #94a3b8; }
.toc li b { color: #14532d; }
.tracker { padding: 0.35in 0.5in 0.45in; }
.thd h2 { margin: 2px 0 0; font-size: 19pt; font-weight: 800; }
.thd .sub { margin: 3px 0 0; font-size: 10pt; }
.halves { position: absolute; top: 1.3in; bottom: 0.45in; left: 0.5in; right: 0.5in; display: grid; grid-template-columns: 1fr 1fr; gap: 0.2in; }
.halves .shot { display: flex; justify-content: center; align-items: flex-start; }
.halves .shot img { width: auto; max-width: 100%; max-height: 100%; height: auto; object-fit: contain; }
.contents .parts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.18in; }
.contents .pt { background: #fff; border: 1px solid #e2e8f0; border-top: 5px solid #1f9d55; border-radius: 14px; padding: 12px 14px; }
.contents .pt h3 { margin: 0; font-size: 13pt; display: flex; justify-content: space-between; gap: 8px; }
.contents .pt h3 b { color: #1f9d55; }
.contents .pt p { margin: 4px 0 0; font-size: 9.5pt; color: #475569; line-height: 1.4; }
"""

# Each page's words are made smaller, a step at a time, until they fit their column; then the picture
# is made shorter. A page that still doesn't fit is marked, and print.mjs names it.
FIT = """
<script>
(async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })));
  const over = (s) => [...s.querySelectorAll('.fit')].some((c) => c.scrollHeight > c.clientHeight + 1);
  const bad = [];
  document.querySelectorAll('.slide').forEach((s, i) => {
    const hd = s.querySelector('.phd'), body = s.querySelector('.pbody');
    if (hd && body) body.style.setProperty('--top', (hd.offsetTop + hd.offsetHeight) / 96 + 0.16 + 'in');
    let fs = 10.5, img = s.querySelector('.shot.phone') ? 5.3 : 4.15;
    while (over(s) && fs > 8.2) { fs -= 0.25; s.style.setProperty('--fs', fs + 'pt'); }
    while (over(s) && img > 2.4) { img -= 0.15; s.style.setProperty('--imgh', img + 'in'); }
    while (over(s) && fs > 7) { fs -= 0.25; s.style.setProperty('--fs', fs + 'pt'); }
    if (over(s)) bad.push(i + 1);
  });
  document.body.dataset.over = bad.join(',');
  document.body.dataset.fitted = '1';
})();
</script>
"""


# ---- The rules, from the plan (Aryan, 19 Nov: "print the plan in it") ------------------------------

PLAN = HERE.parent / "PLAN.md"
PLAN_PARTS = ["## 2.", "## 3.", "## 4.", "## 17.1", "## 18."]


def plan_html() -> str:
    """The plan's sections on the business, its people, the order line, where each thing is entered and
    the price book, flowing over as many pages as they take, two columns a page."""
    lines, keep = [], False
    for line in PLAN.read_text().splitlines():
        if line.startswith("## "):
            keep = any(line.startswith(p) for p in PLAN_PARTS)
        if keep:
            lines.append(line)
    joined = []
    for line in lines:
        wrapped = joined and line.startswith(" ") and line.strip() and not re.match(r"^\s*([-*]|\d+[.)])\s", line)
        if wrapped and re.match(r"^\s*([-*]|\d+[.)])\s", joined[-1]):
            joined[-1] += " " + line.strip()
        else:
            joined.append(line)
    lines = joined
    out, para, table, lists = [], [], [], []

    def flush():
        if para:
            out.append(f"<p>{inline(' '.join(para))}</p>")
            para.clear()
        if table:
            rows = [r for r in table if not re.match(r"^\|\s*:?-", r)]
            cells = [[c.strip() for c in r.strip().strip("|").split("|")] for r in rows]
            body = "".join("<tr>" + "".join(f"<{'th' if i == 0 else 'td'}>{inline(c)}</{'th' if i == 0 else 'td'}>" for c in row) + "</tr>" for i, row in enumerate(cells))
            out.append(f"<table>{body}</table>")
            table.clear()
        while lists:
            out.append(f"</{lists.pop()[1]}>")

    for raw in lines:
        line = raw.rstrip()
        if not line.strip():
            flush()
            continue
        h = re.match(r"^(#{2,4})\s+(.*)$", line)
        if h:
            flush()
            level = len(h.group(1))
            out.append(f"<h{level}>{inline(h.group(2))}</h{level}>")
            continue
        if line.startswith("|"):
            if para:
                flush()
            table.append(line)
            continue
        item = re.match(r"^(\s*)([-*]|\d+[.)])\s+(.*)$", line)
        if item:
            if para:
                out.append(f"<p>{inline(' '.join(para))}</p>")
                para.clear()
            depth = len(item.group(1))
            tag = "ol" if item.group(2)[0].isdigit() else "ul"
            while lists and lists[-1][0] > depth:
                out.append(f"</{lists.pop()[1]}>")
            if not lists or lists[-1][0] < depth:
                lists.append((depth, tag))
                out.append(f"<{tag}>")
            out.append(f"<li>{inline(item.group(3))}")
            continue
        if lists and raw.startswith(" "):
            out[-1] += " " + inline(line.strip())
            continue
        para.append(line.strip())
    flush()
    return (
        "<section class='planflow'><p class='kick'>The rules</p><h1>How the business runs: from the plan</h1>"
        "<p class='sub'>The business, its people and what each sees, the order line, where each thing is entered, and the price book.</p>"
        + "\n".join(out)
        + "</section>"
    )


PLAN_CSS = """
@page plan { size: 13.333in 7.5in; margin: 0.5in 0.6in 0.55in; }
.planflow { page: plan; break-before: page; columns: 2; column-gap: 0.45in; font-size: 9.5pt; line-height: 1.45; color: #1e293b; background: #fff; }
.planflow h1 { column-span: all; margin: 2px 0 4px; font-size: 24pt; font-weight: 800; color: #14532d; }
.planflow > .sub, .planflow > .kick { column-span: all; }
.planflow h2 { font-size: 13pt; color: #14532d; margin: 12px 0 4px; break-after: avoid; }
.planflow h3 { font-size: 11pt; margin: 10px 0 3px; break-after: avoid; }
.planflow h4 { font-size: 10pt; margin: 8px 0 2px; break-after: avoid; }
.planflow p { margin: 0 0 6px; }
.planflow ul, .planflow ol { margin: 0 0 6px; padding-left: 1.2em; }
.planflow li { margin: 0 0 3px; }
.planflow table { font-size: 8.5pt; margin: 4px 0 8px; break-inside: auto; }
.planflow th { background: #e7f6ee; text-align: left; padding: 3px 5px; }
.planflow td { padding: 3px 5px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
"""
