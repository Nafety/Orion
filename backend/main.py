import os
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

origins = [
    "http://localhost:5173",
    "http://127.0.0.1:5173"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI = os.getenv("SPOTIFY_REDIRECT_URI")


@app.get("/login")
def login():
    scopes = "user-top-read user-read-recently-played"

    auth_url = (
        "https://accounts.spotify.com/authorize"
        f"?response_type=code"
        f"&client_id={CLIENT_ID}"
        f"&scope={scopes}"
        f"&redirect_uri={REDIRECT_URI}"
        "&show_dialog=true"
    )

    print(f"[LOGIN] {auth_url}")
    return RedirectResponse(auth_url)

from fastapi import Query

@app.get("/callback")
def callback(code: str = Query(None), error: str = Query(None)):
    """
    Callback Spotify OAuth.
    - Si Spotify renvoie une erreur, on la retourne pour debug.
    - Sinon, on échange le code contre un access_token.
    """
    if error:
        # Spotify renvoie un paramètre error dans la query
        print(f"[SPOTIFY ERROR] {error}")
        return {"error_from_spotify": error}

    if not code:
        print("[SPOTIFY ERROR] No code returned from Spotify")
        return {"error": "No code returned from Spotify"}

    # Echange du code contre token
    token_url = "https://accounts.spotify.com/api/token"
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": REDIRECT_URI,
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
    }

    response = requests.post(token_url, data=data)
    token_json = response.json()

    if response.status_code != 200:
        print("[TOKEN ERROR]", token_json)
        return token_json

    access_token = token_json["access_token"]
    print("[TOKEN RECEIVED] Access token successfully retrieved")
    return RedirectResponse(url=f"/?token={access_token}")

@app.get("/api/city-data")
def get_city_data(token: str):

    headers = {"Authorization": f"Bearer {token}"}

    def fetch_spotify(url):

        try:
            r = requests.get(url, headers=headers, timeout=10)

            if r.status_code == 200:
                return r.json()

            print("Spotify error:", r.status_code, r.text)
            return {"items": []}

        except Exception as e:
            print("Request failed:", e)
            return {"items": []}

    urls = {
        "artists": "https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term",
        "tracks": "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
        "recent": "https://api.spotify.com/v1/me/player/recently-played?limit=50"
    }

    with ThreadPoolExecutor() as executor:
        futures = {k: executor.submit(fetch_spotify, v) for k, v in urls.items()}
        results = {k: f.result() for k, f in futures.items()}

    artists_data = results.get("artists", {}).get("items", [])
    top_tracks_data = results.get("tracks", {}).get("items", [])
    recent_plays_raw = results.get("recent", {}).get("items", [])

    # déduplication des récents
    unique_recent = {}
    for r in recent_plays_raw:
        t = r.get("track")
        if not t:
            continue
        unique_recent[t["id"]] = r

    recent_plays = list(unique_recent.values())

    recent_artists_ids = [
        r["track"]["artists"][0]["id"]
        for r in recent_plays
    ]

    top_tracks_map = {
        t["artists"][0]["id"]: t["name"]
        for t in top_tracks_data
        if t["artists"]
    }

    top_tracks_ids = {t["id"] for t in top_tracks_data}

    final_artists = []

    for artist in artists_data:

        final_artists.append({
            "id": artist["id"],
            "name": artist["name"],
            "popularity": artist["popularity"],
            "genres": artist["genres"],
            "image": artist["images"][0]["url"] if artist["images"] else None,
            "is_recent": artist["id"] in recent_artists_ids,
            "top_track": top_tracks_map.get(artist["id"]),
            "type": "artist"
        })

    final_recent = []
    recent_pop_scores = []

    for r in recent_plays:

        t = r["track"]

        recent_pop_scores.append(t["popularity"])

        final_recent.append({
            "id": t["id"],
            "track_instance_id": t["id"] + r["played_at"],
            "name": t["name"],
            "popularity": t["popularity"],
            "image": t["album"]["images"][0]["url"] if t["album"]["images"] else None,
            "is_recent": True,
            "top_track": t["name"] if t["id"] in top_tracks_ids else None,
            "type": "track",
            "artist_name": t["artists"][0]["name"]
        })

    top_score = (
        sum(a["popularity"] for a in artists_data) / len(artists_data)
        if artists_data else 0
    )

    recent_score = (
        sum(recent_pop_scores) / len(recent_pop_scores)
        if recent_pop_scores else 0
    )

    unique_recent_artists = {
        r["track"]["artists"][0]["name"]
        for r in recent_plays
    }

    last_played = (
        recent_plays_raw[0]["track"]["name"]
        if recent_plays_raw and recent_plays_raw[0].get("track")
        else "Inconnu"
    )

    return {
        "top_artists": final_artists,
        "recent_tracks": final_recent,
        "stats": {
            "top_mainstream_score": top_score,
            "recent_mainstream_score": recent_score,
            "total_genres": len(
                {g for a in artists_data for g in a["genres"]}
            ),
            "total_recent_artists": len(unique_recent_artists),
            "last_played": last_played
        }
    }