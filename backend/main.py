import os
import requests
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from concurrent.futures import ThreadPoolExecutor
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# Configuration du CORS
origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

CLIENT_ID = os.getenv("SPOTIFY_CLIENT_ID")
CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET")
REDIRECT_URI = "http://127.0.0.1:8000/callback"

@app.get("/login")
def login():
    scopes = "user-top-read user-read-recently-played user-library-read"
    # AJOUT de response_type=code et correction de l'URL
    auth_url = (
        "https://accounts.spotify.com/authorize"
        f"?response_type=code"
        f"&client_id={CLIENT_ID}"
        f"&scope={scopes}"
        f"&redirect_uri={REDIRECT_URI}"
    )
    print(f"\n[LOGIN] URL générée : {auth_url}") # Log pour vérifier l'URL
    return RedirectResponse(auth_url)

@app.get("/callback")
def callback(code: str):
    # Échange du code contre un Access Token
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
        print(f"[ERREUR CALLBACK] {token_json}")
        return token_json

    access_token = token_json.get("access_token")
    print(f"[CALLBACK] Token récupéré ! Redirection vers le frontend.")
    return RedirectResponse(url=f"http://localhost:5173?token={access_token}")

@app.get("/api/city-data")
def get_city_data(token: str):
    headers = {"Authorization": f"Bearer {token}"}
    
    def fetch_spotify(name, url):
        r = requests.get(url, headers=headers)
        if r.status_code != 200:
            return {"items": []}
        return r.json()

    urls = {
        "artists": "https://api.spotify.com/v1/me/top/artists?limit=50&time_range=medium_term",
        "tracks": "https://api.spotify.com/v1/me/top/tracks?limit=50&time_range=medium_term",
        "recent": "https://api.spotify.com/v1/me/player/recently-played?limit=50"
    }

    with ThreadPoolExecutor() as executor:
        futures = {name: executor.submit(fetch_spotify, name, url) for name, url in urls.items()}
        results = {name: f.result() for name, f in futures.items()}
        
    artists_data = results["artists"].get('items', [])
    top_tracks_data = results["tracks"].get('items', [])
    recent_plays_raw = results["recent"].get('items', [])

    # --- LOGIQUE D'UNICITÉ POUR LES RÉCENTS ---
    unique_recent_dict = {}
    for r in recent_plays_raw:
        if 'track' not in r: continue
        t_id = r['track']['id']
        if t_id not in unique_recent_dict:
            unique_recent_dict[t_id] = r

    recent_plays = list(unique_recent_dict.values())
    recent_artists_ids = [r['track']['artists'][0]['id'] for r in recent_plays]
    
    top_tracks_map = {
        t['artists'][0]['id']: t['name'] 
        for t in top_tracks_data if t['artists']
    }
    
    top_tracks_ids = {t['id'] for t in top_tracks_data}

    # 1. Préparation TOP ARTISTES
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

    # 2. Préparation TITRES RÉCENTS (Dédupliqués)
    final_recent = []
    recent_pop_scores = []
    for r in recent_plays:
        t = r['track']
        recent_pop_scores.append(t["popularity"])
        final_recent.append({
            "id": t["id"],
            "track_instance_id": t["id"] + r['played_at'], 
            "name": t["name"],
            "popularity": t["popularity"],
            "image": t["album"]["images"][0]["url"] if t["album"]["images"] else None,
            "is_recent": True,
            "top_track": t['name'] if t['id'] in top_tracks_ids else None,
            "type": "track",
            "artist_name": t["artists"][0]["name"]
        })

    # CALCUL DES STATS
    top_score = sum(a['popularity'] for a in artists_data) / len(artists_data) if artists_data else 0
    recent_score = sum(recent_pop_scores) / len(recent_pop_scores) if recent_pop_scores else 0

    # COMPTAGE DES ARTISTES UNIQUES DANS LES RÉCENTS
    # On prend le premier artiste de chaque track dans la liste dédupliquée
    unique_artists_in_recent = set([r['track']['artists'][0]['name'] for r in recent_plays])

    return {
        "top_artists": final_artists,
        "recent_tracks": final_recent,
        "stats": {
            "top_mainstream_score": top_score,
            "recent_mainstream_score": recent_score,
            "total_genres": len(set([g for a in artists_data for g in a["genres"]])),
            "total_recent_artists": len(unique_artists_in_recent),
            "last_played": recent_plays_raw[0]['track']['name'] if (recent_plays_raw and 'track' in recent_plays_raw[0]) else "Inconnu"
        }
    }