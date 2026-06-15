# VisboardAI

AI-powered study platform with **voice interaction** and **visual mapping** —
turn notes and topics into interactive visual study boards you can talk to.

## Stack

- **Frontend:** Next.js (static export) + Vite tooling, deployed to Firebase Hosting
- **Backend:** Python service
- **Data/Auth:** Supabase
- **Tests:** Playwright

## Setup

```bash
# Frontend
cd frontend
npm install
cp .env.example .env.local   # add your own keys (see below)
npm run dev

# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
```

### Environment

This project reads all secrets from environment variables — nothing is committed.
Provide your own:

| Variable | Where |
|----------|-------|
| `NEXT_PUBLIC_SUPABASE_URL` | frontend `.env.local` / CI secret |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | frontend `.env.local` / CI secret |
| `SUPABASE_URL`, `SUPABASE_*` | backend `.env` |

Supabase anon keys are safe in the client **only if** Row-Level Security is
enabled on every table — verify your RLS policies before deploying.

## License

MIT
