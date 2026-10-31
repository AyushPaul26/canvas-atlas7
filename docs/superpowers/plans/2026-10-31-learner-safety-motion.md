# Learner Safety and Animated Lessons Implementation Plan

> Execute with coordinated subagents and root integration. The user explicitly requests implementation now; no new publication or commit is requested.

**Goal:** Fix notes usability, block unsuitable learner content across application boundaries, and add meaningful path animation.

**Architecture:** Shared bounded local policy plus common provider instructions; explicit offline notes through the existing renderer/repository; declarative path cues in the audio timeline. No extra inference for moderation, tests, repair or fallback.

**Stack:** Existing Electron, React, TypeScript, Zod, SQLite, KaTeX, Konva and Three.js.

**Spec:** ../specs/2026-10-31-learner-safety-motion-design.md

## Tasks

- [x] Add protocol safety copy and a typed non-repairable error, normalized bounded policy checks, common provider input/instruction/output gates, narration and per-frame gates. Test unsuitable and allowed educational content before implementation; verify no partial acceptance or extra calls.
- [x] Integrate input checks before persistence/readiness, saved-content and course-cache checks, material extraction/preview restrictions, notes read/write checks and learner-friendly recovery. Preserve prior safe work and user data. Test each independent boundary.
- [x] Add bounded HTTP/stream ChatGPT diagnostics, a real-adapter synthetic notes regression, and deterministic offline notes from studied evidence. Extend notes-only metadata with local provenance. Expose explicit offline generation without requiring a connection; test persistence/open/export and no model calls.
- [x] Add path action schema, deterministic arc-length timeline evaluation, viewport bounds and purposeful animation guidance. Test invalid paths, intermediate movement, pause/replay and reduced motion; verify existing provider schema/lesson contracts.
- [x] Independent review; full offline suite, TypeScript, lint and build; packaged safety/notes/animation/provider/voice/startup checks. Record limits honestly. Build a new installer preserving old releases, normal close/install, compare tested/installed hashes and verify Start launch.
