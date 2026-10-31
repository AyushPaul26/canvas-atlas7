# Live tutor verification — 22 October 2026

The updated desktop build was launched using Living Canvas's own existing signed-in profile. Only product main handled its encrypted credentials. The trial did not read or reuse another application's tokens, change the selected model, or modify a previous lesson.

The initial status and account catalog established that the exact selected ID `gpt-6-astra` was available. A new lesson was started through the normal Start learning → topic → Begin lesson UI with “Today I want to learn about gravitation.” No fixture responses, synthetic completion acknowledgments, or scripted lesson contents were injected.

Two completed provider responses independently reported `gpt-6-astra`, matching the requested ID. Both records were saved in the new lesson's modelRuns. The first generated step connected falling objects and lunar orbits with a 13-entity diagram. After its real presentation completed, the application requested the next step automatically. That response developed Newton's inverse-square relationship, mass/distance changes, and equal opposing forces, with a fresh 10-entity equation/force diagram. Both steps chose continue explicitly. No provider or presentation errors were observed.

The trial stopped after the second response arrived, approximately 92 seconds after starting. The first narration had completed; the second diagram had begun appearing and its voice was preparing. Pause canceled remaining presentation. Saved conversation contained the real student request and the actually completed first narration, without pretending the second narration had been heard. Historical lessons were left intact. Raw evidence and a screenshot are retained only in ignored private development artifacts because they include the local account display.

This establishes exact model routing and one real automatic continuation with coherent generated content. It does not establish mastery, broad topic quality, a full gravitation curriculum, microphone quality, or all possible generated simulations. The historical answers still have unknown served-model IDs; their model cannot be inferred from this new run.
