# Canvas Atlas: account voices, interactive visuals, and lesson references

**Date:** 29 October 2026
**Status:** Research-backed proposal. Await the user's explicit “go” before implementation, dependency installation, live API requests, packaging, or local installation. Git commits, pushes, and public releases require a corresponding user request.

## Intent and confirmed choices

Make teaching sound more natural, make visual explanations explorable, and let a learner introduce reference material while a lesson is underway. Preserve the experience of a patient teacher working on a board; the lesson remains generated during conversation.

The user confirmed that “custom voice” means **choosing a voice already in their ElevenLabs account**. Creating, designing, training, or cloning a voice is outside this iteration. The user delegated library selection after web research and requested voice work first, visual improvements second, and reference attachments in the existing question composer.

## Current implementation evidence

- Version 0.1.1 has a repaired installed Start shortcut, queued second-instance activation, and deferred material initialization. Preserve these startup fixes.
- `voice-worker-manager.ts` provides Float32 PCM; `audioPlayback.ts` and `useLessonPlayback.ts` coordinate actual audio, visuals, cancellation epochs, and durable acknowledgements. ElevenLabs is not implemented.
- `Scene3D.tsx` already renders trusted Three.js objects. It redraws accepted poses but has no learner orbit/picking controls. Konva, KaTeX, and an isolated QuickJS simulation runtime are already installed.
- The source picker accepts PDF/TXT/Markdown before course generation. Local PDF parsing and page preview work, but the active question composer accepts only text. Images, Word extraction, and per-message reference associations are absent.
- Teacher input is currently text context. Image understanding requires a new multimodal request path and verification with the selected model and official account route; a thumbnail alone is insufficient.

## Web research and selection

Sources below are official documentation or the authors' repositories, checked on 29 October 2026. These are source/documentation findings, not claims that integrations have been tested locally.

| Candidate | Relevant capability | Proposed decision |
| --- | --- | --- |
| [Three.js OrbitControls](https://threejs.org/docs/pages/OrbitControls) | Orbit, zoom, and pan around spatial objects | Use with existing Three.js; add picking, labels, reset view, and keyboard alternatives. Lowest migration cost. |
| [React Three Fiber](https://r3f.docs.pmnd.rs/getting-started/introduction) and [Drei](https://drei.docs.pmnd.rs/controls/introduction) | React scene composition and interaction/control helpers | Strong alternative for a later renderer migration. Stable Fiber 9 pairs with React 19; do not select the documented Fiber 10 alpha for this release. Direct Three.js already supplies the needed first interactions. |
| [JSXGraph](https://jsxgraph.org/docs/) | Interactive geometry, function plotting, vectors, and educational constructions | Preferred new math adapter. Standalone JS/SVG integrates without changing the React renderer. Use its offered MIT license and retain notices. |
| [Mafs](https://mafs.dev/) | Declarative React components for animated interactive math | Good alternative to JSXGraph. Do not ship two overlapping math engines; React/version and feature fit would need a separate compatibility check if selected instead. |
| [Matter.js](https://brm.io/matter-js/) | 2D rigid-body physics, contacts, constraints | Add a bounded trusted adapter for supported mechanics demonstrations. It is not an engine for arbitrary chemistry, fluids, electromagnetism, or scientific correctness. |
| [Motion for React](https://motion.dev/docs/react) | Layout, gesture, and interface animations | Optional for interface transitions only, if existing CSS cannot express them cleanly. Never let a separate transition clock drive instructional progress. |
| [mo.js](https://github.com/mojs/mojs), [Lottie](https://github.com/airbnb/lottie-web) | Motion graphics and authored animation playback | Optional later polish. Their effects/assets do not provide the missing teaching interaction model; no runtime dependency in the first implementation. |
| [Onlook](https://github.com/onlook-dev/onlook), [Doory](https://github.com/shaongitbd/doory) | Visual editing/design applications | Useful tooling references, not recommended to embed as the tutor runtime. Their workflows and application infrastructure would duplicate substantial existing UI. No code/assets copied without reviewing their actual license. |
| [350 layout compositions](https://github.com/nevertoday/350-layout-compositions), [Awesome Design Tools](https://github.com/goabstract/Awesome-Design-Tools) | Layout references and tool discovery | Inspiration only, while preserving Canvas Atlas's established layout and brand. No unreviewed asset redistribution. |
| [Remotion](https://www.remotion.dev/docs/), [Brag](https://github.com/latent-spaces/brag) | Programmatic video and product-launch video workflows | Reserve for a future lesson/video export or promo request. Neither solves live learner control by itself. |
| [LivePortrait](https://github.com/KlingAIResearch/LivePortrait) | Portrait animation | No present need; a talking avatar is not part of the request. |
| PPT-Master | Several repositories share this name; examples generate editable PowerPoint | No selection without an exact repository link and an actual deck-export requirement. |

Recommended architecture: **extend existing Three.js/Konva + one JSXGraph math adapter + one bounded Matter.js mechanics adapter**. The alternative is an up-front Fiber/Drei renderer migration, which offers cleaner React scene authoring but increases scope and playback regression risk. A collection of video/editing apps would add application infrastructure without providing a coherent live lesson runtime.

## Phase 1: choose an ElevenLabs account voice

Settings gains Local / ElevenLabs, masked key entry, connection validation, searchable account voices, explicit refresh/load more, selected voice, Preview/Stop, and supported stability/similarity controls. The existing local speed control remains the single speed mechanism. Existing custom voices in the account appear through the same voice catalog.

Store the key with Electron safeStorage in a dedicated encrypted profile file. All network requests originate in main through the existing network client. Public status contains only key presence, provider, voice ID/name, supported settings, and connection/error state. No key goes into Git, lesson exports, localStorage, or the simulation runtime. This remains practical even for a local project that has a public source repository.

Use the official [voice catalog](https://elevenlabs.io/docs/api-reference/voices/search) and [text-to-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert). Generate bounded PCM narration chunks using an account-compatible supported model; start by validating `eleven_multilingual_v2` with `pcm_24000`. Do not promise access to a voice/model merely because it is visible in a catalog.

Use the existing audio clock for pause/resume, replay, microphone echo gating, and simulation cues. Scope cancellation by request ID and settings generation; changing voices invalidates old prefetch. Abort pending requests and stop scheduling further chunks on cancellation; do not promise a provider will reverse charges for work already performed. Cloud errors leave an actionable paused state with Retry or Use local voice. A cancellation does not automatically invoke fallback. Preview neither advances a lesson nor starts its own overlapping narration.

Microphone recognition stays local. Cloud mode explains that spoken lesson text is sent to ElevenLabs and consumes the connected account's credits. Live acceptance requires the user-entered key, one preview, and a short narrated lesson; mock tests alone are not live proof.

## Phase 2: meaningful visual interaction

Keep one visual specification and interaction-event contract above all renderers. The teacher selects a suitable presentation style and configures supported visual primitives during conversation:

- **Science lab:** moving bodies, forces/vectors, trajectories, simple constraints, measurements, and bounded spatial exploration.
- **Math graph:** axes, units, curves, points, tangents, vectors, and adjustable parameters.
- **Process/concept board:** relationships, stages, labelled diagrams, and progressive emphasis through the existing canvas.

These are presentation grammars, not a fixed catalogue of topics or prerecorded lessons. New explanations still come from the model and current learner context. Unsupported scenes fall back to the existing 2D explanation rather than pretending a specialized simulation is available.

Add pointer and keyboard selection, inspectable labels/values, allowed point/object dragging, orbit/zoom/reset for 3D, and coherent legends/units. Parameter changes update the visual and become context for the teacher's next explanation. Use explicit **Explore / Resume explanation / Reset view** actions. Beginning direct manipulation pauses narration and scripted motion; Resume uses the accepted playback boundary and reconciles the camera and changed parameters. The drawing must not snap back on every incoming audio frame while the learner is exploring.

The audio timeline remains authoritative for scripted teaching. Matter.js uses fixed 1/60-second steps inside the isolated simulation host, bounded object counts and a watchdog; generated JS does not obtain privileged renderer or library access. JSXGraph accepts only a trusted declarative subset, never model-authored callbacks or arbitrary strings passed to an evaluator. Mathematical functions use a bounded expression tree or sandbox-produced sample data. Persist engine/version, parameters, seed, ticks, and input history; version-incompatible or excessive replay receives an honest reset/recovery state.

Preserve GPU disposal, context-loss recovery, offline visual assets, reduced-motion behavior, readable static fallbacks, and keyboard controls. Demonstrations initially cover draggable graph slope, adjustable mechanics, and an orbitable labelled spatial scene; these are validation cases, not production topic restrictions. Runtime success never automatically marks a model scientifically validated or a learner as having mastered a concept.

## Phase 3: references in “Ask a question, share a thought”

Add a paperclip button, drag-and-drop, and Ctrl+V for pasted images and exposed file items to the existing lesson composer. Native Explorer file-list paste needs an explicit Windows clipboard adapter and acceptance check; native selection remains available where the clipboard does not expose a usable file. Pasted ordinary text continues to work normally. A pasted path or URL is not automatic permission to read/fetch it.

Initial supported inputs: PNG/JPEG/WebP images and screenshots; PDF; `.docx`; UTF-8 TXT/Markdown. Legacy `.doc`, password-protected material, corrupted files, unsupported formats, and unreadable content show specific recovery guidance. `.doc` should be exported to `.docx` or PDF for this iteration.

Attachment chips show thumbnail/file name, Preparing/Ready/Failed/Partial, Retry, Remove, and Preview. Adding material pauses the current explanation and preserves the question draft/checkpoint. No provider request is triggered by attaching alone. Send submits the text or spoken question and the explicitly selected ready references together. Attachment-only Send uses a visible default request to explain the references in the context of the current lesson. Voice auto-send waits while reference preparation is pending and never silently drops a failed selection.

Use one ingestion pipeline for lesson references and the existing study-material picker. Existing course-level limits remain scoped to a course; adding a reference to a long-running lesson must not incorrectly consume its five-course-material selection limit. Proposed per-message limits are 5 files / 50 MiB total: PDF 25 MiB, DOCX 10 MiB, image 10 MiB, text 1 MiB. Images are bounded to 20 megapixels at decode and normalized to a 1600-pixel long edge for model evidence. Originals remain private local assets.

PDF continues using local extraction and targeted page rendering. [Mammoth](https://github.com/mwilliamson/mammoth.js) supplies bounded DOCX raw-text extraction in a terminable parser host, with external access disabled. Do not inject converted document HTML into the app. Apply archive expansion/entry/time limits. Surface lost formatting, unsupported Word equations, tables, and embedded figures as appropriate; exact Word pagination/layout is not promised. Offer PDF export when visual fidelity matters.

Images are sent as actual [multimodal image inputs](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses) through the existing official account provider, only after confirming selected-model/account support. For PDF visual questions, send only selected/retrieved relevant page renders, not every page. Initial request budget: at most 4 image/page renders, each at most 2 MiB normalized, within a 12 MiB serialized request budget; extracted text is independently bounded and selected around the learner's question. If account/model access rejects images, preserve the draft/references and offer a compatible model or text-based recovery; never claim the image was understood. Scans can be analyzed as images when supported, without implying local OCR exists.

Source text uses exact canonical excerpt references. Images/page renders use explicit visual evidence IDs and page metadata; AI descriptions are not represented as verified source quotations. Uploaded instructions are reference content, not system/developer instructions. Persist the material IDs attached to each message, the actual supplied evidence and provenance, and lesson associations so history/restart can reopen the same references. New references supplement the current lesson without overwriting its original course/roadmap source selection. Follow-up and automatic continuation retrieve the relevant active reference set; a one-time image attachment is not forgotten immediately, nor blindly resent on every turn.

Keep the existing JSON lesson export bounded: include attachment metadata and already-bounded textual evidence, but do not embed complete original documents/images or absolute private file paths. Explain that source previews require the local reference assets; a portable all-materials archive is a separate future feature. Local save/reopen retains the original associations and previews.

## Persistence, UI, and release constraints

- Introduce an additive v2-to-v3 SQLite migration with a consistent backup. Keep prior lessons readable and old beats/checkpoints immutable. Old app versions must reject a newer schema clearly.
- Material bytes live under managed private UUID paths; ownership and lesson/message membership are validated in main. Removing a draft chip detaches it; shared source assets are not deleted while referenced. Import failures and canceled/abandoned drafts have a bounded local cleanup policy.
- Persist unsent composer text and attachment IDs as a session-scoped local draft after ingestion; reopening offers restoration. Never restore an automatically scheduled voice-send timer.
- Reuse the established paper/navy/periwinkle/mint palette, bundled fonts, and reserved playback/question footer. Chips use a bounded strip; new content must not cover the canvas or push Pause out of view at 1050×760 and 1440×940.
- Extend DESIGN.md and UX-CONTRACT.md together after approval. Provide keyboard access, associated labels, visible focus, live preparation status, cancellation, and reduced-motion alternatives.
- Keep renderer/simulation networking restricted; no CDN runtime dependencies, arbitrary model-authored UI code, or executable material imports. Pin compatible dependency versions and retain required notices at implementation time.
- Preserve the working Start menu installation/profile identity. Prepare and test a new versioned installer after all approved phases pass; do not overwrite an active lesson or publish a GitHub release without release authorization.

## Decisions left to implementation

Exact dependency patch versions, internal helper names not specified in the plan, measured rendering/sample budgets within the stated caps, and accessible component extraction details can be settled during implementation. The selected voice and its listening quality are the user's choice. Propose local build version0.2.0. A “go” approves implementing, testing, packaging, and updating the local app through its normal save/close path; publishing/updating GitHub is a separate action.

## Acceptance

1. A selected account voice survives restart and narrates a lesson with correct pause/interruption/visual timing.
2. The learner manipulates a meaningful visual, sees its values change, and receives an explanation that uses the changed state.
3. A pasted screenshot plus question is genuinely supplied to a supported vision model; PDF and DOCX text references are grounded and previewable.
4. Reference questions interrupt and branch from the current explanation; Back to lesson restores the accepted return point. Saved lessons/drafts reopen correctly.
5. Unsupported inputs or service failures preserve work and explain recovery. Installation and real Start-menu opening retain the existing startup fix.
