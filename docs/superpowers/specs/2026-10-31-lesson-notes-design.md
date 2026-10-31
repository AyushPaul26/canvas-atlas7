# Lesson notes PDF design

The user explicitly requested implementation now: a bottom Generate notes action whenever they have studied enough, detailed colourful notes covering only what they studied, PDF output and opening from the app. This is the authorized scope; routine architecture and layout decisions below are implementation choices. No further live model testing is authorized by this task; verification uses synthetic responses.

## Approach

Use the selected teaching provider once to organize acknowledged lesson content into a validated notes document, then render a PDF locally with Electron. This reuses the provider manager and packaged Chromium, keeps the existing teaching workflow and avoids a new production Python/browser dependency. Direct transcript printing would not provide the requested organized analysis; remote PDF generation would unnecessarily send content to another service.

## Behavior

- Generate notes is visible near playback controls at the bottom of an opened lesson. It can be used before the roadmap is complete. It requires at least one nonempty presented tutor explanation.
- The click pauses/checkpoints teaching and saves edits before taking a fresh studied-content snapshot. The notes action discloses use of the selected AI service. No automatic generation, transport retry, generated-content retry or provider fallback is introduced; one request per explicit click.
- Context includes persisted tutor-message prefixes and only matching presented beat visuals. It excludes accepted-but-unpresented beats, unspoken suffixes, future roadmap concepts, simulation source, provider-native history and full uploaded documents. Student questions are contextual only, never proof that a topic was taught.
- Every notes section and revision question cites actual supplied tutor evidence IDs; references outside the snapshot are rejected. Evidence membership cannot establish factual entailment, so the prompt requires faithful coverage and no invented facts/examples.
- Notes include an overview, detailed explanatory sections, key points, definitions, equations with meanings, taught examples, a recap and short revision questions with answers. Content follows the lesson language. Long context/output limits fail explicitly rather than silently dropping earlier study.
- Generation has cancellation and an explicit retry state. Provider changes, deletion, app closure and leaving the lesson invalidate obsolete generation. Previously saved PDFs remain available after failure and offline.
- Save the latest notes metadata locally with the lesson; PDF/validated JSON artifacts live in an app-owned notes directory. Regeneration creates a new immutable artifact before atomically updating the latest pointer. No renderer-supplied filesystem path is accepted.
- Deleting a lesson cancels pending notes and removes every app-owned PDF/JSON revision for that lesson. Copies explicitly saved elsewhere remain user-owned.
- Open PDF opens the generated file in a separate Canvas Atlas PDF window. Save PDF uses a native Save As dialog for a portable copy. Neither action calls an AI provider. Saved notes remain available after restart.

## PDF design

A4 portrait with white paper, navy text, periwinkle headings, mint/amber explanation cards, restrained section numbering and compact page footers. Reuse Bricolage/DM Sans where available with Windows Unicode fallbacks. Keep a readable text size and natural page flow; no oversized cover page. Render trusted escaped text and validated canvas primitives; KaTeX uses trust:false. AI output never becomes executable HTML or arbitrary resource URLs. Include selected presented diagrams rather than a screenshot of app chrome.

The renderer runs in a sandboxed hidden Electron window with denied network/permissions/navigation, has bounded startup/print/cancel behavior and closes after use. A PDF preview window is restricted to the registered generated PDF and packaged PDF viewer resources. Preview windows close with the main app.

## Interfaces and ownership

- Protocol: notes draft/document/record schemas and generate/get/open/export/cancel bridge methods.
- Backend: studied snapshot builder, notes prompt/tool, one-shot NotesCoordinator, provider tool-name mappings.
- PDF: escaped HTML/primitive diagrams/KaTeX template and Electron renderer/preview service.
- Integration: filesystem NotesRepository, typed IPC, preload/preview bridge, app cancellation/disposal.
- UI: a compact lesson notes action component, pause/save integration, success/open/export/cancel/error states.

## Verification

TDD covers unpresented/unspoken exclusion, empty study, unknown evidence, provider invalidation, duplicate generation, cancellation, API errors, persistence failure retaining the old artifact, path confinement, escaped HTML/URLs, long content and Unicode/equations. A native isolated-profile fixture must generate a real PDF, show Open PDF, reopen after restart, save a portable copy and demonstrate no inference during open/export. Inspect rendered PDF pages and extract text to check that synthetic unheard material is absent. Test at compact and normal desktop sizes. Run the complete suite, typecheck/lint/build and packaged regressions before installation.
