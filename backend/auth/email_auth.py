import os
import random
import string
from datetime import datetime, timedelta, timezone
import resend
from dotenv import load_dotenv

load_dotenv()

# We still use GMAIL_USER for the "to" field metadata if needed, 
# but RESEND_API_KEY is the main secret now.
RESEND_API_KEY = os.getenv("RESEND_API_KEY")
if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

_otp_store: dict = {}

OTP_EXPIRE_MINUTES = 10

def _generate_otp() -> str:
    return "".join(random.choices(string.digits, k=6))

def store_otp(email: str) -> str:
    otp = _generate_otp()
    _otp_store[email.lower().strip()] = {
        "otp":     otp,
        "expires": datetime.now(timezone.utc) + timedelta(minutes=OTP_EXPIRE_MINUTES),
    }
    return otp

def verify_otp(email: str, otp: str) -> bool:
    email = email.lower().strip()
    record = _otp_store.get(email)
    if not record:
        return False
    if datetime.now(timezone.utc) > record["expires"]:
        _otp_store.pop(email, None)
        return False
    if record["otp"] != otp.strip():
        return False
    _otp_store.pop(email, None)
    return True

async def send_otp_email(to_email: str, otp: str, username: str) -> None:
    if not RESEND_API_KEY:
        raise RuntimeError("RESEND_API_KEY must be set in Environment Secrets")

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
          If you didn't request this, it's safe to ignore this email.
        </p>
      </div>
    </div>
    """

    try:
        # Note: Resend's onboarding domain only allows sending to your own verified email.
        # If the user is testing with their own email, this will work.
        params = {
            "from": "ROOK <onboarding@resend.dev>",
            "to": to_email,
            "subject": "ROOK — Your password reset code",
            "html": html,
        }
        
        resend.Emails.send(params)
        print(f"[debug] Resend email triggered for {to_email}")
        
    except Exception as e:
        print(f"[error] Resend failed: {str(e)}")
        raise e