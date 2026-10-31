# Canvas Atlas: Gemini and Groq teaching providers — proposed design

Status: APPROVED by the user on 31 October 2026. Implementation and fixture validation are tracked in `.test-tmp/gemini-groq/progress.md`; live provider acceptance remains separate from synthetic test evidence. Existing app identity, data, ChatGPT authorization, and speech services are preserved.

Provider correction: the user supplied a screenshot of console.groq.com/keys and explicitly selected Groq. This design replaces the earlier xAI/Grok proposal. Gemini remains in scope alongside Groq and the existing ChatGPT connection.

Latest user direction: remove only the persistent front-screen "ChatGPT connected" wording; preserve the current ChatGPT backend and remaining interface/features. A successful Gemini/Groq key connection must automatically activate that provider, without a second provider-switch action. These requirements take precedence over the earlier proposal to display a provider label in the header.

## Intent and reviewed source

Let a learner run the existing Canvas Atlas teaching experience through their own Gemini API key or Groq API key, in addition to the existing ChatGPT account connection. Each service must power topic roadmaps, source-based course planning, explanations, follow-up answers, generated diagrams/equations, and interactive simulation generation.

The original `C:\Users\Ayush Paul\Desktop\23rd aanna\learner guide\living-canvas` path is absent. The latest matching source found during this audit is `C:\Users\Ayush Paul\Desktop\akki hacks\learner guide\living-canvas`, package version 0.2.0, including the ElevenLabs implementation. Other Desktop copies identify themselves as 0.1.0 and 0.1.1; they must not become the implementation baseline. Before implementation, reconfirm this 0.2.0 source and inventory its uncommitted changes. No existing changes are to be discarded.

## What the code does today

- `main/app.ts:67–70` constructs one ChatGPTProvider for all three coordinators: lesson, topic roadmap, and source-based course planning.
- `main/ipc-router.ts:44–53` requires a connected ChatGPT account and plan permission before every new teaching request. Renderer `App.tsx:206,306,376–410,551,559` repeats those assumptions.
- `main/ai/chatgpt-provider.ts` owns model discovery and streaming inference. Its request accepts raw OpenAI input/tool arrays. Coordinators and `packages/teacher/src/course-planner.ts` construct namespace tools, developer messages, and function-call feedback above the transport layer.
- `packages/teacher/src/tool-schema.ts` converts Zod schemas specifically for ChatGPT's strict tools. It cannot be assumed compatible with Gemini unchanged.
- `main/storage/session-repository.ts:57–76` persists and replays provider-native output/feedback without provider identity. Model preferences and provenance also lack provider identity.
- Material extraction, source indexing, canvas rendering, sandboxed simulations, local speech recognition, and ElevenLabs/local narration already have independent implementations. Reuse them. Current scanned-material/OCR limitations remain accurately disclosed.

All application paths above are relative to `apps/desktop/src` unless they start with `packages/`.

## Approach and alternatives

Recommended proposal: a small provider-neutral teaching interface inside the existing Electron main process, with a native Gemini adapter, a Groq Chat Completions adapter, and the existing ChatGPT route behind the same interface. API requests continue through `createDesktopFetch` so device networking/proxy behavior remains consistent. Use REST and the existing fetch/stream/Zod infrastructure; no new runtime framework is planned.

Alternative: route everything through OpenAI-compatible endpoints. This reduces initial transport work, but does not remove the need to translate namespace tools, schema differences, provider error states, and native continuation. It is not the recommended default for this app.

Alternative: introduce a larger AI orchestration SDK/framework. It can standardize several APIs but adds dependencies and another tool/history abstraction to an app that already has a working coordinator. Defer it unless the native compatibility spike demonstrates a concrete need.

The recommendation is an engineering proposal for approval, not a choice the user has already made.

## User experience

Keep the existing settings modal. Add ChatGPT, Gemini, and Groq teaching connection controls there. ChatGPT retains official account sign-in and its existing backend behavior. Gemini/Groq show a masked key field, Connect/Replace, Remove key, connection state, Refresh models, and the selected model. Each provider remembers its own exact model ID. Existing installations initially select ChatGPT and migrate the current selectedModel preference into ChatGPT's settings only. The additional adapters are the minimum integration needed for the requested services; removing visible wording must not disable or replace the ChatGPT route.

Remove the persistent visible "ChatGPT connected" text in the main header and sidebar account subtitle (`App.tsx:545` and `:541` in the audited source). Do not replace it with Gemini/Groq connection wording on the front screen. Keep the settings/account buttons, account name, icons/indicators, requested/served model line, canvas, lesson controls, and remaining layout/behavior. Connection/provider details remain available in Settings. The separate temporary successful-sign-in notice is outside this narrowly requested removal.

Connecting a key checks access to that provider's model catalog. After successful validation and protected persistence, the same Connect/Replace action automatically activates that provider and saves it as the active connection; no extra provider-switch click is required. Reuse that provider's remembered exact model when available. If it has no remembered selection, choose an initial compatible catalog model. Preserve a remembered unavailable ID and show a Settings recovery to choose an available model; a connected key with an empty/incompatible catalog is not ready to teach. The provider is selected automatically even when model recovery is necessary.

The latest explicit user intent governs activation: a slow connect result cannot override a later connect, manual provider/model selection, or key removal. Invalid/rejected/canceled validation or failed protected persistence leaves the previous credential and active provider/model intact. Typing alone makes no configuration change. Restart restores the persisted active provider rather than favoring ChatGPT or whichever saved key is found first. Optional provider controls in Settings allow switching among already saved connections or returning to ChatGPT; they are not an extra setup step after key connection.

Catalog access does not prove successful teaching or available paid quota. The first bounded teaching request/live acceptance check proves structured generation. Missing keys, empty catalogs, invalid/revoked keys, inaccessible models, exhausted quota, and network failures have distinct, actionable provider-specific messages.

Once a compatible model is available, Start lesson, roadmap approval, material-course planning, questions, microphone questions, concept navigation, checks, and automatic continuation all use the automatically activated provider even when ChatGPT is disconnected. Settings identifies the active service/model; no new persistent connection wording is added to the front screen. Saved playback, materials, and export remain available without an AI connection.

Provider/model changes, including activation after a successful key connection, pause and checkpoint the lesson, abort in-flight generation, revoke queued continuation, and discard uncommitted transient work and audio prefetch. Preserve every already committed immutable beat, including the remaining chunks of a partly presented beat, for explicit local resume/replay from its checkpoint. Switching does not automatically replay or acknowledge that content. Its original provider provenance remains intact; the next new generation uses the selected provider and the canonically presented state. Removing an inactive provider's key does not interrupt the active provider. Automatic activation follows the user's successful Connect/Replace action; it is not fallback after an inference, quota, network, or model error. Such failures never silently switch provider/key/model.

Narration remains a separate choice: local voice or ElevenLabs. A Gemini/Groq teaching key does not replace an ElevenLabs key. Local recognition continues to run locally. Normal product copy explains that the selected AI service receives teaching context and relevant supplied material excerpts, and API usage is billed by that service.

## Backend contracts and provider responsibilities

Public provider IDs are `chatgpt`, `gemini`, and `groq`. A selection snapshot contains providerId, modelId, selectionRevision, and credentialRevision. Every generation captures one immutable snapshot. Catalog requests and key validation also carry revisions so late results cannot restore removed credentials or overwrite another provider's models. For API providers, credentialRevision is an opaque UUID stored alongside the key inside its encrypted record; create a new UUID for every successful key replacement, and retain it across restart. Native continuation scope also includes ChatGPT account identity when using the account provider. Never reset a credential identity to a reusable process-local counter.

Public configuration contains connection/readiness state, hasKey, model choices, and revisions. It never contains a saved key. Provider keys are separate OS-encrypted files in the existing profile: `gemini-key.enc` and `groq-key.enc`. Reuse the existing protected-storage pattern, including unavailable-protection errors and atomic replacement. Existing ChatGPT and ElevenLabs credential files stay under their existing owners.

The internal interface represents instructions, user/internal context messages, canonical tools, tool calls/results, and provider-scoped opaque continuation. Canonical tool identity remains namespace plus name:

- teaching.present_beat
- planning.propose_plan
- course.summarize_source
- course.plan_course

Adapters flatten names when necessary using an explicit reversible allowlist, translate schemas/feedback, and normalize completed calls back to this identity. Unknown or conflicting calls are rejected. Preserve required Gemini native continuation/signatures and Groq assistant tool_calls plus matching role:tool messages only within compatible provider/model/credential scope. Do not replay OpenAI Responses items into Groq Chat Completions or render private reasoning as narration. Continuation never appears in public renderer status or becomes arbitrary executable actions.

Zod remains the final validator for beats, roadmaps, sources, and course outlines. Provider schema restrictions do not weaken local semantic validation, source-range checks, simulation preflight, or presentation acknowledgement. Existing maximum two prepared beats, repair limits, context/history bounds, simulation isolation, and cancellation semantics remain in effect.

## API choices, checked 31 October 2026

Gemini: native Interactions API at `https://generativelanguage.googleapis.com/v1beta/interactions`, authenticated by `x-goog-api-key`, with streaming function calls and `store:false`. Google currently recommends Interactions for new integrations; generateContent remains supported but is not the proposed default. Replay the required native items locally rather than depending on a server-stored previous_interaction_id. Discover models using the paginated Models API and verify tool suitability; a catalog listing alone is not a promise that every returned model can teach.

Groq: Chat Completions at `https://api.groq.com/openai/v1/chat/completions`, authenticated by Bearer API key, with stream:true and local function tools. Discover active models through `https://api.groq.com/openai/v1/models`, then apply verified text/tool capabilities and project/model permissions. The request uses messages, nested function definitions, assistant tool_calls and role:tool feedback with tool_call_id; it is not the existing Responses envelope. Use a separate bounded Chat Completions SSE parser that assembles deltas by choice/tool index and call ID. Accept function actions only after finish_reason:tool_calls and the proper [DONE] stream terminator; a plain-text stop response is not a teaching beat. Length, content_filter, malformed/unfinished arguments, and transport errors cannot commit teaching output. Omit unsupported store and messages[].name fields, and do not assume namespace or strict function schema support.

Groq supports streaming local tool calls, but its separate response_format:json_schema Structured Outputs feature currently does not combine with streaming or tool use. The primary path therefore uses function tools plus the app's local Zod validation and existing bounded repair flow. If a verified model needs a JSON-schema response envelope as a fallback, make a separate non-streaming request with no tools, then normalize/validate it; never send the unsupported combined configuration. Groq's Responses API is an alternative, not the proposed first implementation path.

Groq HTTP 400 tool-generation failures are distinct from invalid request/schema errors. Sanitize their diagnostics and spend only the coordinator's existing repair budget; do not execute failed_generation text or fabricate accepted call/tool-result IDs. Apply reasoning controls only when documented for the selected model and keep reasoning output out of lesson narration.

Keep model discovery separate from capability verification. Filter speech-only, guard/embedding, and other unsuitable models; offer models whose teaching/tool/schema behavior is supported by the adapter. Groq's active-model listing is not proof of project access, quota, or sufficient request token budget. Check the combined instruction/tool-schema/context budget against the selected model, and handle request/token-per-minute rate limits with actionable retry timing rather than an unbounded retry loop. Preserve exact provider IDs and identify unavailable saved choices rather than silently substituting a model. Do not freeze today's hosted-model names into permanent product defaults.

After establishing the shared contract and ChatGPT regression adapter, Tasks 4 and 5 run bounded native compatibility checks for all four real tool schemas and required continuation before Task 6 integrates either provider into the full teaching workflow. If real keys are not available yet, mark live schema compatibility provisional and finish that check during Task 8 after direct key entry; fixture success alone is insufficient. If a provider rejects a schema, add a provider-specific serialization or a bounded structured-output envelope using the same canonical validators; do not truncate the schema or relax validation. Document any material API/architecture change before expanding the implementation.

## History, persistence, and compatibility

Add providerId to new model-run metadata and provider-round events, extending the repository's explicit metadata whitelist. Treat old untagged provider rounds as ChatGPT provenance, but their unscoped native records are ineligible for continuation replay after migration; reconstruct canonical context instead. Never forward one service's native tool history to another service. On a switch or incompatible model/credential revision/account, rebuild context from the canonical saved lesson, messages, visible canvas, plan, source evidence, and accepted presentation state. If a complete native round exceeds the history bound, drop that whole round and reconstruct context rather than truncating signed items or tool-call/result pairs.

Persist per-provider selected models in a version-1 `teachingSettings` JSON preference. Use additive optional fields in existing JSON events/snapshots where possible; no SQLite table migration is planned. Test old lessons and exports explicitly. Scope course-summary caches to provider/model and prompt/schema version as well as document/extraction identity, so choosing another provider does not silently reuse a previous provider's summaries.

Preserve application identity, profile discovery, repaired startup/single-instance behavior, installed shortcut, documents, and existing voice configuration.

## Scope boundaries

This adds two teaching backends, not a new hosted server. New OCR, image interpretation, direct in-composer attachments, image/video generation, Google/Groq speech engines, provider web search, external tool execution, automatic failover, and per-request provider load balancing are separate features. Automatic activation after successful explicit key connection is included. Existing locally generated diagrams and simulations must work through both new providers without those additions.

## Approval and acceptance

The user approved this design and the accompanying implementation plan on 31 October 2026, including building the current app. Real Gemini/Groq keys are entered directly in Settings for live acceptance. No key was read by the implementation agents or embedded in the source/test fixtures.

Acceptance requires Gemini-only and Groq-only runs with ChatGPT disconnected: connect a valid key and immediately route new teaching to that provider without manually switching, create/approve a roadmap, teach and draw, generate/manipulate a simulation, answer an interruption, continue after real presentation, plan from readable supplied material with valid citations, save/reopen, and retain voice behavior. Verify the two persistent "ChatGPT connected" labels are absent while account/settings controls and all other lesson UI remain functional. Test reverse-order key validations, remembered unavailable models, failure preserving the old connection, restart with multiple saved keys, invalid data, partial streams, quotas, and offline replay. Verify a packaged Windows build and the Start shortcut before delivering an installer. Report fixture evidence separately from real provider acceptance.

## Official sources

- [Gemini Interactions overview](https://ai.google.dev/gemini-api/docs/interactions-overview)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini model discovery](https://ai.google.dev/api/models)
- [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)
- [Groq API compatibility and base URL](https://console.groq.com/docs/openai)
- [Groq local tool calling and streaming](https://console.groq.com/docs/tool-use/local-tool-calling)
- [Groq Structured Outputs limitations](https://console.groq.com/docs/structured-outputs)
- [Groq model discovery](https://console.groq.com/docs/models)
- [Groq rate limits](https://console.groq.com/docs/rate-limits)
- [Groq API reference](https://console.groq.com/docs/api-reference)
- [Groq reasoning options](https://console.groq.com/docs/reasoning)
