import VoiceSettings from './voice/VoiceSettings';
import TeachingSettings from './ai/TeachingSettings';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDownToLine, ArrowLeft, ArrowRight, AudioLines, Check, ChevronRight, CircleHelp, Clock3, Home, LoaderCircle, MessageCircle, Mic, Pause, Play, Plus, RotateCcw, Save, Settings2, Sparkles, Square, Trash2, Volume2, VolumeX, X } from 'lucide-react';
import type { CourseRecord, DocumentManifest, PlaybackCheckpoint, SourceRef, AppStatus, LessonSession, ModelInfo, ModelRunMetadata, SceneEntity, SessionSummary, TeachingBeat, TutorEvent } from '@living-canvas/protocol';
import { adaptTeachingBeat, isLearnerSafetyMessage, safetyOutcomeFromError, LIMITS, mathFrameSchema } from '@living-canvas/protocol';
import { bridge, type Values } from './bridge';
import { OrbitMark } from './SceneCanvas';
import { useVoice } from './useVoice';
import { useSimulation } from './useSimulation';
import { useLessonPlayback, type LessonPlaybackFrame } from './useLessonPlayback';
import { evaluateVisualFrame, type VisualFrame } from '@living-canvas/scene';
import VisualStage from './visuals/VisualStage';
import MathExplorer from './visuals/MathExplorer';
import LearningWorkspace, { UnderstandingCheck } from './learning/LearningWorkspace';
import PlaybackControls from './learning/PlaybackControls';
import LessonNotes from './notes/LessonNotes';
import MaterialImport from './materials/MaterialImport';
import SourcePreview from './materials/SourcePreview';

type Screen = 'home' | 'topic' | 'lesson' | 'history';
type Notice = { text: string; error?: boolean; safety?:boolean; safeAlternative?:string } | null;
export function applyBeat(scene: SceneEntity[], beat: TeachingBeat): SceneEntity[] {
  if (beat.canvas.mode === 'replace') return [...beat.canvas.entities, ...scene.filter((entity) => entity.semanticRole === 'learner-note' && !beat.canvas.entities.some((next) => next.id === entity.id))];
  const incoming = new Map(beat.canvas.entities.map((entity) => [entity.id, entity]));
  return [...scene.map((entity) => incoming.has(entity.id) ? { ...entity, ...incoming.get(entity.id) } : entity), ...beat.canvas.entities.filter((entity) => !scene.some((existing) => existing.id === entity.id))];
}
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method 'lc:[A-Za-z][A-Za-z0-9]*': Error: /, '');
const teachingReady = (status: AppStatus) => status.teachingReady ?? (status.connected && status.planEnabled && status.modelAvailable !== false);
const dateLabel = (date: string) => new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(date));
const measurementLabel = (key: string) => ({ time_s: 'Time (s)', translational_energy_J: 'Translational kinetic energy (J)', momentum_x_kg_m_s: 'Horizontal momentum (kg·m/s)', momentum_y_kg_m_s: 'Vertical momentum (kg·m/s)' } as Record<string, string>)[key] ?? key;

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [status, setStatus] = useState<AppStatus>({ connected: false, planEnabled: false, desktop: Boolean(window.livingCanvas) });
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const busyAction=useRef<{name:string}|null>(null);
  const safetyAdmission=useRef<{requestId:string;topic:string;connection:string}|null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [settings, setSettings] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [topic, setTopic] = useState('');
  const [question, setQuestion] = useState('');
  const [pendingVoice, setPendingVoice] = useState<string | null>(null);
  const [lastModelRun, setLastModelRun] = useState<ModelRunMetadata | null>(null);
  const [session, setSession] = useState<LessonSession | null>(null);
  const [scene, setScene] = useState<SceneEntity[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [phase, setPhase] = useState('ready');
  const [presenting, setPresenting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [visualFrame, setVisualFrame] = useState<VisualFrame>();
  const [source, setSource] = useState<SourceRef>();
  const [documents, setDocuments] = useState<DocumentManifest[]>([]);
  const [courses, setCourses] = useState<CourseRecord[]>([]);
  const [course, setCourse] = useState<CourseRecord | null>(null);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const importJob = useRef<string | undefined>(undefined);
  const playbackBaseline = useRef<SceneEntity[]>([]);
  const playbackBeat = useRef<TeachingBeat | undefined>(undefined);
  const reviewMode = useRef(false);
  const chunkDurations = useRef<Record<string, number>>({});
  const visualFailureNotice = useRef<string | undefined>(undefined);
  const visualReady = useRef<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> } | undefined>(undefined);
  const userPaused = useRef(false);
  const deferredBeat = useRef<{ sessionId: string; epoch: number; beat: TeachingBeat } | undefined>(undefined);
  const visualGeneration = useRef(0);
  const simulationTickOffset = useRef(0);
  const lastVisualFrame = useRef<VisualFrame | undefined>(undefined);
  const changedExperiment = useRef(false);
  const experimentEditRevision = useRef(0), savedExperimentRevision = useRef(0);
  const sceneRef = useRef(scene); sceneRef.current = scene;
  const visibleScene = useRef<SceneEntity[]>([]);
  const sessionRef = useRef(session); sessionRef.current = session;
  const screenRef = useRef(screen); screenRef.current = screen;
  const epoch = useRef(-1);
  const blockedEpoch = useRef(-1);
  const presentationGeneration = useRef(0);
  const beatQueue = useRef<Array<Extract<TutorEvent, {type:'beat'}>>>([]);
  const pumpRef = useRef<() => Promise<void>>(async () => {});
  const pumping = useRef(false);
  const queuedBeats = useRef(0);
  const acceptedBeats = useRef(new Set<string>());
  const currentPresentation = useRef<{ sessionId: string; epoch: number; beatId: string; narration: string; generation: number } | null>(null);
  const progressQueue = useRef<Promise<void>>(Promise.resolve());
  const closing = useRef(false);
  const automaticSend = useRef<ReturnType<typeof setTimeout> | null>(null);
  const automaticSendGeneration = useRef(0);
  const sendQuestionRef = useRef<(text: string) => void>(() => {});
  const speechBase = useRef('');
  const voiceOwnsDraft = useRef(false);
  const speechInterruption = useRef<Promise<void>>(Promise.resolve());
  const voiceActions = useRef<{ onDraft?: (text: string) => void; onFinal?: (text: string) => void; onSpeechStart?: () => void }>({});
  const questionRef = useRef(question); questionRef.current = question;
  const lastQuestion = useRef<{sessionId:string;text:string}|undefined>(undefined);
  const topicRef = useRef(topic); topicRef.current = topic;
  const statusRef = useRef(status); statusRef.current = status;
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const topicInput = useRef<HTMLTextAreaElement>(null);
  const questionInput = useRef<HTMLTextAreaElement>(null);
  const transcriptBottom = useRef<HTMLDivElement>(null);
  const connectionIdentity=(value=statusRef.current)=>JSON.stringify([value.teachingProvider,value.teachingRevision,value.model]);
  const cancelSafetyAdmission=(release=true)=>{
    const pending=safetyAdmission.current;if(!pending)return;
    safetyAdmission.current=null;
    if(typeof bridge.cancelSafetyAdmission==='function')void bridge.cancelSafetyAdmission(pending.requestId).catch(()=>{});
    if(busyAction.current?.name==='start'){busyAction.current=null;if(release)setBusy(null);}
  };
  const updateTopic=(value:string)=>{if(value!==topicRef.current)cancelSafetyAdmission();topicRef.current=value;setTopic(value);};
  const simulation = useSimulation((text) => showFailure(text));
  const simulationRef = useRef(simulation); simulationRef.current = simulation;
  const voice = useVoice((text) => {
    if (screenRef.current === 'topic') updateTopic(topicRef.current ? `${topicRef.current} ${text}` : text);
    else setQuestion((value) => value ? `${value} ${text}` : text);
  }, (text) => showFailure(text), {
    onDraft: (text) => voiceActions.current.onDraft?.(text),
    onFinal: (text) => voiceActions.current.onFinal?.(text),
    onSpeechStart: () => voiceActions.current.onSpeechStart?.(),
  });
  const voiceRef = useRef(voice); voiceRef.current = voice;
  const renderFrame = async (beat: TeachingBeat, position: LessonPlaybackFrame | { cursor: PlaybackCheckpoint['cursor']; progress: number; durationSeconds: number; offsetSeconds: number }) => {
    const generation = visualGeneration.current;
    const isCurrent = () => generation === visualGeneration.current;
    if (position.durationSeconds > 0) chunkDurations.current[position.cursor.chunkId] = position.durationSeconds;
    const frame = evaluateVisualFrame(beat, position, { entities: playbackBaseline.current, reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, chunkDurations: chunkDurations.current });
    if (frame.invalidCueIds.length) throw new Error('A visual instruction could not be shown. Retry teaching.');
    if (beat.simulation) {
      const target = Math.max(0, Math.min(36000, frame.simulationTargetTick + simulationTickOffset.current));
      const advance = async () => {
        let snapshot = simulationRef.current.checkpoint();
        if (snapshot && target < snapshot.tick) {
          const inputs = snapshot.inputs?.filter(input => input.tick <= target);
          const replay = { ...snapshot, tick: target, inputs, values: { ...(inputs?.at(-1)?.values ?? snapshot.initialValues ?? snapshot.values) } };
          if (!await simulationRef.current.start(beat.simulation!, replay.values, replay)) throw new Error('The saved experiment could not restart at this audio chunk.');
          if (!isCurrent()) return;
          snapshot = simulationRef.current.checkpoint();
        }
        let caughtUp = snapshot?.tick === target;
        for (let slice = 0; slice < 200 && !caughtUp; slice++) {
          caughtUp = await simulationRef.current.advanceTo(target);
          if (!isCurrent()) return;
          if (!caughtUp) { await new Promise<void>(resolve => setTimeout(resolve, 0)); if (!isCurrent()) return; }
        }
        if (!caughtUp) throw new Error('The experiment could not keep up with playback. Retry teaching.');
      };
      if (simulationRef.current.checkpoint()?.tick !== target) {
        if (voiceRef.current.audioPlayback.buffer) await voiceRef.current.audioPlayback.buffer(advance);
        else if (position.durationSeconds === 0) await advance();
        else throw new Error('This voice cannot synchronize the experiment. Choose ElevenLabs or the natural local voice and retry.');
        if (!isCurrent()) return;
      }
    }
    if (!isCurrent()) return;
    lastVisualFrame.current = frame;
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { visualReady.current = undefined; reject(new Error('The teaching visual did not become ready. Retry teaching.')); }, 10000);
      visualReady.current = { resolve, reject, timer };
    });
    setVisualFrame(frame);
    setScene(current => [...frame.entities, ...current.filter(entity => entity.semanticRole === 'learner-note' && !frame.entities.some(item => item.id === entity.id))]);
    await ready;
    if (!isCurrent()) return;
  };
  const playback = useLessonPlayback({
    audio: voice.audioPlayback,
    getVisibleScene: () => visibleScene.current.filter(entity => entity.semanticRole !== 'learner-note'),
    getSimulationCheckpoint: () => simulationRef.current.checkpoint(),
    onPrepare: async (beat, mode) => {
      const generation = visualGeneration.current;
      chunkDurations.current = {}; simulationTickOffset.current = 0; simulationRef.current.setTimelineControlled(true);
      if (beat.simulation) {
        if (!await simulationRef.current.start(beat.simulation, {}, resumeCheckpoint.current?.simulation)) throw new Error('The experiment could not start. Retry teaching.');
      } else if (mode !== 'prepare') {
        const original = restorationCheckpoint.current?.simulation;
        if (original) {
          if (!await simulationRef.current.start(original.artifact, original.values, original)) throw new Error('The saved experiment could not be restored. Retry teaching.');
        } else { simulationRef.current.clear(); controlsRef.current = {}; }
      } else if (beat.canvas.mode === 'replace') { simulationRef.current.clear(); controlsRef.current = {}; }
      if (generation !== visualGeneration.current) return;
      const cursor = { beatId: beat.id, chunkId: beat.chunks.find(chunk => !resumeCheckpoint.current?.completedChunkIds.includes(chunk.id))?.id ?? beat.chunks.at(-1)!.id, offsetSeconds: 0, passId: 'preparing' };
      if (resumeCheckpoint.current?.simulation) {
        const atChunkStart = evaluateVisualFrame(beat, cursor, playbackBaseline.current).simulationTargetTick;
        simulationTickOffset.current = Math.max(0, resumeCheckpoint.current.simulation.tick - Math.floor(resumeCheckpoint.current.cursor.offsetSeconds * 60)) - atChunkStart;
      }
      await renderFrame(beat, { cursor, progress: 0, offsetSeconds: 0, durationSeconds: 0 });
    },
    onFrame: async frame => { if (playbackBeat.current) await renderFrame(playbackBeat.current, frame); },
    onCue: async cue => {
      if (cue.action.type === 'experiment' && !await simulationRef.current.changeAsync(cue.action.controlId, cue.action.value)) throw new Error('The experiment control could not be applied. Retry teaching.');
    },
    onHeard: prefix => {
      const current = currentPresentation.current;
      if (!current || reviewMode.current || current.generation !== presentationGeneration.current) return;
      current.narration = prefix;
      setSession(value => value && ({ ...value, messages: value.messages.map(message => message.id === current.beatId ? { ...message, text: prefix } : message) }));
    },
    onCheckpoint: async checkpoint => {
      const current = currentPresentation.current;
      if (!current || reviewMode.current || current.generation !== presentationGeneration.current) return;
      if (checkpoint.receipt && playbackBeat.current?.cues?.some(cue => !lastVisualFrame.current?.completedCueIds.includes(cue.id))) throw new Error('A teaching visual did not finish with the audio. Retry this concept.');
      await bridge.savePlayback({ sessionId: current.sessionId, epoch: current.epoch, checkpoint });
      await flushProgress();
    },
    onComplete: async () => {
      if (reviewMode.current) return;
      await flushProgress(true);
      const current = currentPresentation.current;
      if (!current || current.generation !== presentationGeneration.current) return;
      const loaded = await bridge.loadSession(current.sessionId);
      if (sessionRef.current?.id === loaded.id) setSession(value => value && ({ ...value, scene: loaded.scene, learningProgress: loaded.learningProgress, playback: loaded.playback }));
    },
    onError: message => { if (!currentPresentation.current || currentPresentation.current.generation !== presentationGeneration.current) return; setPhase('paused'); showFailure(message); },
  });
  const playbackRef = useRef(playback); playbackRef.current = playback;
  const resumeCheckpoint = useRef<PlaybackCheckpoint | undefined>(undefined);
  const restorationCheckpoint = useRef<PlaybackCheckpoint | undefined>(undefined);
  const pendingCheck = Boolean(session?.learningProgress?.pendingCheck && !session.learningProgress.pendingCheck.evidence);
  const canTeach = teachingReady(status);
  const teachingConnected = status.teachingConnected ?? status.connected;
  const apiTeaching = status.teachingProvider === 'gemini' || status.teachingProvider === 'groq';
  const active = ['thinking', 'drawing', 'speaking'].includes(phase) || voice.speaking || presenting;
  const visualInteractionEnabled = !active && !voice.playing && !simulation.running;
  const mathFrame = useMemo(() => {
    if (simulation.artifact?.engine !== 'model') return undefined;
    const parsed = mathFrameSchema.safeParse(simulation.frameState);
    return parsed.success ? parsed.data : undefined;
  }, [simulation.artifact?.engine, simulation.frameState]);
  const cancelPresentation = () => {
    presentationGeneration.current++; visualGeneration.current++; deferredBeat.current = undefined; beatQueue.current = []; queuedBeats.current = 0;
    const waiting = visualReady.current; if (waiting) { clearTimeout(waiting.timer); waiting.reject(new Error('Presentation interrupted.')); visualReady.current = undefined; }
    setPresenting(false);
  };
  const cancelVoiceSend = () => {
    automaticSendGeneration.current++; if (automaticSend.current) clearTimeout(automaticSend.current);
    automaticSend.current = null; setPendingVoice(null);
  };
  const preserveVisibleScene = () => {
    const ids = new Set(visibleScene.current.map((entity) => entity.id));
    const preserved = sceneRef.current.filter((entity) => ids.has(entity.id));
    if (preserved.length < sceneRef.current.length) {
      sceneRef.current = preserved; setScene(preserved); setDirty(true); dirtyRef.current = true;
    }
  };
  const flushProgress = async (complete = false) => {
    const current = currentPresentation.current;
    if (!current || reviewMode.current || current.generation !== presentationGeneration.current) return;
    const input = { sessionId: current.sessionId, epoch: current.epoch, beatId: current.beatId, scene: [...visibleScene.current], narration: current.narration, complete };
    progressQueue.current = progressQueue.current.catch(() => {}).then(() => bridge.presentProgress(input));
    await progressQueue.current;
  };
  const captureVisible = (entities: SceneEntity[]) => { visibleScene.current = entities;  };
  const showFailure = (error:unknown) => {
    const outcome=safetyOutcomeFromError(error);
    if (!outcome) { setNotice({text:errorText(error),error:true}); return; }
    cancelSafetyAdmission();
    userPaused.current=true; blockedEpoch.current=Math.max(blockedEpoch.current,epoch.current);
    cancelVoiceSend(); preserveVisibleScene(); void flushProgress().catch(()=>{}); cancelPresentation();
    void playbackRef.current.interrupt().catch(()=>{}); voiceRef.current.stopSpeaking();
    void voiceRef.current.stopRecording(true).catch(()=>{}); simulationRef.current.pause(); currentPresentation.current=null;
    if(sessionRef.current){
      const request=lastQuestion.current;
      if(request?.sessionId===sessionRef.current.id)setQuestion(current=>current||request.text);
      void bridge.interrupt(sessionRef.current.id).catch(()=>{});
    }
    setPhase('paused');setNotice({text:outcome.message,safety:true,safeAlternative:outcome.safeAlternative});
    if(outcome.decision==='REVIEW')queueMicrotask(()=>(screenRef.current==='topic'?topicInput.current:questionInput.current)?.focus());
  };

  useEffect(()=>{
    const pending=safetyAdmission.current;
    if(pending&&pending.connection!==connectionIdentity())cancelSafetyAdmission();
  },[status.teachingProvider,status.teachingRevision,status.model]);
  useEffect(()=>()=>cancelSafetyAdmission(false),[]);

  const refreshSessions = useCallback(async () => setSessions(await bridge.getSessions()), []);
  useEffect(() => {
    let mounted = true;
    void Promise.all([bridge.getStatus(), bridge.getSessions()]).then(async ([appStatus, recent]) => {
      if (!mounted) return;
      setStatus(appStatus); setSessions(recent);
      if (appStatus.teachingConnected && appStatus.teachingProvider && typeof bridge.refreshTeachingModels === 'function') {
        await bridge.refreshTeachingModels(appStatus.teachingProvider);
        const refreshed = await bridge.getStatus();
        if (mounted) setStatus(refreshed);
      }
    }).catch((error) => { if (mounted) setNotice({ text: `Could not load your workspace: ${errorText(error)}`, error: true }); }).finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => { void bridge.getCourses().then(setCourses).catch(() => {}); }, []);

  useEffect(() => {
    document.title = screen === 'lesson' && session ? `${session.title} · Canvas Atlas` : screen === 'topic' ? 'Your next lesson · Canvas Atlas' : screen === 'history' ? 'Your lessons · Canvas Atlas' : 'Canvas Atlas';
    if (screen === 'topic') topicInput.current?.focus();
  }, [screen, session?.title]);
  useEffect(() => { transcriptBottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }); }, [session?.messages.length]);

  useEffect(() => bridge.onEvent((event: TutorEvent) => {
    if (event.type === 'closing') {
      cancelSafetyAdmission();
      if (closing.current) return;
      closing.current = true;
      void (async () => {
        try { await pause({ keepListening: false }); }
        catch (error) { setNotice({ text: `The latest lesson state could not be saved before closing: ${errorText(error)}`, error: true }); }
        finally { await bridge.readyToClose().catch((error) => setNotice({ text: errorText(error), error: true })); }
      })();
      return;
    }
    if (event.type === 'document-progress') { if (event.progress.jobId === importJob.current) setImportProgress(`${event.progress.status} · ${event.progress.pagesProcessed} of ${event.progress.totalPages} pages`); return; }
    if (event.type === 'auth') { if(safetyAdmission.current&&safetyAdmission.current.connection!==connectionIdentity(event.status))cancelSafetyAdmission();setStatus(event.status); return; }
    if (!sessionRef.current || (event.sessionId && event.sessionId !== sessionRef.current.id)) return;
    if (event.epoch !== undefined && (event.epoch < epoch.current || event.epoch <= blockedEpoch.current)) return;
    if (event.epoch !== undefined) epoch.current = event.epoch;
    if (event.type === 'status' && event.phase === 'paused') {
      blockedEpoch.current = Math.max(blockedEpoch.current, event.epoch);
      cancelVoiceSend(); preserveVisibleScene(); cancelPresentation();
      void playbackRef.current.interrupt(); voiceRef.current.stopSpeaking(); simulationRef.current.pause(); currentPresentation.current = null;
      setPhase('paused'); return;
    }
    if (event.type === 'model') { setLastModelRun(event.metadata); setSession((current) => current && ({ ...current, modelRuns: [...(current.modelRuns ?? []), event.metadata] })); return; }
    if (event.type === 'status' && !(queuedBeats.current && event.phase === 'ready')) setPhase(event.phase);
    if (event.type === 'error') { if(isLearnerSafetyMessage(event.message)){showFailure(event.message);return;} preserveVisibleScene(); voiceRef.current.stopSpeaking(); simulationRef.current.pause(); void flushProgress().catch(() => {}); cancelPresentation(); setNotice({ text: event.message, error: true }); setPhase('paused'); }
    if (event.type === 'beat') {
      if (acceptedBeats.current.has(event.beat.id)) return;
      if (queuedBeats.current >= 2) { setNotice({ text: 'The teaching queue is full. Pause and retry this concept.', error: true }); return; }
      acceptedBeats.current.add(event.beat.id); beatQueue.current.push(event); queuedBeats.current++; setPresenting(true);
      if (!userPaused.current) void pumpRef.current();
    }
    if (event.type === 'done') { if (!queuedBeats.current) setPhase('ready'); void refreshSessions().catch(() => {}); }
  }), [refreshSessions]);

  pumpRef.current = async () => {
    if (pumping.current) return;
    pumping.current = true;
    const generation = presentationGeneration.current;
    try {
      while (beatQueue.current.length && !userPaused.current && generation === presentationGeneration.current) {
        const event = beatQueue.current.shift()!;
        if (event.sessionId !== sessionRef.current?.id || event.epoch <= blockedEpoch.current) continue;
        reviewMode.current = false; resumeCheckpoint.current = undefined; playbackBeat.current = event.beat;
        playbackBaseline.current = event.baselineScene ?? applyBeat(sceneRef.current.filter(entity => entity.semanticRole !== 'learner-note'), event.beat);
        currentPresentation.current = { sessionId: event.sessionId, epoch: event.epoch, beatId: event.beat.id, narration: '', generation };
        setSession(value => !value || value.beats.some(beat => beat.id === event.beat.id) ? value : ({ ...value, beats: [...value.beats, event.beat], messages: [...value.messages, { id: event.beat.id, role: 'tutor', text: '', createdAt: new Date().toISOString() }] }));
        setPhase('drawing');
        await playbackRef.current.prepare(event.beat, { baselineScene: playbackBaseline.current, planId: sessionRef.current?.plan?.id, planVersion: sessionRef.current?.plan?.version });
        if (generation !== presentationGeneration.current) break;
        setPhase('speaking');
        const result = await playbackRef.current.play();
        if (generation !== presentationGeneration.current || result !== 'completed') { setPhase('paused'); break; }
        queuedBeats.current--; setPresenting(queuedBeats.current > 0); currentPresentation.current = null;
        if (userPaused.current) { deferredBeat.current = event; setPresenting(false); setPhase('paused'); break; }
        if (!queuedBeats.current) {
          const loaded = await bridge.loadSession(event.sessionId);
          if (generation !== presentationGeneration.current) break;
          const remaining = loaded.plan?.concepts.some(concept => loaded.learningProgress?.conceptStates[concept.id] === 'planned');
          if ((event.beat.next === 'continue' || (event.beat.next === 'finish' && remaining)) && teachingReady(statusRef.current)) {
            setPhase('thinking'); await bridge.continueLesson({ sessionId: event.sessionId, epoch: event.epoch });
          } else setPhase('ready');
        }
      }
    } catch (error) { if (generation === presentationGeneration.current) { setPhase('paused'); showFailure(error); } }
    finally { pumping.current = false; if (beatQueue.current.length && !userPaused.current && generation === presentationGeneration.current && !currentPresentation.current) void pumpRef.current(); }
  };

  const controlsRef = useRef<Values>({});
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  useEffect(() => { if (simulation.artifact) { controlsRef.current = simulation.values; } }, [simulation.values, simulation.artifact]);

  const save = useCallback((announce = false): Promise<void> => {
    const requestedSessionId = sessionRef.current?.id;
    const operation = saveQueue.current.catch(() => {}).then(async () => {
    const current = sessionRef.current; if (!current || current.id !== requestedSessionId) return;
    if (simulationRef.current.running) simulationRef.current.pause();
    if (currentPresentation.current) await flushProgress();
    if (reviewMode.current) {
      const edits = sceneRef.current;
      await simulationRef.current.settle();
      const editRevision = experimentEditRevision.current;
      const manualExperiment = editRevision !== savedExperimentRevision.current ? simulationRef.current.checkpoint() : undefined;
      const simulationGeneration = simulationRef.current.generation;
      const dynamic = manualExperiment ? [...simulationRef.current.visible()] : [];
      const authoritative = await bridge.loadSession(current.id);
      if (sessionRef.current?.id !== current.id || simulationRef.current.generation !== simulationGeneration || experimentEditRevision.current !== editRevision || sceneRef.current !== edits) return;
      const combined = [...authoritative.scene.filter(entity => entity.semanticRole !== 'learner-note' && (!manualExperiment || !entity.id.startsWith('sim:'))), ...edits.filter(entity => entity.semanticRole === 'learner-note'), ...dynamic];
      const controls = manualExperiment?.values ?? authoritative.controls, checkpoint = manualExperiment ?? authoritative.simulation;
      await bridge.saveScene({ sessionId: current.id, scene: combined, controls, simulation: checkpoint });
      if (sessionRef.current?.id === current.id) {
        setSession(value => value?.id === current.id ? { ...value, scene: combined, controls, simulation: checkpoint } : value);
        if (sceneRef.current === edits && experimentEditRevision.current === editRevision) { savedExperimentRevision.current = editRevision; setDirty(false); dirtyRef.current = false; }
      }
      if (announce) setNotice({ text: 'Lesson saved on this device.' });
      await refreshSessions();
      return;
    }
    await simulationRef.current.settle();
    const base = sceneRef.current;
    const editRevision = experimentEditRevision.current, checkpoint = simulationRef.current.checkpoint();
    const visibleIds = new Set(visibleScene.current.map((entity) => entity.id));
    const snapshot = currentPresentation.current ? base.filter((entity) => visibleIds.has(entity.id)) : base;
    const dynamic = simulationRef.current.visible();
    const combined = [...snapshot.filter((entity) => !dynamic.some((item) => item.id === entity.id)), ...dynamic];
    await bridge.saveScene({ sessionId: current.id, scene: combined, controls: checkpoint?.values ?? controlsRef.current, simulation: checkpoint });
    if (sessionRef.current?.id === current.id && sceneRef.current === base && experimentEditRevision.current === editRevision) { savedExperimentRevision.current = editRevision; setDirty(false); dirtyRef.current = false; }
    if (announce) setNotice({ text: 'Lesson saved on this device.' });
    await refreshSessions();
    });
    saveQueue.current = operation;
    return operation;
  }, [refreshSessions]);

  useEffect(() => {
    if (!dirty || !session || simulation.running) return;
    const timer = setTimeout(() => { void save().catch((error) => setNotice({ text: `Your edits could not be saved: ${errorText(error)}. Use Save to retry.`, error: true })); }, 600);
    return () => clearTimeout(timer);
  }, [dirty, scene, simulation.values, simulation.running, session?.id, save]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (dirtyRef.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', guard); return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const act = async (name: string, operation: () => Promise<void>) => {
    const preempt=busyAction.current&&['pause','pause-teaching','interrupt'].includes(name)&&['send','start','roadmap','concept'].includes(busyAction.current.name);
    if(busyAction.current&&!preempt)return;
    const action={name};busyAction.current=action;setBusy(name);
    try { await (preempt&&name!=='interrupt'?pause({keepListening:true}):operation()); } catch (error) { if(busyAction.current===action)showFailure(error); }
    finally { if(busyAction.current===action){busyAction.current=null;setBusy(null);} }
  };
  const pauseTeaching = async () => { userPaused.current = true; await playbackRef.current.pause(); simulationRef.current.pause(); setPresenting(false); setPhase('paused'); };
  const pause = async ({ keepListening = true }: { keepListening?: boolean } = {}) => {
    cancelVoiceSend();
    visualGeneration.current++;
    blockedEpoch.current = Math.max(blockedEpoch.current, epoch.current);
    beatQueue.current = [];
    await playbackRef.current.interrupt();
    preserveVisibleScene(); cancelPresentation(); voice.stopSpeaking(); if (!keepListening) await voice.stopRecording(true); simulation.pause(); setPhase('paused');
    currentPresentation.current = null;
    if (sessionRef.current) { await bridge.interrupt(sessionRef.current.id); await save(); }
  };
  const leave = async () => { await pause({ keepListening: false }); };
  const prepareNotes = async (): Promise<LessonSession> => {
    const current = sessionRef.current;
    if (!current) throw new Error('Open a studied lesson before generating notes.');
    if (busy) throw new Error('Wait for the current action to finish, then generate notes.');
    setBusy('notes-prepare');
    try {
      await pause({ keepListening: false });
      const saved = await bridge.loadSession(current.id);
      if (sessionRef.current?.id !== current.id) throw new Error('The lesson changed. Return to it before generating notes.');
      sessionRef.current = saved; setSession(saved);
      return saved;
    } finally { setBusy(value => value === 'notes-prepare' ? null : value); }
  };
  const navigate = (target: Screen) => {cancelSafetyAdmission();void act('navigate', async () => { await leave(); setScreen(target); setNotice(null); });};
  const openNewLesson = (silent=false) => {cancelSafetyAdmission();void act('navigate', async () => { await leave(); setScreen('topic'); updateTopic(''); setNotice(null); if(!silent)voice.speak('What would you like to learn today?'); });};
  const newLesson=()=>openNewLesson();
  const connect = () => void act('connect', async () => {
    const next = await bridge.signIn(); setStatus(next);
    if (next.error) setNotice({ text: next.error, error: true });
    else if (next.connected) { setNotice({ text: 'ChatGPT connected. Your next lesson is ready to begin.' }); setModels(await bridge.getModels()); setStatus(await bridge.getStatus()); }
  });
  const prepareRoadmap = async (sessionId: string) => {
    const generation = presentationGeneration.current;
    setPhase('thinking'); setNotice(null);
    const current = () => sessionRef.current?.id === sessionId && generation === presentationGeneration.current;
    try {
      const plan = await bridge.planTopic({ sessionId });
      if (!current()) return;
      const planned = await bridge.loadSession(sessionId);
      if (!current()) return;
      sessionRef.current = { ...planned, plan }; setSession(sessionRef.current); setPhase('ready');
      await refreshSessions();
    } catch (error) {
      if (!current()) return;
      setPhase('paused');
      throw error;
    }
  };
  const retryRoadmap = () => {
    const current = sessionRef.current;
    if (!current || current.plan || busy) return;
    if (!canTeach) { setSettings(true); return; }
    void act('roadmap', () => prepareRoadmap(current.id));
  };
  const startLesson = (event: FormEvent) => {
    event.preventDefault();
    if (!topic.trim()) { topicInput.current?.focus(); setNotice({ text: 'Tell your teacher what you would like to learn.', error: true }); return; }
    if (!canTeach) { setSettings(true); setNotice({ text: 'Choose a teaching connection and available model in Settings. Your topic will stay here.', error: true }); return; }
    void act('start', async () => {
      voice.stopSpeaking(); voice.resetInput?.(); voiceOwnsDraft.current = false; speechBase.current = ''; simulation.clear(); setLastModelRun(null);
      changedExperiment.current = false; reviewMode.current = false; experimentEditRevision.current = 0; savedExperimentRevision.current = 0;
      const request={requestId:crypto.randomUUID(),topic:topicRef.current.trim(),connection:connectionIdentity()};safetyAdmission.current=request;
      const current=()=>safetyAdmission.current===request&&screenRef.current==='topic'&&topicRef.current.trim()===request.topic&&connectionIdentity()===request.connection&&!closing.current;
      let created:LessonSession;
      try {created=await bridge.createSession(request.topic,request.requestId);}
      catch(error){if(!current())return;safetyAdmission.current=null;throw error;}
      if(!current())return;
      safetyAdmission.current=null;
      sessionRef.current = created; setSession(created); setScene(created.scene); setSelected([]); controlsRef.current = created.controls;
      epoch.current = -1; blockedEpoch.current = -1; userPaused.current = false; acceptedBeats.current.clear(); setScreen('lesson'); setPhase('thinking'); setQuestion(''); setNotice(null); setDirty(false);
      await prepareRoadmap(created.id);
    });
  };
  const restoreLoadedExperiment = async (loaded: LessonSession) => {
    const last = loaded.simulation?.artifact;
    if (!last) return;
    const restorable = loaded.simulation?.initialValues && loaded.simulation.inputs ? loaded.simulation : undefined;
    await simulationRef.current.start(last, loaded.controls, restorable);
    if (loaded.simulation && !restorable) setNotice({ text: 'This experiment restarted with its saved controls. An earlier save did not include its playback history.' });
  };
  const load = (id: string) => void act('load', async () => {
    await leave(); const loaded = await bridge.loadSession(id); simulation.clear();
    changedExperiment.current = false; reviewMode.current = false; experimentEditRevision.current = 0; savedExperimentRevision.current = 0;
    sessionRef.current = loaded; setSession(loaded); setVisualFrame(undefined); setScene(loaded.scene.filter((entity) => !entity.id.startsWith('sim:'))); controlsRef.current = loaded.controls; setSelected([]); setDirty(false);
    epoch.current = -1; blockedEpoch.current = -1; acceptedBeats.current = new Set(loaded.beats.map((beat) => beat.id)); setPhase('ready'); setScreen('lesson'); setNotice(null); setQuestion('');
    setLastModelRun(loaded.modelRuns?.at(-1) ?? null);
    await restoreLoadedExperiment(loaded);
  });
  const send = (text: string) => {
    if (!text.trim() || !session || busy) return;
    if (!canTeach) { setSettings(true); setNotice({ text: 'Choose a teaching connection and available model in Settings to continue your lesson.', error: true }); return; }
    cancelVoiceSend(); voice.resetInput?.(); voiceOwnsDraft.current = false; speechBase.current = '';
    lastQuestion.current={sessionId:session.id,text};
    void act('send', async () => {
      if (active || currentPresentation.current || simulation.running) await pause();
      if (dirtyRef.current) await save();
      const id = crypto.randomUUID();
      setSession((current) => current && ({ ...current, messages: [...current.messages, { id, role: 'student', text, createdAt: new Date().toISOString() }] }));
      userPaused.current=true;setNotice(null);
      const generation = presentationGeneration.current;
      try {
        await bridge.sendMessage({ sessionId: session.id, text, selectionIds: selected });
        if(sessionRef.current?.id!==session.id||generation!==presentationGeneration.current)return;
        userPaused.current=false;setQuestion(current=>current.trim()===text.trim()?'':current);setPhase('thinking');if(beatQueue.current.length)void pumpRef.current();
      }catch(error){
        if (sessionRef.current?.id !== session.id || generation !== presentationGeneration.current) return;
        setQuestion(current=>current||text); setPhase('paused'); showFailure(error);
        setSession((current) => current && ({ ...current, messages: current.messages.filter((message) => message.id !== id) }));
      }
    });
  };
  const animateCurrentConcept = () => {
    const concept=session?.plan?.concepts.find(item=>item.id===session.learningProgress?.activeConceptId);
    send(`Animate the current concept${concept?`, ${concept.title}`:''}. Show meaningful movement in the diagram so I can see what changes, keeping labels and reference objects stable. Use a safe adjustable simulation when it helps explain the idea, and state any simplifying assumptions. Stay with what we are studying.`);
  };
  sendQuestionRef.current = send;
  voiceActions.current = {
    onSpeechStart: () => {
      cancelVoiceSend(); if (!voiceOwnsDraft.current) speechBase.current = screenRef.current === 'topic' ? topicRef.current : questionRef.current;
      voiceOwnsDraft.current = true;
      if (active && screenRef.current === 'lesson') speechInterruption.current = pause({ keepListening: true }).catch((error) => setNotice({ text: errorText(error), error: true }));
    },
    onDraft: (text) => {
      const combined = `${speechBase.current} ${text}`.trim();
      if (screenRef.current === 'topic') updateTopic(combined); else if (screenRef.current === 'lesson') setQuestion(combined);
    },
    onFinal: (text) => {
      const combined = `${speechBase.current} ${text}`.trim();
      voiceOwnsDraft.current = false;
      if (screenRef.current === 'topic') { updateTopic(combined); return; }
      if (screenRef.current !== 'lesson' || !sessionRef.current) return;
      cancelVoiceSend(); setQuestion(combined); setPendingVoice(combined);
      const generation = automaticSendGeneration.current, sessionId = sessionRef.current.id;
      automaticSend.current = setTimeout(() => {
        void speechInterruption.current.then(() => {
          if (generation !== automaticSendGeneration.current || sessionRef.current?.id !== sessionId || screenRef.current !== 'lesson') return;
          setPendingVoice(null); automaticSend.current = null; sendQuestionRef.current(combined);
        });
      }, 650);
    },
  };
  useEffect(() => () => { if (automaticSend.current) clearTimeout(automaticSend.current); }, []);
  const interruptForEdit = () => { if (active) void pause().catch(error => setNotice({ text: errorText(error), error: true })); };
  const updateScene = (next: SceneEntity[]) => {
    const dynamicIds = new Set(simulationRef.current.visible().map((entity) => entity.id));
    next = next.filter((entity) => !dynamicIds.has(entity.id));
    if (active) {
      const visibleIds = new Set(visibleScene.current.map((entity) => entity.id));
      const oldIds = new Set(sceneRef.current.map((entity) => entity.id));
      next = next.filter((entity) => visibleIds.has(entity.id) || !oldIds.has(entity.id));
    }
    interruptForEdit(); setScene(next); setDirty(true);
  };
  const markExperimentEdited = () => { changedExperiment.current = true; experimentEditRevision.current++; setDirty(true); dirtyRef.current = true; };
  const changeControl = (id: string, value: number | boolean | string) => { void act('control', async () => { await pauseTeaching(); if (await simulation.changeAsync(id, value)) markExperimentEdited(); }); };
  const resetExperiment = () => void act('reset-experiment', async () => { await pauseTeaching(); simulationRef.current.setTimelineControlled(false); if (await simulationRef.current.resetAsync()) markExperimentEdited(); });
  const playExperiment = () => void act('experiment-play', async () => {
    const wasRunning = simulationRef.current.running;
    await pauseTeaching();
    if (!wasRunning) { simulationRef.current.setTimelineControlled(false); simulationRef.current.toggle(); }
    markExperimentEdited();
  });
  const exploreGraph = async () => {
    const sessionId = sessionRef.current?.id;
    const generation = simulationRef.current.generation;
    await pauseTeaching(); await simulationRef.current.settle();
    if (sessionRef.current?.id !== sessionId || simulationRef.current.generation !== generation) throw new Error('The lesson changed. Open its graph again.');
  };
  const changeGraph = (values: Record<string, number>) => {
    const sessionId = sessionRef.current?.id;
    const generation = simulationRef.current.generation;
    void act('graph-input', async () => {
      await pauseTeaching();
      if (sessionRef.current?.id !== sessionId || simulationRef.current.generation !== generation) return;
      const applied = await simulationRef.current.changeManyAsync(values);
      if (!applied) throw new Error('This point could not move. Use the bounded controls below or reset the experiment.');
      markExperimentEdited();
    });
  };
  const startConcept = (conceptId: string) => void act('concept', async () => { if (!sessionRef.current) return; if (active || currentPresentation.current || dirtyRef.current) await pause(); userPaused.current = false; setPhase('thinking'); const sessionId = sessionRef.current.id; const generation = presentationGeneration.current; void bridge.startConcept({ sessionId, conceptId }).catch(error => { if (sessionRef.current?.id === sessionId && generation === presentationGeneration.current) { setPhase('paused'); showFailure(error); } }); const loaded = await bridge.loadSession(sessionRef.current.id); setSession(value => value && ({ ...value, learningProgress: loaded.learningProgress })); });
  const resumeTeaching = (mode: 'resume' | 'replay' | 'return' = 'resume') => {
    if (changedExperiment.current && mode === 'resume') {
      changedExperiment.current = false;
      sendQuestionRef.current(`I changed the experiment controls to ${JSON.stringify(controlsRef.current)}. Give a short explanation of what changes using these current values.`);
      return;
    }
    void act(mode, async () => {
      const current = sessionRef.current; if (!current) return;
      userPaused.current = false;
      const finishResumed = async (result: string) => {
        setPresenting(false); setPhase(result === 'completed' && !userPaused.current ? 'ready' : 'paused');
        if (result !== 'completed' || reviewMode.current) return;
        const completed = currentPresentation.current, beat = playbackBeat.current;
        currentPresentation.current = null; queuedBeats.current = Math.max(0, queuedBeats.current - 1);
        if (userPaused.current) { if (completed && beat) deferredBeat.current = { sessionId: current.id, epoch: completed.epoch, beat }; return; }
        if (beatQueue.current.length) { void pumpRef.current(); return; }
        const loaded = await bridge.loadSession(current.id);
        const remaining = loaded.plan?.concepts.some(concept => loaded.learningProgress?.conceptStates[concept.id] === 'planned');
        if (completed && beat && teachingReady(statusRef.current) && (beat.next === 'continue' || (beat.next === 'finish' && remaining))) {
          setPhase('thinking'); await bridge.continueLesson({ sessionId: current.id, epoch: completed.epoch });
        }
      };
      const runResumed = (operation: ReturnType<typeof playback.resume>) => {
        const generation = presentationGeneration.current;
        void operation.then(result => { if (generation === presentationGeneration.current) return finishResumed(result); }).catch(error => { if (generation === presentationGeneration.current) { setPresenting(false); setPhase('paused'); showFailure(error); } });
      };
      if (mode === 'resume' && currentPresentation.current && !reviewMode.current) {
        setPresenting(true); setPhase('speaking'); runResumed(playbackRef.current.resume()); return;
      }
      if (mode === 'resume' && deferredBeat.current) {
        const deferred = deferredBeat.current; deferredBeat.current = undefined;
        if (beatQueue.current.length) { void pumpRef.current(); return; }
        const loaded = await bridge.loadSession(current.id);
        const remaining = loaded.plan?.concepts.some(concept => loaded.learningProgress?.conceptStates[concept.id] === 'planned');
        if (teachingReady(statusRef.current) && (deferred.beat.next === 'continue' || (deferred.beat.next === 'finish' && remaining))) {
          setPhase('thinking'); void bridge.continueLesson({ sessionId: current.id, epoch: deferred.epoch }).catch(error => { setPhase('paused'); showFailure(error); });
        } else setPhase('ready');
        return;
      }
      if (mode === 'resume' && beatQueue.current.length) { void pumpRef.current(); return; }
      reviewMode.current = true;
      await playbackRef.current.interrupt(); cancelPresentation();
      const restoreMode = mode === 'replay' ? 'replay' : 'resume';
      const generation = presentationGeneration.current;
      const restored = mode === 'return' ? await bridge.returnToLesson({ sessionId: current.id }) : await bridge.resumePlayback({ sessionId: current.id, mode: restoreMode });
      if (generation !== presentationGeneration.current || sessionRef.current?.id !== current.id) return;
      epoch.current = restored.epoch; blockedEpoch.current = restored.epoch - 1;
      if (mode === 'return') {
        const returned = await bridge.loadSession(current.id);
        if (generation !== presentationGeneration.current || sessionRef.current?.id !== current.id) return;
        setSession(value => value && ({ ...value, scene: returned.scene, learningProgress: returned.learningProgress, playback: returned.playback }));
      }
      reviewMode.current = restored.mode === 'replay'; playbackBeat.current = restored.beat; restorationCheckpoint.current = restored.checkpoint; resumeCheckpoint.current = restored.mode === 'resume' ? restored.checkpoint : undefined;
      playbackBaseline.current = restored.checkpoint?.baselineScene ?? applyBeat(current.scene.filter(entity => entity.semanticRole !== 'learner-note'), restored.beat);
      currentPresentation.current = { sessionId: current.id, epoch: restored.epoch, beatId: restored.beat.id, narration: restored.checkpoint ? adaptTeachingBeat(restored.beat).chunks.filter(chunk => restored.checkpoint!.completedChunkIds.includes(chunk.id)).map(chunk => chunk.text).join('') : '', generation: presentationGeneration.current };
      await playbackRef.current.prepare(restored.beat, { baselineScene: playbackBaseline.current, checkpoint: restored.mode === 'resume' ? restored.checkpoint : undefined, mode: restored.mode, planId: current.plan?.id, planVersion: current.plan?.version });
      setPresenting(true); setPhase('speaking'); runResumed(playbackRef.current.play());
    });
  };
  const importMaterial = () => void act('import', async () => { const jobId = `import:${crypto.randomUUID()}`; importJob.current = jobId; setImporting(true); setImportProgress(''); try { const imported = await bridge.importStudyMaterial({ jobId }); if (importJob.current === jobId) { setDocuments(imported); setCourse(null); } } finally { setImporting(false); } });
  const planCourse = () => void act('course-plan', async () => { const planned = await bridge.planCourse({ documentIds: documents.filter(document => document.coverage > 0 && ['ready', 'partial'].includes(document.status)).map(document => document.id) }); setCourse(planned); setCourses(await bridge.getCourses()); });
  const startCourseLesson = (lessonId: string) => void act('course-lesson', async () => { if (!course) return; await leave(); const loaded = await bridge.startCourseLesson({ courseId: course.id, lessonId }); simulation.clear(); changedExperiment.current = false; reviewMode.current = false; experimentEditRevision.current = 0; savedExperimentRevision.current = 0; controlsRef.current = loaded.controls; sessionRef.current = loaded; setSession(loaded); setScene(loaded.scene.filter(entity => !entity.id.startsWith('sim:'))); setVisualFrame(undefined); setScreen('lesson'); setPhase('ready'); setSelected([]); epoch.current = -1; blockedEpoch.current = -1; acceptedBeats.current = new Set(loaded.beats.map(beat => beat.id)); await restoreLoadedExperiment(loaded); });
  const openSettings = () => {cancelSafetyAdmission(); setSettings(true); void bridge.getModels().then(async (catalog) => { setModels(catalog); setStatus(await bridge.getStatus()); }).catch((error) => setNotice({ text: errorText(error), error: true })); };
  const deleteLesson = () => deleteTarget && void act('delete', async () => {
    await bridge.deleteSession(deleteTarget.id);
    if (session?.id === deleteTarget.id) { voice.stopSpeaking(); simulation.clear(); setSession(null); sessionRef.current = null; setScene([]); setDirty(false); setScreen('history'); }
    setDeleteTarget(null); await refreshSessions(); setNotice({ text: 'Lesson deleted from this device.' });
  });

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <button type="button" className="brand" onClick={() => navigate('home')} aria-label="Canvas Atlas home"><span className="brand-symbol"><OrbitMark small /></span><span>canvas<span className="brand-second">atlas<span className="brand-period">.</span></span></span></button>
      <button type="button" className="button new-lesson" onClick={newLesson} disabled={Boolean(busy)}><Plus size={17} /> New lesson</button>
      <nav className="main-nav"><button type="button" aria-label="My space" className={screen === 'home' || screen === 'topic' ? 'nav-item current' : 'nav-item'} onClick={() => navigate('home')}><Home size={17} /><span>My space</span></button><button type="button" aria-label="My lessons" className={screen === 'history' ? 'nav-item current' : 'nav-item'} onClick={() => navigate('history')}><Clock3 size={17} /><span>My lessons</span>{sessions.length > 0 && <span className="nav-count">{sessions.length}</span>}</button></nav>
      <div className="sidebar-recents"><p className="eyebrow">RECENT LESSONS</p>{loading ? <p className="subtle small-copy">Loading your lessons…</p> : sessions.length ? sessions.slice(0, 8).map((item) => <button type="button" className={`recent-link ${session?.id === item.id && screen === 'lesson' ? 'active' : ''}`} key={item.id} onClick={() => load(item.id)} disabled={Boolean(busy)}><span className="recent-dot" /><span>{item.title}</span></button>) : <p className="sidebar-empty">Your questions will find<br />a home here.</p>}</div>
      <div className="sidebar-bottom"><div className="device-note"><span className="device-dot" /> Lessons stay on this device</div><button type="button" className="account-button" onClick={openSettings}><span className="account-avatar">{status.connected ? (status.account?.name ?? status.account?.email ?? 'Y').slice(0, 1).toUpperCase() : <Settings2 size={18} />}</span><span><strong>{status.connected ? status.account?.name ?? 'Your account' : 'Make yourself at home'}</strong><small>Account & settings</small></span><ChevronRight size={15} /></button></div>
    </aside>

    <main className={`main-content screen-${screen}`}>
      <header className="topbar"><span className="breadcrumb">My space{screen !== 'home' && <><ChevronRight size={13} /><span>{screen === 'lesson' ? 'Lesson' : screen === 'history' ? 'My lessons' : 'New lesson'}</span></>}</span><div className="topbar-right">{!status.desktop && <span className="preview-label">Browser preview</span>}<span className={`connection-pill ${teachingConnected ? 'connected' : ''}`}><span />{!teachingConnected && 'Not connected'}</span><button type="button" className="icon-button" aria-label="Open settings" title="Settings" onClick={openSettings}><Settings2 size={18} /></button></div></header>
      {!status.desktop && <div className="preview-banner">Preview this workspace in your browser. Teaching, account connection, and local voice are available in the Windows desktop app.</div>}
      {notice && <div className={`notice ${notice.safety ? 'safety-notice' : notice.error ? 'error' : ''}`} role={notice.safety ? 'status' : notice.error ? 'alert' : 'status'} aria-label={notice.safety ? 'Learning guidance' : undefined}><span>{notice.error || notice.safety ? <CircleHelp size={17} /> : <Check size={17} />}</span><p>{notice.text}</p>{notice.safety && <div className="safety-recovery-actions"><button type="button" className="text-button" onClick={() => { setNotice(null); (screenRef.current === 'topic' ? topicInput.current : questionInput.current)?.focus(); }}>Edit question</button><button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>openNewLesson(true)}>New topic</button>{notice.safeAlternative&&<button type="button" className="text-button" disabled={Boolean(busy)} onClick={()=>{const alternative=notice.safeAlternative!;cancelVoiceSend();if(screenRef.current==='topic')updateTopic(alternative);else setQuestion(alternative);setNotice({text:'Review this question, then submit it when you are ready.'});(screenRef.current==='topic'?topicInput.current:questionInput.current)?.focus();}}>Edit safe alternative</button>}</div>}<button type="button" aria-label="Dismiss notification" title="Dismiss" onClick={() => setNotice(null)}><X size={15} /></button></div>}

      {screen === 'home' && <div className="home-content page-enter"><div className="home-intro"><span className="section-kicker"><span /> A LITTLE CURIOSITY GOES A LONG WAY</span><h1>Make room for<br />a new <span className="idea-word">idea<svg viewBox="0 0 150 18" aria-hidden="true"><path d="M3 12c34-10 93-11 144-5M7 16c45-9 95-9 135-6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg></span>.</h1><p>Your own teacher. A canvas to think on.<br />Follow your curiosity, one conversation at a time.</p><button type="button" className="button primary start-button" onClick={newLesson} disabled={Boolean(busy)}>Start learning <ArrowRight size={18} /></button><div className="start-caption">Bring a question. We’ll start there.</div></div><div className="home-drawing" aria-hidden="true"><div className="drawing-label">a space for the <span>aha.</span></div><svg viewBox="0 0 400 310" fill="none"><path d="M69 177c-27-48 10-98 100-101 73-3 156 42 147 84-7 39-85 69-155 55-43-9-77-21-92-38Z" stroke="#18243B" strokeWidth="1.7"/><path d="M67 177C39 127 81 82 167 79c73-1 155 39 146 80" stroke="#18243B" strokeWidth=".7"/><path d="M160 43c29-28 81 3 91 78 12 79-18 143-58 124-39-20-64-119-48-174" stroke="#7775E7" strokeWidth="1.9"/><path d="M159 46c32-26 81 6 90 77 11 74-17 140-55 120" stroke="#7775E7" strokeWidth=".8"/><circle cx="310" cy="155" r="24" fill="#C3E9D7" stroke="#18243B" strokeWidth="1.6"/><circle cx="158" cy="79" r="8" fill="#7775E7"/><path d="m192 135 5 13 14 1-11 9 3 14-12-7-11 8 2-14-11-9 14-2 7-13Z" fill="#18243B"/><path d="m98 242 19-10M115 255l5-17M84 228l22-2" stroke="#7775E7" strokeWidth="2" strokeLinecap="round"/><path d="M300 83c12-22 30-20 43-12" stroke="#18243B" strokeWidth="1.5" strokeLinecap="round"/><path d="m336 62 8 9-11 3" stroke="#18243B" strokeWidth="1.5" strokeLinecap="round"/></svg><div className="drawing-footnote">Ask. Explore. See it differently.</div></div><section className="home-lower"><div className="section-heading"><div><span className="eyebrow">YOUR LEARNING SPACE</span><h2>{sessions.length ? 'Pick up a thread.' : 'Every lesson starts with you.'}</h2></div>{sessions.length > 0 && <button type="button" className="text-button" onClick={() => navigate('history')}>All lessons <ArrowRight size={15} /></button>}</div>{sessions.length ? <div className="lesson-cards">{sessions.slice(0, 3).map((item) => <button type="button" className="lesson-card" key={item.id} onClick={() => load(item.id)} disabled={Boolean(busy)}><span className="lesson-card-symbol"><MessageCircle size={19} /></span><span><strong>{item.title}</strong><small>{dateLabel(item.updatedAt)} · {item.messageCount} messages</small></span><ArrowRight size={17} /></button>)}</div> : <div className="learning-notes"><div><span className="note-icon"><MessageCircle size={22} /></span><h3>A conversation, at your pace</h3><p>Ask freely. Interrupt. Take a different path.<br />There’s always another way to explain it.</p></div><div><span className="note-icon lavender"><Sparkles size={22} /></span><h3>See the idea come alive</h3><p>Drawings, connections, and experiments<br />make room for understanding.</p></div></div>}</section><footer className="home-footer"><span className="tiny-star">✳</span> No syllabus. No rush. Just your next question.</footer></div>}

      {screen === 'topic' && <div className="topic-content page-enter"><button type="button" className="text-button back-link" onClick={() => navigate('home')}><ArrowLeft size={15} /> Back to my space</button><OrbitMark /><span className="section-kicker">LET’S FOLLOW YOUR CURIOSITY</span><h1>What would you like<br />to learn today?</h1><p>A big question, a small mystery, or something you’ve always wanted to understand.</p><form noValidate className="topic-form" onSubmit={startLesson}><label className="sr-only" htmlFor="lesson-topic">What would you like to learn today?</label><textarea className="resize-none" ref={topicInput} id="lesson-topic" placeholder="I’ve been wondering about…" value={topic} maxLength={LIMITS.learnerRequestChars} onChange={(event) => { voice.resetInput?.(); voiceOwnsDraft.current = false; updateTopic(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className="topic-form-footer"><button type="button" className={`voice-input-button ${voice.recording ? 'recording' : ''}`} disabled={!voice.status.recognitionReady} onClick={() => voice.recording || voice.starting ? void voice.stopRecording() : void voice.startRecording()} aria-label={voice.recording ? 'Turn topic voice input off' : 'Speak your topic'} title={!voice.status.recognitionReady ? 'Set up local voice in Settings' : 'Speak your topic'}>{voice.recording ? <Square size={17} /> : <Mic size={17} />}<span>{voice.recording ? 'Voice on · speak naturally' : 'Speak your topic'}</span></button><button type={canTeach ? 'submit' : 'button'} className="button primary" disabled={Boolean(busy) || !topic.trim()} onClick={canTeach ? undefined : openSettings}>{busy === 'start' || busy === 'connect' ? <LoaderCircle className="spin" size={17} /> : canTeach ? <ArrowRight size={17} /> : <Plus size={17} />}{canTeach ? 'Create roadmap' : teachingConnected ? 'Check teaching model' : 'Choose teaching connection'}</button></div></form><p className="topic-hint">Check the words above. You can correct your topic before beginning.</p>{!canTeach && <div className="connection-hint"><span className="tiny-dot" />{status.desktop ? 'Choose ChatGPT, Gemini, or Groq in Settings to begin teaching.' : 'Open the desktop app to connect your account and begin a lesson.'}</div>}<MaterialImport documents={documents} course={course} importing={importing} progress={importProgress} busy={Boolean(busy)} onImport={status.desktop ? importMaterial : openSettings} onCancel={() => { if (importJob.current) void bridge.cancelDocumentImport(importJob.current); }} onPlan={canTeach ? planCourse : openSettings} onStart={startCourseLesson} />{courses.length > 0 && <section className="saved-courses"><h2>Saved courses</h2>{courses.map(item => <button type="button" className="button secondary" key={item.id} disabled={Boolean(busy)} onClick={() => void act('course-load', async () => { setCourse(await bridge.loadCourse(item.id)); setDocuments(await bridge.getDocuments()); })}>{item.title}</button>)}</section>}</div>}

      {screen === 'history' && <div className="history-content page-enter"><div className="section-heading"><div><span className="section-kicker">YOUR QUESTIONS, KEPT CLOSE</span><h1>My lessons<span className="accent-period">.</span></h1><p className="subtle">Return to an idea whenever you like.</p></div><button type="button" className="button primary" onClick={newLesson}><Plus size={17} /> New lesson</button></div>{loading ? <div className="empty-state"><LoaderCircle className="spin" /> Loading lessons…</div> : !sessions.length ? <div className="empty-state"><OrbitMark /><h2>Your first question is waiting.</h2><p>Start a lesson and it will be saved here on this device.</p><button type="button" className="button secondary" onClick={newLesson}>Start learning <ArrowRight size={16} /></button></div> : <div className="history-list">{sessions.map((item) => <article className="history-row" key={item.id}><button type="button" className="history-open" onClick={() => load(item.id)} disabled={Boolean(busy)}><span className="lesson-card-symbol"><MessageCircle size={20} /></span><span><strong>{item.title}</strong><small>{dateLabel(item.updatedAt)} · {item.messageCount} messages</small></span><ArrowRight size={18} /></button><button type="button" className="icon-button danger-text" aria-label={`Delete ${item.title}`} title="Delete lesson" onClick={() => setDeleteTarget(item)}><Trash2 size={16} /></button></article>)}</div>}</div>}

      {screen === 'lesson' && session && <div className="lesson-workspace page-enter"><div className={`lesson-body ${session.beats.length ? 'has-presentation' : ''}`}><div className="lesson-header"><div><span className="eyebrow">A CONVERSATION IN PROGRESS</span><h1>{session.title}</h1>{lastModelRun && <span className="model-run-caption">Requested {lastModelRun.requestedModel} · {lastModelRun.servedModel ? `Served ${lastModelRun.servedModel}` : 'Served model not reported'}</span>}</div><div className="lesson-actions"><button type="button" className="button secondary compact" disabled={Boolean(busy)} onClick={() => void act('save', () => save(true))}><Save size={15} /><span>{dirty ? 'Save edits' : 'Save'}</span></button><button type="button" className="icon-button" title="Export lesson" aria-label="Export lesson" disabled={Boolean(busy) || !status.desktop} onClick={() => void act('export', async () => { await save(); const result = await bridge.exportLesson(session.id); if (!result.canceled) setNotice({ text: 'Lesson exported.' }); })}><ArrowDownToLine size={18} /></button><button type="button" className={`icon-button ${transcriptOpen ? 'pressed' : ''}`} title="Toggle conversation" aria-label="Toggle conversation" aria-pressed={transcriptOpen} onClick={() => setTranscriptOpen(!transcriptOpen)}><MessageCircle size={18} /></button></div></div>{!session.plan && <section className="concept-context" aria-label="Roadmap preparation" aria-busy={phase === 'thinking'}><div><span className="eyebrow">LEARNING ROADMAP</span><strong>{phase === 'thinking' ? 'Preparing your learning roadmap…' : 'Your topic is saved. Create its roadmap to begin teaching.'}</strong></div><button type="button" className="button secondary compact" disabled={Boolean(busy) || phase === 'thinking' || !canTeach} onClick={retryRoadmap}>{phase === 'thinking' ? 'Preparing roadmap…' : phase === 'paused' ? 'Retry roadmap' : 'Create roadmap'}</button></section>}<LearningWorkspace activeConceptId={currentPresentation.current ? playbackBeat.current?.conceptId : undefined} session={session} busy={Boolean(busy) || !canTeach} onStart={startConcept} onSource={setSource} onReturn={() => resumeTeaching('return')} /><div className={`lesson-layout ${!transcriptOpen && !pendingCheck ? 'canvas-wide' : ''}`}><div className="canvas-column"><MathExplorer key={`${session.id}:${simulation.generation}`} frame={mathFrame} interactive={visualInteractionEnabled} disabled={Boolean(busy) || simulation.busy} beforeExplore={exploreGraph} onChange={changeGraph} onFailure={showFailure}><VisualStage key={session.id} interactionEnabled={visualInteractionEnabled && !busy} viewKey={visualFrame?.fitKey} frame={{ ...(visualFrame ?? evaluateVisualFrame({ id: 'saved', narration: 'Saved scene', next: 'finish', canvas: { mode: 'replace', entities: scene } }, { beatId: 'saved', chunkId: 'saved:chunk:1', offsetSeconds: 0, passId: 'saved' }, scene)), entities: [...scene.filter((entity) => !simulation.entities.some((dynamic) => dynamic.id === entity.id)), ...simulation.entities] }} onReady={mode => { if (mode === 'fallback' && visualFailureNotice.current) { const recovered = visualFailureNotice.current; visualFailureNotice.current = undefined; setNotice(current => current?.text === recovered ? null : current); } const waiting = visualReady.current; if (waiting) { clearTimeout(waiting.timer); visualReady.current = undefined; waiting.resolve(); } }} onFailure={() => { const message = 'The 3D view is unavailable. Showing the diagram instead.'; visualFailureNotice.current = message; setNotice({ text: message, error: true }); }} lockedIds={simulation.entities.map((entity) => entity.id)} paused={phase === 'paused'} onVisible={captureVisible} onChange={updateScene} selected={selected} onSelect={setSelected} simulation={simulation.running} /></MathExplorer>{simulation.artifact && <section className="experiment-panel" aria-label="Experiment controls"><div className="experiment-heading"><div><span className="tiny-dot" /><strong>{simulation.artifact.title}</strong></div><div><button type="button" className="icon-button" aria-label={simulation.running ? 'Pause experiment' : 'Play experiment'} title={simulation.running ? 'Pause experiment' : 'Play experiment'} disabled={simulation.busy} onClick={playExperiment}>{simulation.busy ? <LoaderCircle className="spin" size={16} /> : simulation.running ? <Pause size={16} /> : <Play size={16} />}</button><button type="button" className="icon-button" title="Reset experiment" aria-label="Reset experiment" disabled={simulation.busy} onClick={resetExperiment}><RotateCcw size={15} /></button></div></div><div className="experiment-controls">{simulation.artifact.controls.map((control) => <label className="experiment-control" key={control.id} htmlFor={`experiment-control-${control.id}`}><span>{control.label}{control.type !== 'toggle' && <output>{String(simulation.values[control.id] ?? control.value)}{control.unit ? ` ${control.unit}` : ''}</output>}</span>{control.type === 'select' ? <select id={`experiment-control-${control.id}`} aria-label={control.label} value={String(simulation.values[control.id] ?? control.value)} onChange={(event) => changeControl(control.id, event.target.value)}>{control.options?.map((option) => <option key={option}>{option}</option>)}</select> : control.type === 'toggle' ? <input id={`experiment-control-${control.id}`} aria-label={control.label} type="checkbox" checked={Boolean(simulation.values[control.id] ?? control.value)} onChange={(event) => changeControl(control.id, event.target.checked)} /> : <input id={`experiment-control-${control.id}`} aria-label={control.label} type={control.type === 'slider' ? 'range' : 'number'} min={control.min} max={control.max} step={control.step ?? .1} value={Number(simulation.values[control.id] ?? control.value)} onChange={(event) => changeControl(control.id, Number(event.target.value))} />}</label>)}</div>{Object.keys(simulation.measurements).length > 0 && <div className="measurements">{Object.entries(simulation.measurements).map(([key, value]) => <span key={key}>{measurementLabel(key)} <strong>{typeof value === 'number' ? Number(value.toPrecision(5)).toLocaleString('en') : value}</strong></span>)}</div>}{simulation.artifact.assumptions.length > 0 && <details className="assumptions"><summary>About this experiment · {simulation.artifact.validation === 'quantitative_checked' ? 'checked calculations' : 'illustrative model'}</summary><ul>{simulation.artifact.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul></details>}</section>}</div>{(transcriptOpen || pendingCheck) && <div className="learning-rail">{pendingCheck && <UnderstandingCheck session={session} busy={Boolean(busy) || !canTeach} onAnswer={send} />}{transcriptOpen && <aside className="conversation-panel" aria-label="Lesson conversation"><div className="conversation-heading"><span className="teacher-avatar"><Sparkles size={16} /></span><div><strong>Your teacher</strong><span>{voice.playing ? 'Speaking' : voice.speaking ? 'Preparing voice…' : phase === 'thinking' ? 'Thinking it through…' : phase === 'drawing' ? 'Making it visible…' : phase === 'paused' ? 'Paused — take your time' : 'Here with you'}</span></div><button type="button" className="icon-button" title={voice.enabled ? 'Mute teacher voice' : 'Enable teacher voice'} aria-label={voice.enabled ? 'Mute teacher voice' : 'Enable teacher voice'} aria-pressed={voice.enabled} onClick={voice.toggle}>{voice.enabled ? <Volume2 size={17} /> : <VolumeX size={17} />}</button></div><div className="transcript" aria-live="polite" aria-relevant="additions">{session.messages.map((message) => <div className={`message ${message.role}`} key={message.id}><span className="message-label">{message.role === 'student' ? 'YOU' : 'YOUR TEACHER'}</span><p>{message.text}</p></div>)}{(voice.voiceActive || (voice.recording && voice.transcribing && voice.draft)) && <div className="message student live-draft"><span className="message-label">YOU · LIVE DRAFT</span><p>{voice.draft || 'Listening…'}</p><small>Local recognition updates as it finishes.</small></div>}{phase === 'thinking' && <div className="thinking-indicator" role="status"><span /><span /><span /><small>Finding a way in…</small></div>}<div ref={transcriptBottom} /></div><div className="teaching-adjustments"><span>TRY A DIFFERENT ANGLE</span><div><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('I don’t understand yet. Please explain more simply using a different approach.')}>More simply</button><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('Please show me another example.')}>Another example</button><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('I’d like to go deeper into this.')}>Go deeper</button></div></div></aside>}</div>}</div></div><div className="lesson-bottom"><div className="lesson-playback-row"><PlaybackControls status={phase === 'paused' && playback.status === 'completed' ? 'paused' : playback.status} resumable={session.beats.length > 0} enabled={voice.enabled} onPause={() => void act('pause-teaching', pauseTeaching)} onResume={() => resumeTeaching()} onReplay={() => resumeTeaching('replay')} onToggleVoice={voice.toggle} /><LessonNotes key={session.id} session={session} desktop={status.desktop} canGenerate={canTeach} connectionKey={`${status.teachingProvider ?? 'chatgpt'}:${status.model ?? ''}:${status.teachingRevision ?? 0}:${teachingConnected}`} disabled={Boolean(busy)} beforeGenerate={prepareNotes} onSafetyBlocked={showFailure} /></div><div className="teaching-adjustments persistent-adjustments"><span>TRY A DIFFERENT ANGLE</span><div><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('I don’t understand yet. Please explain more simply using a different approach.')}>More simply</button><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('Please show me another example.')}>Another example</button><button type="button" disabled={!canTeach || Boolean(busy)} onClick={() => send('I’d like to go deeper into this.')}>Go deeper</button><button type="button" disabled={!canTeach || Boolean(busy)} onClick={animateCurrentConcept}>Animate this</button></div></div><div className="voice-bar"><div className={`voice-status ${voice.recording ? 'listening' : ''}`}><AudioLines size={20} /><span>{voice.starting ? 'Opening microphone…' : voice.echoSuspended ? 'Teacher speaking · mic waits for you' : voice.voiceActive ? 'Listening · speak naturally…' : voice.transcribing ? 'Local recognition is catching up…' : voice.recording ? 'Voice on · pause briefly to send' : voice.playing ? 'Your teacher is speaking' : voice.speaking ? 'Preparing voice…' : active ? 'Your teacher is preparing…' : phase === 'paused' ? 'Take a moment. Ask when you’re ready.' : 'A question is always welcome.'}</span></div><div><button type="button" className="button secondary compact" disabled={!active && busy!=='send' && busy!=='start' && busy!=='roadmap' && !simulation.running && !voice.voiceActive && !voice.starting} onClick={() => void act('pause', pauseTeaching)}><Pause size={14} /> Pause</button><button type="button" className={`icon-button mic-button ${voice.recording ? 'recording' : ''}`} title={voice.status.recognitionReady ? voice.recording ? 'Turn voice conversation off' : 'Start voice conversation' : 'Set up local voice in Settings'} aria-label={voice.recording ? 'Turn voice conversation off' : 'Start voice conversation'} disabled={!voice.status.recognitionReady} onClick={() => { if (voice.recording || voice.starting) void voice.stopRecording(); else { if (active) void pause().then(() => voice.startRecording()); else void voice.startRecording(); } }}>{voice.recording ? <Square size={17} /> : voice.transcribing ? <LoaderCircle className="spin" size={17} /> : <Mic size={18} />}</button></div></div>{pendingVoice && <div className="voice-send-pending" role="status"><span>Sending your spoken question…</span><button type="button" onClick={() => { cancelVoiceSend(); questionInput.current?.focus(); }}>Cancel & edit</button></div>}{voice.recording && active && <button type="button" className="text-button interrupt-speech" onClick={() => void act('interrupt', async () => { await pause({ keepListening: true }); voice.resumeListening(); })}>Interrupt & speak <Mic size={13} /></button>}<form noValidate className="question-form" onSubmit={(event) => { event.preventDefault(); send(question); }}><label className="sr-only" htmlFor="lesson-question">Ask your teacher a question</label><textarea className="resize-none" id="lesson-question" ref={questionInput} value={question} placeholder={selected.length ? 'Ask about the selected drawing…' : 'Ask a question, share a thought, or say “I’m not following”…'} maxLength={LIMITS.learnerRequestChars} onChange={(event) => { cancelVoiceSend(); voice.resetInput?.(); voiceOwnsDraft.current = false; setQuestion(event.target.value); }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(question); } }} /><button type="submit" className="send-button" aria-label="Send question" title="Send question" disabled={!question.trim() || Boolean(busy)}>{busy === 'send' ? <LoaderCircle className="spin" size={19} /> : <ArrowRight size={19} />}</button></form><div className="lesson-footnote"><span>{selected.length ? `${selected.length} drawing selected · ` : ''}{dirty ? 'Saving your edits…' : 'Saved on this device'}</span><span>{voice.timingEstimated ? 'Word timing follows the audio approximately.' : voice.recording ? 'Voice stays local · short pauses send your turn' : 'Understanding takes its own time.'}</span></div></div></div>}
    </main>

    {source && <SourcePreview source={source} onClose={() => setSource(undefined)} />}
    {settings && <Modal title="Make yourself at home" subtitle="Your account, your voice, your learning space." onClose={() => setSettings(false)}><TeachingSettings desktop={status.desktop} revision={status.teachingRevision} beforeChange={() => {cancelSafetyAdmission();return pause({ keepListening: false });}} onChange={async (configuration) => { setModels(configuration.connections.find(connection => connection.providerId === configuration.activeProvider)?.models ?? []); setStatus(await bridge.getStatus()); }} /><section className="settings-section"><div className="settings-section-heading"><span className="settings-icon"><Sparkles size={20} /></span><div><h3>ChatGPT connection</h3><p>{status.connected ? status.account?.email ?? 'Connected with your ChatGPT account.' : 'Connect your account to begin a conversation.'}</p></div></div>{status.error && <p className="inline-error" role="alert">{status.error}</p>}{status.connected ? <><div className="connected-line"><span className="tiny-dot" />{status.planEnabled ? 'Ready to teach' : 'Connected · model access needs attention'}</div>{!apiTeaching && <><label className="field-label" htmlFor="teaching-model">Teaching model</label><select id="teaching-model" value={status.model ?? ''} disabled={Boolean(busy) || !models.length} onChange={(event) => void act('model', async () => { const model = event.target.value; await pause({ keepListening: false }); setStatus(await bridge.setModel(model)); setNotice({ text: 'Teaching model updated.' }); })}>{status.model && !models.some((model) => model.id === status.model) && models.length > 0 && <option value={status.model} disabled>{status.model} · unavailable</option>}{!status.model && models.length > 0 && <option value="" disabled>Choose a teaching model</option>}{!models.length && <option value={status.model ?? ''}>{status.model ?? 'No models available'}</option>}{models.map((model) => <option value={model.id} key={model.id}>{model.name}</option>)}</select>{status.modelAvailable === false && <p className="inline-error">Your saved model is unavailable for this account. Choose an available model to teach.</p>}</>}<button type="button" className="text-button signout" disabled={Boolean(busy)} onClick={() => void act('disconnect', async () => { await pause({ keepListening: false }); setStatus(await bridge.signOut()); setModels([]); })}>Disconnect ChatGPT</button></> : <button type="button" className="button primary" onClick={connect} disabled={Boolean(busy) || !status.desktop}>{busy === 'connect' ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />} Connect ChatGPT</button>}{!status.desktop && <p className="small-copy subtle">Account connection is available in the Windows desktop app.</p>}{lastModelRun && <p className="model-evidence">Last response requested: <strong>{lastModelRun.requestedModel}</strong><br />Served model: <strong>{lastModelRun.servedModel ?? 'Not reported by the service'}</strong></p>}<p className="settings-footnote">A new, official sign-in connects this app. Your existing ChatGPT conversations are not imported.</p></section><VoiceSettings desktop={status.desktop} rate={voice.rate} beforeChange={async()=>{await pause({keepListening:false});voice.stopSpeaking();}}/><section className="settings-section"><div className="settings-section-heading"><span className="settings-icon mint"><AudioLines size={20} /></span><div><h3>Microphone & local voice</h3><p>Microphone recognition runs on this device. Choose teacher narration above.</p></div></div><div className="settings-status-row"><span>Teacher voice</span><span className="status-label">{voice.status.voiceName ?? (voice.status.synthesisReady || voice.localVoice ? 'Local voice available' : 'No local voice detected')}</span></div><div className="settings-status-row"><span>Speech recognition</span><span className="status-label">{voice.status.recognitionReady ? 'Ready on this device' : 'Model not installed'}</span></div>{voice.status.downloading ? <div className="download-progress" role="status"><span>Downloading {voice.status.downloading}… {Math.round((voice.status.progress ?? 0) * 100)}%</span><progress max={1} value={voice.status.progress ?? 0} /></div> : !voice.status.recognitionReady && <div className="voice-downloads"><button type="button" className="button secondary compact" disabled={!status.desktop || Boolean(busy)} onClick={() => void act('voice', () => voice.install('whisper-base-en'))}>Install English voice input</button><small>148 MB model + local runtime · one-time download</small><button type="button" className="text-button" disabled={!status.desktop || Boolean(busy)} onClick={() => void act('voice', () => voice.install('whisper-tiny-en'))}>Use the smaller 78 MB model</button></div>}{voice.status.error && <p className="inline-error" role="alert">{voice.status.error}</p>}{!voice.status.neuralReady && <div className="voice-downloads"><button type="button" className="button secondary compact" disabled={!status.desktop || Boolean(busy) || Boolean(voice.status.downloading)} onClick={() => void act('neural-voice', () => voice.install('kokoro-female-en'))}>Install natural female voice</button><small>About 350 MB · local neural voice after a one-time download</small></div>}<label className="voice-speed" htmlFor="voice-speed">Speaking speed <output>{Number(voice.rate ?? .96).toFixed(2)}×</output><input id="voice-speed" type="range" min="0.75" max="1.25" step="0.05" value={voice.rate ?? .96} onChange={event => voice.setRate(Number(event.target.value))} /></label><label className="headphones-option"><input type="checkbox" checked={voice.headphones ?? false} onChange={(event) => voice.setHeadphones(event.target.checked)} /><span>I’m using headphones · allow spoken interruptions</span></label><p className="settings-footnote">Speaker mode waits during teacher playback to avoid echo. Use Interrupt & speak at any time. Word timing follows audio duration and is approximate.</p><p className="settings-footnote">Voice input listens continuously and sends after a short silence. Live drafts may take a moment while the local model works. Check your initial topic before beginning. You can always type instead.</p></section><p className="settings-footnote">Safety checks use your selected teaching service and may use its quota. Previously approved lessons and notes remain available offline. Older saved material needs an online safety review before it can open.</p><div className="settings-privacy"><span className="device-dot" /><p>Lessons are saved locally. Teaching needs an internet connection to your selected service; microphone recognition runs on this device. ElevenLabs narration sends spoken text to your connected ElevenLabs account.</p></div></Modal>}
    {deleteTarget && <Modal title="Delete this lesson?" subtitle={`“${deleteTarget.title}” will be removed from this device, including its conversation and canvas.`} onClose={() => { if (busy !== 'delete') setDeleteTarget(null); }}><p className="subtle">This cannot be undone. Export the lesson first if you want to keep a copy.</p><div className="dialog-actions"><button type="button" autoFocus data-initial-focus className="button secondary" disabled={busy === 'delete'} onClick={() => setDeleteTarget(null)}>Cancel</button><button type="button" className="button danger" disabled={busy === 'delete'} onClick={deleteLesson}>{busy === 'delete' && <LoaderCircle size={16} className="spin" />}Delete lesson</button></div></Modal>}
  </div>;
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { const target = document.activeElement as HTMLElement | null; const element = dialog.current; element?.showModal(); element?.querySelector<HTMLElement>('[data-initial-focus]')?.focus(); return () => { element?.close(); target?.focus(); }; }, []);
  return <dialog ref={dialog} className="modal" aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); onClose(); }}><div className="modal-header"><div><span className="eyebrow">CANVAS ATLAS</span><h2 id="modal-title">{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button type="button" className="icon-button" title="Close dialog" aria-label="Close dialog" onClick={onClose}><X size={19} /></button></div>{children}</dialog>;
}
