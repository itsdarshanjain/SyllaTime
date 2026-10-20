# SyllaTime

SyllaTime is a React/Vite frontend with an Express API for aligning syllabus topics with YouTube lecture transcripts and generating study material.

## Deploy to Vercel

1. Push this repository to GitHub.
2. Import the repository into Vercel.
3. Set the Vercel **Root Directory** to `syllatime`.
4. Add these project environment variables for Preview and Production:
   - `GEMINI_API_KEY`
   - `MONGODB_URI`
5. Deploy. The Vercel function is exposed under `/api`, and the Vite frontend is built from `frontend/`.

Do not commit `backend/.env`. Use `backend/.env.example` as the local template and rotate any credentials that have previously been exposed.

## Local development

In one terminal:

```bash
cd backend
npm install
npm run dev
```

In another terminal:

```bash
cd frontend
npm install
npm run dev
```

The frontend uses `/api` by default. During local Vite development, set `VITE_API_BASE_URL=http://localhost:5000/api` in `frontend/.env.local`.
