#!/usr/bin/env python3
"""Two-step Telegram (MTProto) login so no interactive stdin is needed.

  python telegram/tg_auth.py request                          # sends login code to your Telegram
  python telegram/tg_auth.py signin --code 12345              # completes login
  python telegram/tg_auth.py signin --code 12345 --password X # if you have 2FA enabled

Produces telegram/career_ops.session (== full account access; gitignored).
Reads creds from telegram/.env (TG_API_ID, TG_API_HASH, TG_PHONE).
"""
import os, sys, asyncio
from pathlib import Path
from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError, PhoneCodeInvalidError

HERE = Path(__file__).resolve().parent
SESSION = str(HERE / "career_ops")
HASH_FILE = HERE / ".code_hash.tmp"


def load_env():
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    api_id = os.environ.get("TG_API_ID")
    api_hash = os.environ.get("TG_API_HASH")
    phone = os.environ.get("TG_PHONE")
    if not (api_id and api_hash and phone):
        sys.exit("Missing TG_API_ID / TG_API_HASH / TG_PHONE — fill telegram/.env (copy from .env.example).")
    return int(api_id), api_hash, phone


async def request():
    api_id, api_hash, phone = load_env()
    client = TelegramClient(SESSION, api_id, api_hash)
    await client.connect()
    try:
        if await client.is_user_authorized():
            me = await client.get_me()
            print(f"Already logged in as {me.first_name} (@{me.username}). Nothing to do.")
            return
        sent = await client.send_code_request(phone)
        HASH_FILE.write_text(sent.phone_code_hash, encoding="utf-8")
        print(f"OK — Telegram sent a login code to {phone} (check your Telegram app, then SMS).")
        print("Next: python telegram/tg_auth.py signin --code <THE_CODE>")
    finally:
        await client.disconnect()


async def signin(code, password):
    api_id, api_hash, phone = load_env()
    client = TelegramClient(SESSION, api_id, api_hash)
    await client.connect()
    try:
        if await client.is_user_authorized():
            me = await client.get_me()
            print(f"Already logged in as {me.first_name}.")
            return
        phch = HASH_FILE.read_text(encoding="utf-8").strip() if HASH_FILE.exists() else None
        try:
            await client.sign_in(phone=phone, code=str(code), phone_code_hash=phch)
        except SessionPasswordNeededError:
            if not password:
                sys.exit("2FA is enabled — re-run: signin --code <CODE> --password <YOUR_2FA_PASSWORD>")
            await client.sign_in(password=password)
        except PhoneCodeInvalidError:
            sys.exit("Invalid code. Re-run 'request' to get a fresh code, then signin again.")
        me = await client.get_me()
        print(f"Logged in as {me.first_name} (@{me.username}). Session saved to telegram/career_ops.session")
        if HASH_FILE.exists():
            HASH_FILE.unlink()
    finally:
        await client.disconnect()


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    args = sys.argv[2:]
    code = password = None
    for i, a in enumerate(args):
        if a == "--code" and i + 1 < len(args):
            code = args[i + 1]
        if a == "--password" and i + 1 < len(args):
            password = args[i + 1]
    if cmd == "request":
        asyncio.run(request())
    elif cmd == "signin":
        if not code:
            sys.exit("signin needs --code <CODE>")
        asyncio.run(signin(code, password))
    else:
        print(__doc__)
