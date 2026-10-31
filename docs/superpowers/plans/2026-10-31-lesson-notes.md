# Lesson Notes PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let the learner generate colourful detailed PDF notes from the portion of a lesson actually presented and open/save them from Canvas Atlas.

**Architecture:** A one-shot provider-backed NotesCoordinator builds a validated evidence-bound document. A local Electron renderer prints it to PDF; a repository saves the artifact and latest record. The lesson footer pauses/checkpoints before generation and exposes persistent offline PDF actions.

**Tech Stack:** Existing Electron44, React19, TypeScript, Zod, SQLite preferences, KaTeX and local filesystem; no new runtime dependency.

**Spec:** docs/superpowers/specs/2026-10-31-lesson-notes-design.md

## Global Constraints

- Only presented tutor prefixes and matching visible canvas primitives establish studied coverage; no prepared provider history or future concepts.
- One AI request per explicit generation, no automatic retry/fallback, no live AI tests.
- Preserve the current ChatGPT/Gemini/Groq, speech, presentation receipts, lesson state and user-selected exact models.
- Keep generated HTML escaped, PDF rendering isolated and all artifact paths app-owned.
- Use existing UI identity; keep bottom controls reachable at1000x680 and1440x940.
- Reuse the existing relocated checkout; preserve all prior uncommitted changes and installers. No commit/push/publication is requested.

## Review Focus

- Partial heard content must not leak the rest of its accepted beat into notes.
- Provider/lesson changes during generation must not publish stale results or lose an existing PDF.
- Reopening/exporting saved notes must work without an AI connection and without accepting arbitrary paths.
- Long text, equations, Unicode and large diagrams must remain readable across PDF pages.
- Cancellation/error states must settle and never trigger hidden model retries.

## Frozen public document shape

```ts
type StudyNotesDraft = {
  title: string; overview: string;
  sections: Array<{
    title: string; evidenceIds: string[]; explanation: string; keyPoints: string[];
    definitions: Array<{term: string; meaning: string}>;
    equations: Array<{latex: string; explanation: string}>;
    examples: Array<{title: string; explanation: string}>;
  }>;
  recap: string[];
  reviewQuestions: Array<{question: string; answer: string; evidenceIds: string[]}>;
};
type StudyNotesDocument = {
  version: 1; id: string; sessionId: string; topic: string; createdAt: string;
  coverageHash: string; studiedSteps: number; content: StudyNotesDraft;
  visuals: Array<{evidenceId: string; title: string; entities: SceneEntity[]}>;
  modelMetadata: {providerId: ProviderId; requestedModel: string; servedModel?: string; responseId?: string; completedAt: string};
};
type LessonNotesRecord = {
  id: string; sessionId: string; title: string; createdAt: string; studiedSteps: number;
  providerId: ProviderId; requestedModel: string; servedModel?: string;
};
```

Generation coordinator produces StudyNotesDocument but does not persist or render. Root's integration service calls coordinator.generate then PDF.render then repository.save and returns LessonNotesRecord. PDF service factory is `new NotesPdfService({parent: BrowserWindow})`; public methods `render(document: StudyNotesDocument, signal: AbortSignal): Promise<Buffer>`, `open(path: string, title: string): Promise<void>`, `dispose(): void`. Root's service/repository owns path registration before calling open.

### Task1: Freeze protocol and integration contracts

**Files:** packages/protocol/src/notes.ts, index.ts, core.ts; apps/desktop/src/preload/app-bridge.ts; renderer/bridge.ts.

- [x] Add strict bounded notes draft/document/record schemas and types. Evidence IDs are canonical message IDs; document IDs are generated UUIDs.
- [x] Define getLessonNotes(sessionId), generateLessonNotes({sessionId}), cancelLessonNotes(sessionId), openLessonNotes({sessionId,notesId}), exportLessonNotes({sessionId,notesId}).
- [x] Add contract/schema tests RED→GREEN. Keep preview generation unavailable and get returning null.

### Task2: Studied-content generation

**Files:** main/notes/studied-content.ts, notes-coordinator.ts; packages/teacher/src/notes.ts; Gemini/Groq tool maps and focused tests.

**Produces:** NotesCoordinator.generate(sessionId,signal?):Promise<StudyNotesDocument>, cancel(sessionId), cancelAll(). Constructor consumes sessions.load, provider, model and optional clock/id test seams.

- [x] Test partial tutor prefixes, matching presented visuals, empty study, context bound, unanswered questions and future/prepared exclusion before implementation.
- [x] Add notes.create_notes to explicit tool maps for all providers. Request owns only its snapshot and no teaching-native history.
- [x] Validate one returned call and all section/revision evidence IDs. No automatic repair; cancellation/scope checks reject obsolete output.
- [x] Test API failures, invalid citations, duplicate jobs and provider changes; run focused tests and lint.

### Task3: Local PDF rendering and opening

**Files:** main/notes/notes-html.ts, notes-pdf.ts and unit/native fixtures.

**Produces:** NotesPdfService.render(document,signal):Promise<Buffer>, open(path,title):Promise<void>, dispose(). Template consumes StudyNotesDocument only.

- [x] Add escaping/diagram/page-flow/KaTeX template tests RED→GREEN.
- [x] Implement sandboxed bounded Electron printToPDF using local/data assets only; cancellation destroys the hidden window. Include backgrounds, A4, margins and page numbering.
- [x] Implement restricted child PDF windows; permissions/network/navigation denied and closed with the app.
- [x] Root performs first real PDF smoke/render after the PDF artifact-operation marker. Inspect text and page images; adjust content flow if needed.

### Task4: Persistence, IPC and lifecycle

**Files:** main/notes/notes-repository.ts, notes-service.ts, app.ts, ipc-router.ts and storage/IPC tests.

- [x] Save immutable PDF+JSON then atomically update the latest preference record. Test save failure retaining previous record, corrupt/missing files, path confinement and restart.
- [x] Route generation through active-provider readiness; list/open/export require no provider. Use validated session+notes IDs, never renderer paths.
- [x] Cancel on provider changes, session deletion, navigation requests and dispose. Clean only newly staged artifacts on failure.
- [x] Export with native Save As; open only registered files. Run focused main/IPC tests.

### Task5: Lesson footer notes flow

**Files:** renderer/notes/LessonNotes.tsx, CSS/tests; App.tsx/App.test.tsx; DESIGN.md, UX-CONTRACT.md.

- [x] Test empty/presented/partial lessons and pause/save before generation; test cancellation, one-click deduplication, provider failure preserving old PDF and stale UI results.
- [x] Add Generate notes near playback actions, a brief selected-service usage hint, generation status/Cancel and saved Open PDF/Save PDF actions. No lesson-completion requirement.
- [x] Fetch saved latest notes on lesson open; opening/exporting never regenerates. Use existing styles and focus/aria feedback.
- [x] Run renderer tests/lint; keep compact footer and question controls visible.

### Task6: End-to-end PDF verification and delivery

**Files:** tests/e2e/lesson-notes.spec.ts, validation report, package versions and launcher fallback.

- [x] Offline contract/coordinator/tool tests cover all three providers; isolated dummy-key Gemini/Groq fixtures cover native PDF output, restart, preview and Save As with no inference on read actions.
- [x] Prove an accepted unheard suffix is absent from AI input and PDF. Render actual PDF pages and inspect Unicode/equations/long pagination.
- [x] Independent review, full tests, typecheck/lint/build, packaged notes+provider+voice/startup regressions.
- [x] Build a new installer preserving earlier releases; normal close/install, compare tested/installed hashes, verify Start launch. No live model calls.
