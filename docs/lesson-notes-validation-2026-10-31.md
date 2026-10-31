# Canvas Atlas 0.4.0 — lesson notes validation

## User workflow

Generate notes appears beside the lesson playback controls after an explanation has been presented. It works before the roadmap is complete. Clicking it pauses teaching, saves the current presentation, and uses the selected teaching provider once to organize what has been studied. The result is a colourful A4 PDF with explanatory sections, definitions, key points, equations, examples, selected lesson diagrams, recap, and revision questions with answers.

Open PDF displays the saved document in a child Canvas Atlas window. Save PDF exports a portable copy through the Windows Save As dialog. Both operations work after restarting without an AI connection. Failed or cancelled regeneration preserves the previous PDF. Deleting a lesson removes its app-owned notes revisions; exported copies remain where the learner saved them.

## Scope and resource controls

- Only persisted tutor explanation prefixes and their matching presented canvas primitives establish coverage. Prepared but unheard narration, future concepts, accepted-but-unpresented beats, full uploaded documents, native provider history, and simulation source are excluded.
- Learner questions supply context, never proof that their subject was taught. Every section and revision question must cite supplied tutor evidence. Every supplied tutor explanation must be referenced.
- One inference request per explicit Generate notes click, a 180-second generation deadline, and no automatic repair, retry, or provider fallback. Cancellation, lesson changes, provider/model changes, and stale coverage prevent publication.
- The context and generated document have explicit byte/collection limits. Large lessons fail clearly instead of silently omitting tutor explanations. At most six distinct presented diagrams are selected across the lesson.
- PDF HTML escapes generated text, uses KaTeX with trust disabled, and loads embedded/local fonts. Hidden rendering denies network access, permissions, navigation, and popups. Preview accepts only a registered local PDF and Chromium viewer resources.
- PDF/JSON files are immutable and app-owned. The latest SQLite preference is published after both files are saved. Validated IDs and canonical lesson directories confine filesystem operations.

## Verification evidence

- Complete offline suite: 577 passed and one optional test skipped (75 files). TypeScript, full ESLint, and the production build with bundled-main syntax validation pass. The final footer-only pagination adjustment also passed all ten PDF template/service tests.
- Source desktop fixtures for Gemini and Groq use fresh synthetic profiles, dummy keys, intercepted network responses, two presented explanation prefixes, zero completed roadmap concepts, and identifiable unheard/future content. Each generates a real PDF with exactly one model request, saves an identical portable copy, and reopens it after removing the key and restarting with zero inference requests.
- Compact 1000 × 680 and normal 1440 × 940 layouts keep notes actions and the question composer reachable. Native PDF previews wait for visible paper/text instead of relying on document navigation alone.
- Actual exported pages were rasterized with Poppler at 105 dpi and inspected for readable typography, pagination, equations, diagrams, and Hindi glyphs. PDF text extraction excludes the synthetic unheard and unpresented markers. Hindi glyphs render correctly even though the current pypdf extractor does not preserve their original character sequence.
- Regression coverage includes invalid citations, no study, partially presented narration, large-context limits, duplicate clicks, early and late cancellation, synchronous transport rejection, stale metadata reads, provider changes, print failure, failed publication retaining old notes, path confinement, restart, and lesson deletion cleanup.

## Practical limits

Evidence IDs establish which lesson content the model received and referenced; they cannot prove every generated sentence is factually entailed. Learners should review AI-generated notes. Teaching and notes retain the selected provider's availability, account limits, and billing. Cancelling a dispatched request cannot guarantee the provider will not charge for work already performed.

The PDF includes selected static canvas diagrams; it does not embed runnable simulations or every historical canvas state. Notes generation is bounded, so an exceptionally large lesson may need shorter study sessions. Unicode rendering uses available Windows fallback fonts beyond the bundled Latin faces.

No real model inference, original credentials, original lesson database, or paid quota was used for this feature's validation. Synthetic provider responses validate integration and PDF behavior; live generation quality has not been independently measured.

## Final release checks

- Final source desktop notes checks: 2/2 passed, including deletion while the PDF preview remains open. Internal files and the SQLite notes preference are removed, while portable copies remain byte-identical.
- Packaged Windows checks: 6/6 passed. These cover Gemini and Groq teaching/experiments/material courses, ElevenLabs settings/PCM/cancellation, both notes workflows, and second-launch restoration.
- Final short and long synthetic PDFs contain two and four pages respectively. Both were visually verified with complete question/answer pairs, correct Hindi glyphs, readable equations/diagrams, and no orphan final page.
- Installer: `release/lesson-notes/Canvas Atlas Setup 0.4.0.exe`, SHA-256 `209755DD18E2B0DF2E1164592EFFFEBE4733301F139766C5E0FDA2F13BBADC88`.
- Tested application archive: SHA-256 `46D975D43F78852ABDC6D07F44A86F3490CC5FEDECDBDF92470C8B97B70903DD`.
- Silent installer exited 0. Installed version is 0.4.0; both its executable and application archive match the tested packaged files byte-for-byte. The existing Start shortcut targets the installed executable and opened a visible Canvas Atlas window successfully. No existing lesson profile was used for synthetic tests, and earlier release folders remain intact.
