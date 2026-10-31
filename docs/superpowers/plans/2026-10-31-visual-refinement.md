# Canvas Atlas Visual Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Make generated explanations explorable through maths, mechanics and 3D controls while retaining the existing teaching workflow.

**Architecture:** Keep canonical canvas entities, worker transport, fixed-step simulation and audio playback. Add bounded data-only model adapters and one numeric JSXGraph view; extend the native Three renderer. Preserve old QuickJS programs and saved lessons.

**Tech Stack:** Electron/React/TypeScript, JSXGraph 1.14.2, Matter.js 0.20.0, Three.js 0.186.1, Motion 14.9.0, Zod, Vitest, Playwright.

**Spec:** docs/superpowers/specs/2026-10-31-visual-refinement.md

## Global Constraints

- Optional engine quickjs/model; default legacy behavior; model source at most 64 KiB.
- Strict teaching tool schema at most 100 properties; no renderer or worker execution of model-supplied code.
- Fixed 60 Hz, at most two admitted runs, existing 36,000 ticks/1,000 inputs/history/watchdog bounds.
- Preserve notes, safety, saved work, provider selection, narration and reduced motion.
- Reuse DESIGN.md tokens and UX-CONTRACT.md owners; keep footer stable.
- Use synthetic isolated test profiles and no paid inference probes.

## Review Focus

- Run identity changes must not replace an admitted engine/source through step/input messages.
- Reopen after collisions/control changes must reproduce the solver state through history.
- Dragging two point coordinates must make one saved input and remain keyboard-editable.
- Pausing, switching views, navigating or unmounting during async work must not apply stale state.
- Invalid plots, WebGL failure and compact windows must retain a reachable useful diagram.

### Task 1: Trusted contracts and model runtime

**Files:** protocol core/models/math-model/physics-model; simulation model-contract/model-runtime/math-model/physics-model; simulation worker; contract/runtime tests.

**Interfaces:** model schemas and binding validators; parseModelSource(source,controls); ModelSession {step,input,render,dispose}; ModelSimulationRuntime(legacy).run(input).

- [x] Write/run failing tests for model admission, unknown keys, references and legacy compatibility.
- [x] Implement bounded schemas, pinned dispatch, staged replay and finite canonical frames.
- [x] Verify fixed-step displacement, controls, collision replay, cancellation/eviction and admission budgets.

### Task 2: Maths exploration

**Files:** renderer visuals/MathStage.tsx, math-stage.css and tests; useSimulation.ts; App.tsx and tests.

**Interfaces:** MathStage {state:MathFrame,interactive,onChange(values),onFailure}; useSimulation exposes current state and atomic changeMany.

- [x] Test projection consistency, drag commit, render lifecycle and paused entry before integration.
- [x] Add JSXGraph SVG renderer of numeric frames only; preserve canonical board and existing controls.
- [x] Add explicit Diagram/Explore graph view, pause/settle barriers, reset/navigation handling and accessibility.

### Task 3: 3D exploration and restrained motion

**Files:** Scene3D/VisualStage and tests; scoped spatial-view.css; root App prop wiring.

**Interfaces:** VisualStage accepts optional interactionEnabled and viewKey; Scene3D uses local camera override only.

- [x] Test paused-only interaction, reset/new-view/resume and cleanup/fallback before implementation.
- [x] Add bounded OrbitControls, keyboard view controls, readable labels and reduced-motion-aware supporting fades.
- [x] Verify resize/compact layouts and 2D fallback receipts.

### Task 4: Tutor integration and regression verification

**Files:** teacher model instructions/tests, DESIGN.md, UX-CONTRACT.md, README, native visual-refinement fixture/tests and validation record.

- [x] Teach model selection/JSON format, meaningful controls/assumptions and explanatory motion through the current tool path.
- [x] Run focused tests, native isolated graph/physics/3D/save/replay/safety flows and independent code review; repair findings.
- [x] Run full Vitest suite, typecheck, lint, build and premium static audit; record actual evidence.

### Task 5: Reviewed desktop build

**Files:** version manifests/lock; release/visual-refinement artifacts; validation notes.

- [x] Package 0.6.0 and rerun packaged startup/provider/notes/safety/visual checks with isolated profiles.
- [x] Close installed app normally, install tested package, compare installed hashes and reopen through Start.
- [x] Report user-facing capabilities, verification and concrete limitations. Do not commit/push/publish.
