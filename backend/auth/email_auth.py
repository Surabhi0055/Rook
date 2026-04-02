import os
import random
import string
from datetime import datetime, timedelta, timezone

import aiosmtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from dotenv import load_dotenv

load_dotenv()

GMAIL_USER     = os.getenv("GMAIL_USER")
GMAIL_PASSWORD = os.getenv("GMAIL_APP_PASSWORD")


_otp_store: dict = {}

OTP_EXPIRE_MINUTES = 10


def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))


def store_otp(email: str) -> str:
    otp = _generate_otp()
    _otp_store[email.lower()] = {
        "otp":     otp,
        "expires": datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES),
    }
    return otp


def verify_otp(email: str, otp: str) -> bool:
    email = email.lower()
    record = _otp_store.get(email)
    if not record:
        return False
    if datetime.now(timezone.utc) > record["expires"]:
        _otp_store.pop(email, None)
        return False
    if record["otp"] != otp.strip():
        return False
    _otp_store.pop(email, None)   # OTP is single-use
    return True


async def send_otp_email(to_email: str, otp: str, username: str) -> None:
    if not GMAIL_USER or not GMAIL_PASSWORD:
        raise RuntimeError("GMAIL_USER and GMAIL_APP_PASSWORD must be set in .env")

    html = f"""
    <div style="font-family:'Segoe UI',sans-serif;max-width:480px;margin:0 auto;
                background:#1a0608;color:#f0e8dc;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#6b1e28,#2a1015);padding:28px 32px 20px;">
        <h1 style="font-size:28px;letter-spacing:0.2em;margin:0;color:#c9a84c;">ROOK</h1>
        <p style="font-size:12px;letter-spacing:0.3em;color:rgba(240,232,220,0.6);margin:4px 0 0;">
          YOUR LITERARY COMPASS
        </p>
      </div>
      <div style="padding:28px 32px 32px;">
        <p style="color:rgba(240,232,220,0.75);margin:0 0 16px;">Hi <strong>{username}</strong>,</p>
        <p style="color:rgba(240,232,220,0.75);margin:0 0 24px;">
          Use the code below to reset your password. 
          It expires in <strong style="color:#c9a84c;">{OTP_EXPIRE_MINUTES} minutes</strong>.
        </p>
        <div style="background:rgba(201,168,76,0.1);border:1px solid rgba(201,168,76,0.35);
                    border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
          <span style="font-size:38px;font-weight:700;letter-spacing:0.3em;color:#c9a84c;">
            {otp}
          </span>
        </div>
        <p style="font-size:12px;color:rgba(240,232,220,0.4);margin:0;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    </div>
    """

    msg = MIMEMultipart("alternative")
    msg["Subject"] = "ROOK — Your password reset code"
    msg["From"]    = f"ROOK <{GMAIL_USER}>"
    msg["To"]      = to_email
    msg.attach(MIMEText(html, "html"))

    await aiosmtplib.send(
        msg,
        hostname="smtp.gmail.com",
        port=587,
        start_tls=True,
        username=GMAIL_USER,
        password=GMAIL_PASSWORD,
    )