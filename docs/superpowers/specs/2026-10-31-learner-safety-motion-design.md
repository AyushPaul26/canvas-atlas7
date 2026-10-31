# Learner safety, resilient notes and animated lessons

The user requests fixing failed notes generation, adding learner guardrails against explicit content, and making visuals more animated. They clarified that interactivity means animation, not extra quizzes. This authorizes implementation; routine architecture choices below are the builder's decisions.

## Approach

Retain Electron/React/TypeScript, all three teaching providers, the existing audio-driven timeline and isolated simulations. Add no external service or dependency. A prompt-only safety change would not cover saved content or simulation frames; use shared local checks at inputs, complete responses and display boundaries, together with common model instructions. Local checks are basic guardrails with documented semantic/image limitations, not a universal content guarantee.

Block explicit sexual generation, graphic gore, targeted hateful abuse and actionable harmful instructions. Preserve neutral reproductive biology, puberty, consent, anatomy, non-graphic history and legitimate technical education. A claim of educational intent cannot exempt an explicitly harmful request. Inspect a normalized copy, preserve original safe Unicode text, and avoid echoing rejected text in errors. Denied inputs must make no inference request or stored message. Unsafe complete responses must accept no partial beat, persist no native history, and cause no repair request. Recheck saved lessons/notes, course caches, source material, speech and dynamic experiment frames. Never delete rejected existing user data automatically.

The screenshot's generic ChatGPT error originates before notes validation/PDF printing. Offline investigation cannot establish a remote rejection's exact cause without its status/code. Improve bounded, redacted transport diagnostics and add a visible Create notes offline option. It creates a clearly identified study record from actual presented explanation prefixes and diagrams, with no model call or invented analysis. AI notes remain one explicit request, with no automatic retry or hidden provider fallback. Both modes use the existing PDF/open/export pipeline.

For animation, add a bounded declarative path cue to the existing visual action union: 2–64 finite x/y points, a target ID and duration at most 60 seconds. Arc-length interpolation uses the same audio clock as current tweens. Viewport fitting includes the whole path. Existing Pause/Resume/Replay and reduced-motion settings remain authoritative. Teacher guidance requests motion when it explains a change, while keeping static visuals for concepts where movement adds nothing.

## Validation and delivery

Use only synthetic providers and isolated profiles. Cover denied input with zero calls/persistence, mixed safe/unsafe output with no acceptance/repair, cached/replayed content, speech, generated frame text, multilingual/obfuscated examples and benign biology. Verify local notes without an AI connection, safe error diagnostics with no raw response content, and unchanged native tool mappings. Test path interpolation, fitting, replay and reduced motion; demonstrate motion in packaged desktop checks. Run full tests, typecheck, lint, build and packaged regressions, then install and reopen the verified build. No live AI quota may be spent for testing.
