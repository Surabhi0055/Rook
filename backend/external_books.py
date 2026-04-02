#external_books.py
import requests
import wikipedia
from typing import Optional

GOOGLE_BOOKS_URL = "https://www.googleapis.com/books/v1/volumes"
OPEN_LIBRARY_SEARCH = "https://openlibrary.org/search.json"


def fetch_from_google(title: str) -> Optional[dict]:
    try:
        params = {"q": title, "maxResults": 1}
        res = requests.get(GOOGLE_BOOKS_URL, params=params, timeout=5)
        data = res.json()

        if "items" not in data:
            return None

        book = data["items"][0]["volumeInfo"]

        return {
            "description": book.get("description"),
            "image_url": book.get("imageLinks", {}).get("thumbnail")
        }
    except:
        return None


def fetch_from_openlibrary(title: str) -> Optional[dict]:
    try:
        params = {"title": title, "limit": 1}
        res = requests.get(OPEN_LIBRARY_SEARCH, params=params, timeout=5)
        data = res.json()

        if not data.get("docs"):
            return None

        doc = data["docs"][0]
        cover_id = doc.get("cover_i")

        image = None
        if cover_id:
            image = f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"

        return {
            "description": None,
            "image_url": image
        }
    except:
        return None


def fetch_from_wikipedia(title: str) -> Optional[str]:
    try:
        wikipedia.set_lang("en")
        summary = wikipedia.summary(title, sentences=5)
        return summary
    except:
        return None


def enrich_book_metadata(title: str, description: str, image_url: str) -> dict:

    # If already good data, return immediately
    if description and image_url:
        return {"description": description, "image_url": image_url}

    #  Google Books
    google = fetch_from_google(title)
    if google:
        description = description or google.get("description")
        image_url = image_url or google.get("image_url")

    #  Open Library (only image)
    if not image_url:
        openlib = fetch_from_openlibrary(title)
        if openlib:
            image_url = openlib.get("image_url")

    #  Wikipedia (only description)
    if not description:
        wiki = fetch_from_wikipedia(title)
        if wiki:
            description = wiki

    return {
        "description": description or "No description available.",
        "image_url": image_url or "https://via.placeholder.com/300x450?text=No+Image"
    }