import os

from dotenv import load_dotenv
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

load_dotenv()
if not os.getenv("GOOGLE_CLIENT_ID"):
    load_dotenv("config.env")

def verify_google_token(token: str) -> dict:
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        # Fallback check
        load_dotenv("config.env")
        client_id = os.getenv("GOOGLE_CLIENT_ID")
        
    if not client_id:
        raise ValueError("GOOGLE_CLIENT_ID not found in environment.")

    try:
        idinfo = id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            client_id,
        )
        
        if idinfo.get("iss") not in ("accounts.google.com", "https://accounts.google.com"):
            raise ValueError(f"Invalid token issuer: {idinfo.get('iss')}")
            
        if idinfo.get("aud") != client_id:
            raise ValueError(f"Audience mismatch: expected {client_id}, got {idinfo.get('aud')}")
            
        return idinfo
        
    except Exception as e:
        print(f"[google_auth] Verification failed: {str(e)}")
        raise ValueError(str(e))