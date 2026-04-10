import os

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()
# Aggressively strip the ID to remove any hidden newlines injected by the environment
_RAW_ID = "482908299007-4kjj83gbr0o8h68v2ootmo5dra93b3ei.apps.googleusercontent.com"
GOOGLE_CLIENT_ID = _RAW_ID.strip()

def verify_google_token(token: str) -> dict:
    """
    Verifies a Google ID token and returns the user info.
    Includes specific handling for common failure modes.
    """
    try:
        # Standard library verification (handles audience and expiration)
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=GOOGLE_CLIENT_ID,
            clock_skew_in_seconds=120  # Allow 120 seconds of clock drift to handle production server desync
        )
        
        # Verify issuer
        if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError(f"Invalid token issuer: {idinfo.get('iss')}")
            
        return idinfo
        
    except ValueError as e:
        # Catch specific audience or issuer errors
        msg = f"Google Token Validation Error: {str(e)}"
        print(f"DEBUG: {msg}")
        raise ValueError(msg)
    except Exception as e:
        # Catch expiration and other library errors
        msg = str(e)
        if "Token expired" in msg:
            raise ValueError("Google login session expired. Please sign in again.")
        print(f"[google_auth] Unexpected verification failure: {msg}")
        raise ValueError(f"Google Auth Failed: {msg}")