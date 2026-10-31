# Canvas Atlas 0.3.0 — Gemini and Groq delivery

This records the original 0.3.0 delivery. See [the 0.3.1 Groq follow-up](groq-compatibility-validation-2026-10-31.md) for subsequent user-reported failures, fixes and live diagnostic evidence.

## Delivery

Implemented the user-approved Gemini + **Groq** upgrade in `C:\Users\Ayush Paul\Desktop\akki hacks\learner guide\living-canvas`, preserving the existing v0.2.0/ElevenLabs changes. The earlier xAI/Grok proposal is superseded. No GitHub push or release publication was performed.

Canvas Atlas 0.3.0 is packaged, installed, and was opened through the real Windows Start shortcut. Installer exit code: 0. The installed app.asar matches the packaged/tested app.asar. The installed executable reports version 0.3.0; a visible main window was verified (PID 12060 at that check).

## User-visible changes

- Settings offers separate masked Gemini/Groq key connections, key replacement/removal, provider/model selection, model refresh, and actionable failures.
- Successful key connection automatically selects its provider. A first-use catalog initializes a teaching model; a remembered unavailable model stays explicit and requires recovery. Restart remembers the active provider and exact model choices.
- ChatGPT official sign-in remains available. Gemini/Groq teaching works with ChatGPT disconnected.
- Removed only the persistent **ChatGPT connected** wording from header/sidebar. Settings/account actions, indicators, account identity, requested/served model evidence, and the separate sign-in success notice remain.
- Topic roadmaps, concept teaching, questions, continuation, generated diagrams/equations, sandboxed experiments, and source-grounded course planning use the active provider.
- Local recognition and local/ElevenLabs narration remain independent. Inactive key removal and ordinary catalog refresh do not interrupt active narration. Active changes preserve playback checkpoints and committed beats while canceling obsolete generation.

## Implementation and compatibility

The existing main-process coordinator DTO remains behind a dedicated provider-contract boundary, minimizing changes to working ChatGPT behavior. Gemini translates into native Interactions steps/function results and retains required signatures; Groq translates into native Chat Completions messages/tool calls. Both normalize output into the existing canonical validators. Generated-tool failures use the coordinator's bounded repair budget without fabricated tool-result IDs.

Separate OS-encrypted key records store the key and a durable credential UUID. Staged encrypted replacement keeps canonical credentials intact when preference persistence fails. Per-provider credential/catalog generations and global user-intent revisions reject stale activation/results. Public bridge responses contain no saved key.

Provider-native history is scoped by provider, exact model, credential revision, and account where applicable. Old unscoped history is retained as legacy data but not replayed into managed-provider requests. Context rebuilds from canonical saved lessons. Whole oversized native rounds are dropped rather than truncating signatures or call/result pairs. New safe model-run metadata includes provider identity; source-summary cache identity includes provider/model and schema version.

No new runtime dependency or SQLite table migration was introduced. Application identity, profile discovery, existing lessons/materials, startup activation, and independent speech settings retain their existing paths/roles.

## Verification evidence

| Check | Result |
|---|---|
| Original v0.2.0 baseline | 332 passed, 1 optional skipped; TypeScript passed |
| Final TypeScript | Exit 0 |
| Final ESLint | Exit 0 |
| Final complete automated suite | **467 passed, 1 optional skipped; 65 files passed, 1 skipped** |
| Provider manager/key store focused | 37 passed, including reviewed staging/rollback, catalog/connection races, exact models, and restart scopes |
| Groq focused adapter/parser | 28 passed |
| Gemini focused adapter/parser | 37 passed after RED→GREEN field-order regression |
| Renderer focused | 39 passed, including API-only teaching/continuation/restart and inactive-removal/refresh preserving narration |
| Live-evaluator helper | 11 mocked tests, both MJS syntax checks, scoped lint/type checks passed; no live trial executed |
| Source desktop provider journeys | Gemini and Groq passed through real main/preload/renderer/sandbox using synthetic provider responses |
| Packaged desktop suite | **4 passed**: Gemini workflow, Groq workflow, ElevenLabs settings/audio/cancellation, and early/minimized/hidden relaunch activation |
| Independent review | Manager and native adapter findings fixed with regressions; final cross-layer review's inactive-key interruption finding fixed and rereviewed closed; no remaining concrete P1/P2 finding reported |
| Diff formatting | git diff --check passed (normal CRLF conversion notices only) |
| Installation/launch | NSIS exit 0; installed/packaged hashes equal; real Start shortcut target and visible window verified |

Each packaged provider journey uses an isolated profile and dummy key. It verifies UI connection → automatic activation with ChatGPT disconnected → roadmap → validated teaching → real sandbox experiment and slider change → question → locally imported TXT material course with citations → encrypted fixture-key persistence → restart → key removal without losing saved lessons or the independent narration key. Test PCM passes through the actual AudioContext playback path. The desktop fixtures do not represent real provider inference or natural voice quality.

Initial desktop failures were fixture/selector problems: the Gemini fixture omitted `?alt=sse`, the generated planned-concept fixture omitted required narration chunks/cues, and the existing experiment slider has no accessible name. Corrected the fixture/selector; canonical teaching/simulation validation was not relaxed.

## Remaining live acceptance and practical limits

**Real Gemini/Groq model inference is not yet verified.** The user must enter a real key directly in the installed app and create a short roadmap/lesson. No implementation agent read a real key, copied the original credential profile, or ran paid Gemini/Groq inference.

Model catalog access alone does not establish project/model permission, quota/billing, tool-schema compatibility, context capacity, or teaching quality. Catalog filters remove unsuitable model families, but new/remaining model families still require live acceptance. The client enforces context/payload/stream/repair bounds; Groq per-model exact token budgets are not calculated by a local tokenizer. Provider size/token/rate limits remain authoritative, especially for larger supplied materials. Do not infer live acceptance from dummy-key fixture success.

Provider errors do not silently fall back to another key/service/model. OCR, new attachment formats, provider speech engines, generated media, web search, and expanded visualization libraries remain outside this upgrade.

For an opt-in isolated trial, `scripts/eval-live.mjs` supports `CANVAS_ATLAS_PROVIDER`, optional exact `CANVAS_ATLAS_MODEL`, and `CANVAS_ATLAS_WAIT_FOR_CONNECTION=1`, retaining the explicit live-profile safeguard. Credentials are entered in Settings; diagnostics expose only public status/safe error tokens. Default behavior remains ChatGPT.

## Artifacts

- Installed executable: `C:\Users\Ayush Paul\AppData\Local\Programs\Canvas Atlas\Canvas Atlas.exe`
- Start shortcut: `C:\Users\Ayush Paul\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Canvas Atlas.lnk`
- Installer: `release/ai-providers/Canvas Atlas Setup 0.3.0.exe`
- Installer bytes: **148,195,095**
- Installer SHA256: `F5366CBDB12AF3A553160E10160D05973BB299B8130122D122B928BFD838E8CF`
- Packaged/installed app.asar bytes: **121,474,289**
- Packaged/installed app.asar SHA256: `5EA831AE748AD09D648FB817B1562AD2D41232C78367815A014E8AA79B932FF0`

Build/test logs, installer/opened metadata, checksums, and synthetic lesson screenshots are retained under ignored `.test-tmp/gemini-groq/`. No original credentials were copied there.
