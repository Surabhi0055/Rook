import os

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()
if not os.getenv("GOOGLE_CLIENT_ID"):
    load_dotenv("config.env")

GOOGLE_CLIENT_ID = "482908299007-4kjj83gbr0o8h68v2ootmo5dra93b3ei.apps.googleusercontent.com"

def verify_google_token(token: str) -> dict:
    """
    Verifies a Google ID token and returns the user info.
    Raises ValueError on any failure.
    """
    try:
        # Use the hardcoded ID directly to avoid any environment issues
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID,
        )
        
        # Verify issuer
        if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError(f"Invalid token issuer: {idinfo.get('iss')}")
            
        return idinfo
        
    except Exception as e:
        # Pass the detailed error from the library through
        print(f"[google_auth] Verification failed: {str(e)}")
        raise ValueError(str(e))