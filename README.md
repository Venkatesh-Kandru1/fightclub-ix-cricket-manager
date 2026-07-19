# Fightclub IX Cricket Manager

Fightclub IX is a React + ASP.NET Core team-management dashboard for the 14-player cricket squad. The admin can review the previous match, filter players by their assigned role, open any player profile, and record live runs, wickets, or catches. Jagadeesh and Niteesh are listed as both batsmen and wicket-keepers. Player changes are broadcast to connected browsers through SignalR.

## Project structure

```text
frontend/   React, TypeScript, Vite
backend/    ASP.NET Core .NET 8 minimal API and SignalR hub
```

## Run locally

You need Node.js 20+ and the .NET 8 SDK.

### 1. Configure the local admin account

From `backend/`, initialize .NET user secrets and set your local credentials. These values are never committed:

```bash
dotnet user-secrets init
dotnet user-secrets set "DemoAdmin:Email" "admin@fightclubix.local"
dotnet user-secrets set "DemoAdmin:Password" "your-local-password"
```

### 2. Start the API

```bash
cd backend
dotnet run --urls http://localhost:5000
```

### 3. Start the React frontend

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173), then sign in with the credentials configured in step 1.

## Main flow

- The login page is the administrator entry point.
- The dashboard starts with the previous-match scoreboard and all 16 player cards.
- Use the hamburger control to collapse or open the left navigation.
- Select Batsmen, Bowlers, All-rounders, or Wicket-keepers to filter the roster.
- Select any player to view only the role tabs assigned to that player (for example, batting and wicket-keeping).
- Use **Record run**, **Record wicket**, or **Record catch** in a player profile to broadcast a live stat update.
- Open **Admin profile** to edit the phone number and time zone or open the change-password modal.

## API endpoints

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/login` | Authenticate the configured administrator |
| `GET /api/players` | Load the 14-player roster |
| `GET /api/matches/previous` | Load previous match summaries |
| `PUT /api/players/{id}/stats` | Increment a player's live stat |
| `GET /api/profile` | Load administrator profile details |
| `PUT /api/profile` | Save phone number and time zone |
| `POST /api/profile/password` | Validate the local demo password change |
| `/hubs/stats` | SignalR live player update stream |

## Notes

The first version uses an in-memory roster and match store so it can be run immediately as a focused prototype. The API boundary is ready to move to Entity Framework Core and a persistent database when the club is ready for production data.
