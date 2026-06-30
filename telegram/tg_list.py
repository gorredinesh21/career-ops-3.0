#!/usr/bin/env python3
"""List your Telegram channels/groups (so you can pick the job ones).

  python telegram/tg_list.py            # channels + megagroups
  python telegram/tg_list.py --all      # include 1:1 chats and small groups too
"""
import sys, asyncio
from pathlib import Path
from telethon import TelegramClient

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
SESSION = str(HERE / "career_ops")

JOB_KW = ["job", "hiring", "hire", "intern", "career", "placement", "off campus",
          "offcampus", "off-campus", "fresher", "vacancy", "vacancies", "recruit",
          "opening", "walkin", "walk-in", "naukri", "developer", "engineer", "sde",
          "data", "ml", "ai ", "software", "tech jobs", "it jobs", "remote"]


def load_env():
    import os
    for l in (HERE / ".env").read_text(encoding="utf-8").splitlines():
        l = l.strip()
        if l and not l.startswith("#") and "=" in l:
            k, v = l.split("=", 1); os.environ.setdefault(k.strip(), v.strip())
    return int(os.environ["TG_API_ID"]), os.environ["TG_API_HASH"]


async def main(show_all):
    api_id, api_hash = load_env()
    client = TelegramClient(SESSION, api_id, api_hash)
    await client.connect()
    if not await client.is_user_authorized():
        sys.exit("Not logged in — run tg_auth.py first.")
    rows = []
    async for d in client.iter_dialogs():
        e = d.entity
        is_channel = getattr(e, "broadcast", False)
        is_group = d.is_group
        if not show_all and not (is_channel or is_group):
            continue
        kind = "channel" if is_channel else ("group" if is_group else "chat")
        uname = getattr(e, "username", None)
        rows.append((kind, d.name or "", f"@{uname}" if uname else "", str(d.id)))
    # channels first, then groups
    order = {"channel": 0, "group": 1, "chat": 2}
    rows.sort(key=lambda r: (order.get(r[0], 3), r[1].lower()))

    def fmt(rs):
        out = [f"{'KIND':8} {'TITLE':40} {'USERNAME':26} {'ID'}", "-" * 100]
        for kind, title, uname, cid in rs:
            out.append(f"{kind:8} {title[:38]:40} {uname[:24]:26} {cid}")
        return "\n".join(out)

    # full dump to a UTF-8 file (avoids console encoding limits)
    dump = HERE / "dialogs.txt"
    dump.write_text(fmt(rows) + f"\n\nTotal: {len(rows)}\n", encoding="utf-8")

    # likely job channels (keyword match on title/username)
    jobs = [r for r in rows if any(k in (r[1] + " " + r[2]).lower() for k in JOB_KW)]
    print("LIKELY JOB CHANNELS (keyword match):\n")
    print(fmt(jobs))
    print(f"\nMatched {len(jobs)} of {len(rows)} channels/groups.")
    print(f"Full list written to {dump}")
    await client.disconnect()


if __name__ == "__main__":
    asyncio.run(main("--all" in sys.argv))
