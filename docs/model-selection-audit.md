# Model selection audit — 22 October 2026

The app-owned lesson database was inspected read-only after the running app closed gracefully. No credential file or token was read. An opaque database/WAL/SHM backup was retained under the ignored `private/` directory. `PRAGMA quick_check` returned `ok` after closure; the earlier failed reads while the app was running were not evidence of persistent database corruption.

The saved `selectedModel` preference was exactly **`gpt-6-astra`**. This establishes the saved preference at audit time. The existing lesson records did not store the model requested for each turn or the model reported by the completed response, so the **historical requested and served model IDs are unknown**. The three saved provider rounds contained function-call outputs without response-level model metadata. Answer style does not establish the served model.

The saved first student prompt named **cavitation**. The first tutor acknowledgment explained vapor bubbles, low liquid pressure, and propeller damage: it answered cavitation. If the intended spoken topic was gravitation, the saved input differed before that answer was generated. This observation does not establish where the transcription difference arose.

The model-selection fix preserves exact catalog IDs, restores the saved choice immediately, and does not silently substitute the first model when a saved choice is unavailable. Catalog replies from an older request/account/selection cannot replace newer state. A request superseded by a model change is rejected before teacher dispatch. A selected model is captured before asynchronous credential renewal.

New completed provider rounds store only safe model metadata: requested ID, independently reported served ID when present, response ID when present, and completion timestamp. Missing served IDs remain unknown. Metadata is retained in the local lesson snapshot and provider-round event without adding credentials or backfilling historical guesses. Automatic continuation uses the same authorization and model-availability gate as student questions.

Verification: the new regression cases were observed failing before implementation. The focused model-selection, provider, stream, storage and IPC run passed **21 tests**. Root integration owns the teacher coordinator, shared protocol and renderer changes, plus a subsequent live product-level verification.
