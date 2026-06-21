# Admin Query and Files MVP Design

## Goal

Extend the existing GBrain admin web app with two authenticated pages:

- Query: run real GBrain retrieval and synthesis against the configured brain.
- Files: browse, preview, and download files from explicitly allowed Mac mini directories.

## Scope

This MVP is read-only except for any normal GBrain request logging already done by the HTTP server. It does not edit, upload, delete, rename, or move files. It does not expose arbitrary filesystem roots.

## Architecture

Keep the feature mostly independent from upstream GBrain internals:

- Add a small admin feature module under `src/commands/admin-mvp.ts`.
- Register that module from `src/commands/serve-http.ts` with one route-registration call.
- Add standalone React pages under `admin/src/pages/Query.tsx` and `admin/src/pages/Files.tsx`.
- Add API methods in `admin/src/api.ts` and route links in `admin/src/App.tsx`.

This limits future upgrade conflicts to a small hook in `serve-http.ts` and independent admin files.

## Backend API

All endpoints require the existing admin cookie middleware.

- `POST /admin/api/brain/query`
  - Body: `{ mode: "search" | "think", query: string, limit?: number }`
  - Uses real `operationsByName.search` or `operationsByName.think` with the live engine.
  - Returns results or synthesized answer from the actual configured brain.

- `GET /admin/api/files/roots`
  - Returns display names and root tokens for allowed roots.

- `GET /admin/api/files/list?root=<id>&path=<relative>`
  - Lists one directory under an allowed root.

- `GET /admin/api/files/preview?root=<id>&path=<relative>`
  - Returns text, image metadata, PDF metadata, or binary summary.
  - Text previews are size-capped.

- `GET /admin/api/files/download?root=<id>&path=<relative>`
  - Downloads a regular file under an allowed root.

## File Safety

Allowed roots come from `GBRAIN_ADMIN_FILE_ROOTS`, a path-delimited list. If unset, default to the current repo root only. Every request resolves with `realpath` and must remain inside the selected root. Dot-dot traversal, symlink escape, directories-as-downloads, and large text previews are rejected.

Default deny patterns block high-risk paths such as `.ssh`, `.env`, private keys, `.gbrain/config.json`, and `.git`.

## UI

The UI follows the existing dark admin style. It is operational, dense, and tool-like:

- Query page: mode selector, query input, limit control, run button, loading/error states, search result list, think answer panel.
- Files page: root selector, breadcrumb-like path input, directory table, preview pane, download action.

## Verification

Required evidence before completion:

- Unit tests for file root resolution and path denial.
- Focused admin/file tests pass.
- `bun run typecheck` passes.
- Admin build succeeds.
- Live browser test against `http://localhost:3131/admin` uses the real server and real filesystem, not mocked responses.
