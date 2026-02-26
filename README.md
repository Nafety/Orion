# 🌌 ORION.
> **Neural Spotify Network Visualizer**
> Une cartographie spatiale 3D de votre univers musical, propulsée par Three.js et l'API Spotify.

---

## 🛠️ Architecture du Système

Orion fonctionne en deux unités distinctes :
* **Core (Backend) :** FastAPI + Poetry (Python 3.10+) - Gestion des flux et calcul des Mainstream Scores.
* **Interface (Frontend) :** React + Vite + Three.js (R3F) - HUD interactif et rendu spatial.

---

## 🚀 Lancement Rapide

### 1. Configuration des Clés
Créez une application sur le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
Ajoutez `http://127.0.0.1:8000/callback` dans vos **Redirect URIs**.

Créez un fichier `.env` dans le dossier racine :
```env
SPOTIFY_CLIENT_ID=votre_client_id
SPOTIFY_CLIENT_SECRET=votre_client_secret
SPOTIFY_REDIRECT_URI=[http://127.0.0.1:8000/callback](http://127.0.0.1:8000/callback)
