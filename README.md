# 🌌 ORION.
> **Neural Spotify Network Visualizer**
> Une cartographie spatiale 3D de votre univers musical, propulsée par Three.js et l'API Spotify.

---

## Architecture du Système

Orion fonctionne en deux unités distinctes :
* **Core (Backend) :** FastAPI + Poetry (Python 3.10+) - Gestion des flux et calcul des Mainstream Scores.
* **Interface (Frontend) :** React + Vite + Three.js (R3F) - HUD interactif et rendu spatial.

---

## Lancement Rapide

### 1. Configuration des Clés
Créez une application sur le [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
Ajoutez `http://127.0.0.1:8000/callback` dans vos **Redirect URIs**.

Créez un fichier `.env` dans le dossier racine :
```env
SPOTIFY_CLIENT_ID=votre_client_id
SPOTIFY_CLIENT_SECRET=votre_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:8000/callback
```
### 2. Lancement du Backend (Python Poetry)
Le backend gère la logique de données et communique avec Spotify.

Commande installation : 
```env
cd backend
poetry install --no-root
poetry run uvicorn main:app --reload
```
### 3. Lancement du Frontend (NPM)
L'interface 3D interactive.

Commande installation :
```env
cd frontend
npm install
npm run dev
```

### 4. Accessibilité
Accédez à l'application via http://localhost:5173

## Status
Dernière mise à jour du module de navigation : Février 2026.
Développé par BARSOT Thomas

gcloud run services update fastapi-backend \
  --region europe-west1 \
  --update-env-vars \
SPOTIFY_CLIENT_ID=c8652890588648c19952c52f47877e88,SPOTIFY_CLIENT_SECRET=e7b2c60c39d142839b757ec31695e273,SPOTIFY_REDIRECT_URI=https://fastapi-backend-673376371717.europe-west1.run.app/callback

cd backend
gcloud builds submit --tag gcr.io/orion-492116/spotify-fastapi .

gcloud run deploy fastapi-backend   --image gcr.io/orion-492116/spotify-fastapi   --platform managed   --region europe-west1   --allow-unauthenticated