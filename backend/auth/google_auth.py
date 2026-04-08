import os

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()

def verify_google_token(token: str) -> dict | None:
   
    client_id = os.getenv("GOOGLE_CLIENT_ID", "").strip()
    if not client_id:
        raise RuntimeError(
            "GOOGLE_CLIENT_ID is not set in your .env file."
        )

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            client_id,
        )
    except ValueError as e:
       
        print(f"[google_auth] Token validation failed: {e}")
        return None
    except Exception as e:
       
        print(f"[google_auth] Unexpected error verifying token: {e}")
        return None

    if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
        print(f"[google_auth] Invalid token issuer: {idinfo.get('iss')}")
        return None

    if idinfo.get("aud") != client_id:
        print(f"[google_auth] Token audience mismatch: expected {client_id}, got {idinfo.get('aud')}")
        return None

    return idinfo