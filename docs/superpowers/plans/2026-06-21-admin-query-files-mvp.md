# Admin Query and Files MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real admin web MVP for GBrain query/answering and safe Mac mini file browsing.

**Architecture:** Implement isolated admin backend helpers in `src/commands/admin-mvp.ts`, register them from `serve-http.ts`, and add two standalone admin pages. Keep the integration point small so future upstream merges mostly touch independent files.

**Tech Stack:** Bun, TypeScript, Express, React admin SPA, existing GBrain `operationsByName` and `BrainEngine`.

---

### Task 1: Backend Safety Helpers and Routes

**Files:**
- Create: `src/commands/admin-mvp.ts`
- Test: `test/admin-mvp-files.test.ts`
- Modify: `src/commands/serve-http.ts`

- [ ] Write tests for allowed root resolution, dot-dot rejection, symlink escape rejection, and text preview caps.
- [ ] Implement `getAdminFileRoots`, `resolveAdminFilePath`, `listAdminFiles`, `previewAdminFile`, and `registerAdminMvpRoutes`.
- [ ] Register `registerAdminMvpRoutes(app, { engine, requireAdmin })` near the existing admin API endpoints.
- [ ] Run `bun test test/admin-mvp-files.test.ts`.

### Task 2: Query UI

**Files:**
- Modify: `admin/src/api.ts`
- Modify: `admin/src/App.tsx`
- Create: `admin/src/pages/Query.tsx`
- Modify: `admin/src/index.css`

- [ ] Add `brainQuery` API method.
- [ ] Add `Query` route and sidebar nav item.
- [ ] Implement a working query form with search/think mode, limit input, loading state, error state, results, and answer display.
- [ ] Keep the UI consistent with current admin styling.

### Task 3: Files UI

**Files:**
- Modify: `admin/src/api.ts`
- Modify: `admin/src/App.tsx`
- Create: `admin/src/pages/Files.tsx`
- Modify: `admin/src/index.css`

- [ ] Add file API methods for roots, list, preview, and download URL generation.
- [ ] Add `Files` route and sidebar nav item.
- [ ] Implement root selector, path navigation, directory table, preview pane, and download button.
- [ ] Show denied/unsupported/large-file errors clearly.

### Task 4: Verification

**Commands:**
- `bun test test/admin-mvp-files.test.ts`
- `bun run typecheck`
- `bun run build:admin`
- Start `gbrain serve --http --port 3131` with a real allowed file root.
- Use the in-app browser at `http://localhost:3131/admin` to log in, run a real query, browse a real directory, preview a real file, and download a real file.

**Completion evidence:** command output plus browser-observed behavior against the live server.
