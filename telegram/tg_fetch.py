#!/usr/bin/env python3
"""Fetch job postings from a Telegram channel (default TechUprise) and ingest them into
career-ops exactly like board-scanned jobs:

  - parses each message into per-job blocks (TechUprise puts several jobs per post, each
    starting with a 'pin' marker), extracting company / role / location / experience / apply URL
  - appends NEW jobs to data/pipeline.md (Pendientes) + data/scan-history.tsv (dedup by URL)
  - auto-adds any company not already in portals.yml -> tracked_companies (scan_method: websearch)
  - dedups across runs via telegram/.tg-seen.json

Usage:
  python telegram/tg_fetch.py --preview --limit 8     # inspect, no writes
  python telegram/tg_fetch.py --days 2                # today + yesterday  (the daily scan)
  python telegram/tg_fetch.py --since 2026-06-01      # backlog from a date
  python telegram/tg_fetch.py --days 2 --dry-run      # show what would be written
"""
import sys, os, json, re, asyncio, unicodedata
from pathlib import Path
from datetime import datetime, timedelta, timezone
from telethon import TelegramClient

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SESSION = str(HERE / "career_ops")
SEEN_FILE = HERE / ".tg-seen.json"
PIPELINE = ROOT / "data" / "pipeline.md"
SCAN_HISTORY = ROOT / "data" / "scan-history.tsv"
PORTALS = ROOT / "portals.yml"
DEFAULT_CHANNEL = "@TechUprise_Updates"
PORTAL_LABEL = "Telegram/TechUprise"

URL_RE = re.compile(r"https?://[^\s)>\]]+")
PIN_RE = re.compile(r"(?m)^\s*📌\s*")  # TechUprise separates each job with a 📌 pin (🔹/• are in-post bullets)


def load_env():
    for l in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
    return int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"]


def norm(t):
    return unicodedata.normalize("NFKC", t or "")


def clean(s):
    s = norm(s)
    s = re.sub(r"[^\S\r\n]+", " ", s)
    return s.strip(" :*-–—\t|").strip()


def field(text, labels):
    for lab in labels:
        m = re.search(rf"(?im)^[^\n]*?\b{lab}\b\s*[:\-–]\s*(.+)$", text)
        if m:
            return clean(m.group(1))[:160]
    return None


def find_apply_url(block):
    for line in block.splitlines():
        if re.search(r"(?i)\b(apply|register|link|form|here)\b", line):
            m = URL_RE.search(line)
            if m and "t.me" not in m.group(0):
                return m.group(0).rstrip(".,)")
    for m in URL_RE.finditer(block):
        if "t.me" not in m.group(0):
            return m.group(0).rstrip(".,)")
    return None


def parse_block(b):
    b = norm(b)
    url = find_apply_url(b)
    company = role = None
    m = re.search(r"(?i)^(.{2,70}?)\s+is hiring\b\s*(?:(?:for|as)\b\s*)?[:\-]?\s*(.+?)(?:\n|$)", b)
    if m:
        company, role = clean(m.group(1)), clean(m.group(2))
    if not company:
        m = re.search(r"(?i)\bhiring\b\s*[:\-]?\s*(.+?)\s+\bat\b\s+(.+?)(?:[!\n]|$)", b)
        if m:
            role, company = clean(m.group(1)), clean(m.group(2))
    if not company:
        m = re.search(r"(?i)we(?:'re| are)?\s+hiring\s*[-–:]\s*(.+?)(?:\n|$)", b)
        if m:
            company = clean(m.group(1))
    role = role or field(b, ["role", "position", "profile", "designation", "post", "job title", "title"])
    company = company or field(b, ["company", "organization", "organisation", "org"])
    if not company:
        first = next((clean(l) for l in b.splitlines() if clean(l) and not re.match(r"(?i)(premium|opening|hiring|apply|batch|location|stipend|ctc)", clean(l))), None)
        company = first
    loc = field(b, ["location", "work location", "job location", "loc"])
    exp = field(b, ["experience", "batch", "eligibility", "exp", "qualification", "passout"])
    return {"company": (company or "")[:80], "role": (role or "")[:120],
            "location": loc, "experience": exp, "apply_url": url}


def extract_jobs(text):
    text = norm(text)
    parts = PIN_RE.split(text)
    blocks = [p.strip() for p in parts if p.strip()] if len(parts) > 1 else [text]
    jobs = []
    for b in blocks:
        j = parse_block(b)
        role_like = re.match(r"(?i)^(full[ -]?stack|front[ -]?end|back[ -]?end|software|data|ml|ai|devops|qa|sde|developer|engineer|analyst|intern)\b", (j["company"] or ""))
        j["is_job"] = bool(j["apply_url"] and j["role"] and j["company"] and not role_like)
        j["block"] = b[:600]
        jobs.append(j)
    return jobs


# ---- ingestion helpers ----
def existing_urls():
    urls = set()
    if SCAN_HISTORY.exists():
        for line in SCAN_HISTORY.read_text(encoding="utf-8").splitlines()[1:]:
            u = line.split("\t")[0]
            if u:
                urls.add(u)
    if PIPELINE.exists():
        for m in re.finditer(r"- \[[ x]\] (\S+)", PIPELINE.read_text(encoding="utf-8")):
            urls.add(m.group(1))
    return urls


def existing_companies():
    names = set()
    if PORTALS.exists():
        for m in re.finditer(r'(?im)^\s*-\s*name:\s*["\']?(.+?)["\']?\s*$', PORTALS.read_text(encoding="utf-8")):
            names.add(m.group(1).strip().lower())
    return names


def append_pipeline(jobs):
    text = PIPELINE.read_text(encoding="utf-8") if PIPELINE.exists() else "# Pipeline\n\n## Pendientes\n\n## Procesadas\n"
    block = "".join(f"- [ ] {j['apply_url']} | {j['company'] or 'Unknown'} | {j['role'] or 'Unknown role'}\n" for j in jobs)
    marker = "## Pendientes"
    idx = text.find(marker)
    if idx == -1:
        text += f"\n{marker}\n\n{block}"
    else:
        after = idx + len(marker)
        nxt = text.find("\n## ", after)
        ins = len(text) if nxt == -1 else nxt
        text = text[:ins] + "\n" + block + text[ins:]
    PIPELINE.write_text(text, encoding="utf-8")


def append_scan_history(jobs, rundate):
    if not SCAN_HISTORY.exists():
        SCAN_HISTORY.write_text("url\tfirst_seen\tportal\ttitle\tcompany\tstatus\tlocation\n", encoding="utf-8")
    with SCAN_HISTORY.open("a", encoding="utf-8") as f:
        for j in jobs:
            f.write(f"{j['apply_url']}\t{rundate}\t{PORTAL_LABEL}\t{j['role']}\t{j['company']}\tadded\t{j['location'] or ''}\n")


def add_companies(new_names, rundate):
    if not new_names:
        return
    text = PORTALS.read_text(encoding="utf-8")
    m = re.search(r"(?m)^tracked_companies:\s*$", text)
    if not m:
        return
    entries = "".join(
        f'  - name: "{n}"\n    scan_method: websearch\n    source: "telegram:TechUprise"\n    added: "{rundate}"\n    enabled: true\n'
        for n in new_names
    )
    ins = m.end()
    text = text[:ins] + "\n" + entries + text[ins:]
    PORTALS.write_text(text, encoding="utf-8")


async def run(channel, days, since, limit, preview, dry):
    api_id, api_hash = load_env()
    client = TelegramClient(SESSION, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        sys.exit("Not logged in — run tg_auth.py first.")
    cutoff = None
    if since:
        cutoff = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    elif days is not None:
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    msgs = []
    async for mm in client.iter_messages(channel, limit=(limit or 500)):
        if cutoff and mm.date < cutoff:
            break
        if (mm.message or "").strip():
            msgs.append(mm)
    await client.disconnect()

    if preview:
        for mm in msgs[: (limit or 12)]:
            print("=" * 80, f"\n[id {mm.id}] {mm.date.isoformat()}\n" + (mm.message or "")[:700])
        print(f"\n--- {len(msgs)} messages ---")
        return

    seen = set(json.loads(SEEN_FILE.read_text())) if SEEN_FILE.exists() else set()
    known_urls = existing_urls()
    known_companies = existing_companies()
    rundate = datetime.now().strftime("%Y-%m-%d")

    all_rows, new_jobs, new_companies = [], [], []
    seen_company_lower = set()
    for mm in msgs:
        if mm.id in seen:
            continue
        seen.add(mm.id)
        for j in extract_jobs(mm.message):
            j["msg_id"] = mm.id
            j["date"] = mm.date.date().isoformat()
            all_rows.append(j)
            if not j["is_job"]:
                continue
            if j["apply_url"] in known_urls:
                continue
            known_urls.add(j["apply_url"])
            new_jobs.append(j)
            cl = (j["company"] or "").lower().strip()
            if cl and cl not in known_companies and cl not in seen_company_lower and cl != "unknown":
                seen_company_lower.add(cl)
                new_companies.append(j["company"])

    (HERE / f"tg-jobs-{rundate}.json").write_text(json.dumps(all_rows, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"Messages: {len(msgs)} | parsed job blocks: {len(all_rows)} | NEW jobs: {len(new_jobs)} | NEW companies: {len(new_companies)}")
    for j in new_jobs:
        print(f"  + {j['company'] or '?'} | {j['role'] or '?'} | {j['location'] or ''} | {j['apply_url']}")
    if new_companies:
        print("  new companies -> tracked: " + ", ".join(new_companies))

    if dry:
        print("\n(dry-run — no files written)")
        return
    if new_jobs:
        append_pipeline(new_jobs)
        append_scan_history(new_jobs, rundate)
    add_companies(new_companies, rundate)
    SEEN_FILE.write_text(json.dumps(sorted(seen)), encoding="utf-8")
    print(f"\nWrote {len(new_jobs)} to pipeline.md + scan-history.tsv; added {len(new_companies)} companies to portals.yml.")
    print("Next: evaluate them with the pipeline mode (same as board jobs).")


if __name__ == "__main__":
    a = sys.argv[1:]
    def opt(name, d=None):
        return a[a.index(name) + 1] if name in a and a.index(name) + 1 < len(a) else d
    channel = opt("--channel", DEFAULT_CHANNEL)
    days = int(opt("--days")) if "--days" in a else None
    since = opt("--since")
    limit = int(opt("--limit")) if "--limit" in a else None
    preview = "--preview" in a
    dry = "--dry-run" in a
    if not (days or since or preview or limit):
        days = 2
    asyncio.run(run(channel, days, since, limit, preview, dry))
