---
version: alpha
colors:
  paper: "#F5F7FA"
  surface: "#FFFFFF"
  ink: "#18243B"
  primary: "#18243B"
  muted: "#667185"
  accent: "#7775E7"
  accentStrong: "#5754BD"
  mint: "#C3E9D7"
  border: "#DFE4EC"
  danger: "#B13D4D"
typography:
  display:
    fontFamily: "Bricolage Grotesque, Segoe UI, sans-serif"
    lineHeight: "1.08"
  body:
    fontFamily: "DM Sans, Segoe UI, sans-serif"
    lineHeight: "1.5"
rounded:
  control: "10px"
  panel: "18px"
spacing:
  small: "8px"
  medium: "16px"
  large: "24px"
  section: "48px"
components:
  primaryButton:
    backgroundColor: "#18243B"
    textColor: "#FFFFFF"
    rounded: "10px"
---

# Canvas Atlas design

## Overview
An English personal teacher for a Windows laptop. The product should feel like an open sketchbook on a generous studio desk: patient, precise, and ready for the learner's question. It is an application, never a landing page or a simulated lesson catalogue.

The signature is a small hand-drawn orbital loop with a mint satellite. It suggests an idea becoming visible without implying one particular subject. It appears at home and in the empty canvas; established lessons own the visual space.

## Colors
Cool paper surrounds white working surfaces. Navy carries text and primary actions. Periwinkle marks active navigation, selected objects, and teaching status; mint provides a quiet supporting shape. Red is reserved for errors and destructive confirmation. Accent strong is used wherever small text needs stronger contrast.

## Typography
Bricolage Grotesque gives the opening question and lesson titles a personal, slightly offbeat character. DM Sans handles controls, transcript, and descriptions. Fonts are bundled locally; system fallbacks keep the application usable if a font fails. No network font dependencies.

## Layout
A 224px quiet sidebar frames the desktop workspace. Home uses a restrained two-column composition and a single main action. The lesson's canvas takes the majority of available space; the transcript is compact and may collapse. Below 980px the sidebar contracts; below 760px navigation becomes a horizontal strip and the transcript follows the canvas. Natural document scrolling remains available on narrow screens. Spacing uses 8/16/24/48px with smaller optical adjustments.

The learning roadmap is a numbered sequence of actual concepts with objectives, a compact covered count, and explicit Start Teaching actions. It opens before a new lesson begins. During teaching the canvas leads; the transcript starts collapsed and a compact current-concept strip gives context. Playback, questions, and teaching adjustments stay visible outside the transcript. Materials use the same quiet borders and typography: local extraction coverage precedes the course outline, and saved source pages open in the native dialog.

On desktop windows, playback and the question composer occupy a reserved footer below the independently scrolling lesson body. Understanding checks sit beside the drawing in a separate scrolling rail; opening the transcript does not push the diagram down. Short windows contract vertical whitespace and share a row for teaching adjustments and voice status. The primary Pause teaching control remains available. Spatial views can scroll within the lesson body while questions stay reachable. Text size and the canvas minimum height do not shrink to fit the viewport.

## Elevation & Depth
Static panels use fine borders and nearly flat surfaces. Only dialogs and the floating canvas toolbar use soft elevation. No ambient gradients or ornamental metric cards.

## Shapes
Controls have 10px corners; panels use 18px. Friendly rounded corners are balanced by disciplined alignment. Canvas marks are imperfect strokes; shell geometry stays quiet.

## Components
Runtime CSS variables in `apps/desktop/src/renderer/styles.css` are canonical (token model B). This document mirrors their accepted values. `--paper`, `--surface`, `--ink`, `--muted`, `--accent`, `--accent-strong`, `--mint`, `--border`, `--danger` map to the colors above; `--font-display` and `--font-body` map to typography. Shared Button, Modal, Notice and Field styles own interaction states. Native selects intentionally retain Windows-owned popup behavior.

Motion is limited to drawing reveals, a brief screen entrance, and status indicators. Reduced motion disables reveals and decorative transitions. All focus rings remain visible. Real scenes can be selected, moved by drag or arrow keys, edited, saved, and exported; placeholder diagrams must never masquerade as tutor output.

## Do's and Don'ts
Voice settings extend the existing modal with a compact ElevenLabs section: masked key connection, account voice search/selection, supported tuning, preview/stop, and local-voice recovery. Native selects retain their Windows behavior. Form controls use the same label, border, focus, and action styles; the modal scrolls without changing the lesson layout. Preview follows the same speaking-speed preference as the lesson.

Teaching connections extend that same modal with Gemini/Groq masked-key forms and native provider/model selects, using the existing colors, spacing, labels, focus states, and buttons. A successful key connection activates its service. Permanent provider connection wording is omitted from the main header/sidebar as requested; details remain in Settings. The main teaching layout, account controls, requested/served evidence, local recognition, and independent ElevenLabs narration retain their existing roles.

Lesson notes extend the reserved lesson footer beside playback. Generate notes uses the existing compact secondary button with periwinkle text and a document icon; Open PDF and Save PDF are quiet text actions. A short usage hint sits beneath the actions, followed by real pending/success/error feedback. The groups wrap at narrow desktop sizes while the lesson body retains its own scroll; no new overlay or visual identity is introduced. Colors and typography come from the existing runtime variables in styles.css.

The same notes group offers Create notes offline as a quiet, clearly separate action; local progress and saved records say Offline study record. Animate this extends the existing teaching-adjustment chips without introducing another toolbar. Meaningful object motion follows the lesson timeline rather than an independent decorative animation. Recognized safety stops reuse the notice area with a neutral surface and concise Edit question / New topic recovery actions. The reserved footer stays reachable while the lesson body absorbs compact-window scrolling.

Use the learner's own topic and real session data. Prefer clear teaching statuses over fake progress. Keep errors actionable and preserve the working scene. Do not add fabricated activity, sample completed lessons, confidence scores, quotas, or generated answers to the home screen. Do not show generated source code in the teaching flow.

Maths exploration extends the existing canvas with a small Diagram / Explore graph button group. Entering Explore pauses teaching before drawing the numeric graph. The graph uses the same periwinkle/mint/green visual marks as its saved diagram, with labelled coordinate fields as the keyboard alternative to point dragging. Its body scrolls within the existing lesson area; playback and questions retain their reserved footer. The whiteboard remains available through Diagram. No new application theme or sample topic catalogue is introduced.

Spatial scenes use a compact native 3D toolbar, escaped labels anchored to accepted objects, and a full text legend when labels overlap. Rotate/zoom, arrow-key controls and Reset view are available while teaching is paused; teacher playback restores its accepted camera. Supporting hints fade briefly with Motion; reduced motion makes them immediate. Scene geometry continues to follow the audio clock rather than an ambient animation loop.
