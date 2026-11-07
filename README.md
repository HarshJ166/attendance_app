# attendance_app (GeoMark)

Selfie + GPS attendance for small teams. An employee taps **Mark attendance**. The app checks they are inside one of their allowed places (office, branch or home for WFH), takes a live selfie, and records the day with server time in IST. HR reviews everything in a web panel.

| Folder | What | Stack |
|---|---|---|
| `mobile/` | Employee app (Android first, installed from an APK) | Expo SDK 58, React Native, Auth0 |
| `api/` | Backend | Node + TypeScript + Hono, Neon Postgres, Cloudflare R2 |
| `admin/` | HR panel: dashboard, review, employees, places, register, settings | Vite + React, Leaflet/OpenStreetMap |
| `qa/` | Logged-in UI check of the admin panel (Playwright, throwaway DB branch) | |
| `DESIGN.md` | Colours, fonts, sizes, screens | |

## Rules the system enforces
- Outside all of a person's places, or using a fake-location app → **blocked** and logged for HR (no photo kept).
- Weak GPS inside a place → saved, but marked for HR to check.
- One check-in per person per day (database constraint). Sunday is the weekly off.
- Late = after the shift start + grace (set by HR), stored at check-in.
- Selfies are deleted automatically after 90 days (R2 lifecycle rule).

## Run locally
```bash
cd api && npm install && npm run migrate && npm run dev        # needs api/.env (see api/.env.example)
cd admin && npm install && npx vite                             # http://localhost:5173
cd mobile && npm install && npx expo start --dev-client --lan   # with the GeoMark dev build on the phone
```

## Checks
```bash
cd api && npm test            # unit tests
cd api && npm run itest       # admin + employee API flows on a throwaway Neon branch
cd api && npm run smoke:r2    # live selfie upload check
bash qa/run.sh                # every admin page, logged in, screenshots in qa/out/
```

Secrets live only in `api/.env` (git-ignored). Non-secret Auth0 IDs are in `auth0-config.md`.
