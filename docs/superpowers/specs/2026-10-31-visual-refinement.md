# Canvas Atlas interactive visual refinement

The user approved implementation of the researched visual improvements in the current app. Extend the existing canvas, lesson timeline and sandbox rather than replacing them. This is a learner-facing upgrade, not a sample gallery or a fixed lesson catalogue.

## Capabilities

1. JSXGraph offers an explicit Explore graph view for AI-composed maths: bounded numeric points, sampled plots and vectors; direct-control point dragging and existing numeric controls are equivalent inputs. Entering Explore first pauses teaching and settles the simulation. Drag release commits both coordinates atomically. The same worker computes canonical canvas marks and numeric JSXGraph frames, with no second evaluator or clock in the renderer.
2. Matter.js computes bounded 2D rigid-body mechanics, circles/rectangles, joints and declared numeric control bindings. Fixed 60 Hz steps follow the existing playback owner. Uniform gravity is illustrative mechanics, never advertised as a planetary solver. Show measurements and assumptions through existing experiment UI.
3. Three.js OrbitControls enables local rotate/zoom when teaching is paused/stopped. Reset, keyboard controls and anchored escaped labels improve exploration. Resume or a new accepted view restores the teacher camera. Preserve the explanatory 2D fallback and presentation acknowledgements.
4. Motion provides short supporting UI fades only. Existing audio-controlled reveals/path motion remain authoritative. Reduced motion, keyboard input, stable footer geometry and current design tokens remain supported.

## Data and trust

SimulationArtifact adds one optional engine enum: quickjs or model; omission keeps old saved simulations working. For model, source holds version:1 JSON with kind math or physics, capped at 64 KiB and validated before admission. The strict provider tool schema must remain at or below 100 properties (baseline 97). Model specs contain no executable callbacks, imports, URLs, HTML or plugins. Trusted library code is bundled inside the terminable simulation worker. Existing QuickJS isolation, frame validation, learner safety, provider selection, key storage and local voice remain unchanged.

Shared session API: createMathModelSession/model-specific physics factory receives validated model, declared controls and initial values and returns {step,input,render,dispose}; all frames remain SimulationResult. Replay uses original model, initial values and ordered inputs; never trust a serialized solver object. Shared runtime owns at most two live runs, pins each run to its admitted artifact, stages failed proposals without evicting working ones and preserves explicit time/history/watchdog bounds.

## Learner behavior and compatibility

AI chooses useful model primitives, labels, measurements and controls during real lessons. Explain representations consistently; no model generation call occurs per animation frame or drag. Static canonical marks remain available for canvas editing, presented-diagram notes and offline exports. Save/reopen/reset/replay preserve controls and state through the current input history. Explore is a reversible local view, not lesson completion evidence. Failure pauses clearly and retains the last working canvas. No silent provider/model fallback, inference probe, publishing or Git push is part of this work.

Preserve accumulated uncommitted work in the actual checkout at Desktop/akki hacks/learner guide/living-canvas. Build 0.6.0 separately from prior releases, verify isolated packaged workflows before normal-close local installation, retain existing profiles and reopen through the installed Start shortcut. Real service inference quality remains unverified without an explicit live test.
