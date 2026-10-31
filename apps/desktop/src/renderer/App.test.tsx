// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppStatus, AudioResult, DocumentManifest, CourseRecord, NarrationChunk, PlaybackCursor, LearningPlan, LessonSession, LessonNotesRecord, SceneEntity, SessionSummary, SimulationCheckpoint, TeachingConfiguration, TutorEvent } from '@living-canvas/protocol';
import {LEARNER_SAFETY_MESSAGE,SAFETY_REVIEW_MESSAGE,SAFETY_SEXUAL_MESSAGE,SAFETY_SEXUAL_ALTERNATIVE,SAFETY_HEALTH_MESSAGE} from '@living-canvas/protocol';

const fixture = vi.hoisted(() => {
  const state = { listener: null as ((event: TutorEvent) => void) | null, connected: false, recognitionReady: false, modelAvailable: true };
  const voiceCallbacks: { onDraft?: (text: string) => void; onFinal?: (text: string) => void; onSpeechStart?: () => void } = {};
  const voice = { speak: vi.fn(async (text: string, heard?: (text: string) => void) => { heard?.(text); }), stopSpeaking: vi.fn() };
  const session: LessonSession = { id: 'test-lesson', topic: 'A fresh topic', title: 'A fresh topic', createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z', messages: [], beats: [], scene: [], controls: {} };
  const plan: LearningPlan = { id: 'test-plan', version: 1, title: 'A fresh roadmap', sourceDocumentIds: [], concepts: [{ id: 'first-concept', title: 'A fresh concept', objectives: ['Understand the idea'], prerequisiteIds: [], sourceRefs: [] }] };
  session.plan = plan;
  session.learningProgress = { planId: plan.id, planVersion: 1, activeConceptId: 'first-concept', conceptStates: { 'first-concept': 'planned' }, status: 'planned' };
  let cancelAudio: ((result: AudioResult) => void) | undefined;
  const audioPlayback = {
    play: vi.fn(async (chunk: NarrationChunk, cursor: PlaybackCursor, callbacks?: { onFrame?: (frame: { cursor: PlaybackCursor; offsetSeconds: number; durationSeconds: number; progress: number; estimated: boolean }) => void }): Promise<AudioResult> => {
      callbacks?.onFrame?.({ cursor, offsetSeconds: 0, durationSeconds: .1, progress: 0, estimated: false });
      const result = await Promise.race([voice.speak(chunk.text).then(() => 'completed' as const), new Promise<AudioResult>(resolve => { cancelAudio = resolve; })]);
      if (result === 'completed') callbacks?.onFrame?.({ cursor, offsetSeconds: .1, durationSeconds: .1, progress: 1, estimated: false });
      return result;
    }),
    buffer: vi.fn(async (operation: () => Promise<void>) => { await operation(); }),
    pause: vi.fn(async (): Promise<AudioResult> => { cancelAudio?.('paused'); return 'paused'; }),
    resume: vi.fn(async (): Promise<AudioResult> => 'completed'),
    stop: vi.fn(() => { cancelAudio?.('interrupted'); }),
  };
  const bridge = {
    planTopic: vi.fn(async () => plan), startConcept: vi.fn(async () => {}), savePlayback: vi.fn(async () => {}), resumePlayback: vi.fn(), returnToLesson: vi.fn(),
    importStudyMaterial: vi.fn(async (): Promise<DocumentManifest[]> => []), cancelDocumentImport: vi.fn(async () => {}), getDocuments: vi.fn(async () => []), getCourses: vi.fn(async (): Promise<CourseRecord[]> => []), loadCourse: vi.fn(), startCourseLesson: vi.fn(), planCourse: vi.fn(), getSourcePreview: vi.fn(),
    getStatus: vi.fn(async (): Promise<AppStatus> => ({ connected: state.connected, planEnabled: state.connected, desktop: true, model: 'model-one', modelAvailable: state.modelAvailable })),
    getSessions: vi.fn(async (): Promise<SessionSummary[]> => []),
    getModels: vi.fn(async () => [{ id: 'model-one', name: 'First model' }, { id: 'model-two', name: 'Second model' }]),
    signIn: vi.fn(async () => ({ connected: true, planEnabled: true, desktop: true })),
    signOut: vi.fn(async () => ({ connected: false, planEnabled: false, desktop: true })),
    setModel: vi.fn(async (model: string) => ({ connected: true, planEnabled: true, desktop: true, model })), createSession: vi.fn(async (_topic?:string,_requestId?:string) => session), cancelSafetyAdmission:vi.fn(async (_requestId:string)=>{}), loadSession: vi.fn(async () => session),
    continueLesson: vi.fn(async () => {}), readyToClose: vi.fn(async () => {}), presentProgress: vi.fn(async (_input?: { complete?: boolean }) => {}), sendMessage: vi.fn(async (_input?: unknown) => {}), saveScene: vi.fn(async (_input?: unknown) => {}), interrupt: vi.fn(async () => {}),
    deleteSession: vi.fn(async () => {}), exportLesson: vi.fn(async () => ({ canceled: true })),
    getLessonNotes: vi.fn(async (_sessionId:string):Promise<LessonNotesRecord|null>=>null), generateLessonNotes:vi.fn(async (_input:{sessionId:string}):Promise<LessonNotesRecord>=>({id:'11111111-1111-4111-8111-111111111111',sessionId:session.id,title:'Study notes',createdAt:'2026-10-31T00:00:00Z',studiedSteps:1,providerId:'chatgpt',requestedModel:'model-one'})),cancelLessonNotes:vi.fn(async (_sessionId:string)=>{}),openLessonNotes:vi.fn(async (_input:{sessionId:string;notesId:string})=>{}),exportLessonNotes:vi.fn(async (_input:{sessionId:string;notesId:string})=>({canceled:true})),
    onEvent: vi.fn((listener: (event: TutorEvent) => void) => { state.listener = listener; return () => { state.listener = null; }; }),
    runSimulation: vi.fn(async (_input?: unknown): Promise<{ state: unknown; entities: SceneEntity[] }> => ({ state: {}, entities: [] })),
  };
  return { state, bridge, session, voiceCallbacks, voice, audioPlayback, plan };
});
vi.mock('./bridge', () => ({ bridge: fixture.bridge }));
vi.mock('./SceneCanvas', () => ({ default: ({ entities, onChange, onVisible }: { entities: { id: string }[]; onChange: (entities: unknown[]) => void; onVisible?: (entities: unknown[]) => void }) => { React.useLayoutEffect(() => { onVisible?.(entities); }, [entities, onVisible]); return <div data-testid="canvas">{entities.map((entity) => <span key={entity.id}>{entity.id}</span>)}<button onClick={() => onChange([{ id: 'note-test', kind: 'text', x: 10, y: 10, text: 'My note' }])}>Test edit canvas</button></div>; }, OrbitMark: () => <svg /> }));
vi.mock('./visuals/VisualStage', () => ({ default: ({ frame, onVisible, onReady, onChange }: { frame: { entities: { id: string }[] }; onVisible?: (entities: unknown[]) => void; onReady?: () => void; onChange: (entities: unknown[]) => void }) => { React.useLayoutEffect(() => { onVisible?.(frame.entities); onReady?.(); }, [frame, onVisible, onReady]); return <div data-testid="canvas">{frame.entities.map(entity => <span key={entity.id}>{entity.id}</span>)}<button onClick={() => onChange([{ id: 'note-test', kind: 'text', x: 10, y: 10, text: 'My note', semanticRole: 'learner-note' }])}>Test edit canvas</button></div>; } }));
vi.mock('./useVoice', () => ({ useVoice: (_transcript: unknown, _error: unknown, options = {}) => { Object.assign(fixture.voiceCallbacks, options); const [recording, setRecording] = React.useState(false); return { status: { recognitionReady: fixture.state.recognitionReady, synthesisReady: false }, recording, listening: recording, transcribing: false, speaking: false, enabled: false, localVoice: false, ...fixture.voice, audioPlayback: fixture.audioPlayback, stopRecording: vi.fn(async () => { setRecording(false); }), startRecording: vi.fn(async () => { setRecording(true); }), resumeListening: vi.fn(), toggle: vi.fn(), install: vi.fn() }; } }));
import App, { applyBeat } from './App';

beforeEach(() => { fixture.state.connected = false; fixture.state.modelAvailable = true; fixture.state.recognitionReady = false; vi.clearAllMocks(); fixture.bridge.createSession.mockReset().mockResolvedValue(fixture.session); fixture.bridge.cancelSafetyAdmission.mockReset().mockResolvedValue(undefined); fixture.bridge.getSessions.mockReset().mockResolvedValue([]); fixture.bridge.loadSession.mockReset().mockResolvedValue(fixture.session); fixture.bridge.runSimulation.mockReset().mockResolvedValue({ state: {}, entities: [] }); fixture.bridge.interrupt.mockReset().mockResolvedValue(undefined); fixture.bridge.saveScene.mockReset().mockResolvedValue(undefined); fixture.bridge.presentProgress.mockReset().mockResolvedValue(undefined); fixture.voice.speak.mockReset().mockImplementation(async (text, heard) => { heard?.(text); }); HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); }; });
afterEach(() => {
  cleanup();
  for (const name of ['getTeachingConfiguration', 'refreshTeachingModels', 'selectTeachingProvider', 'connectTeachingKey', 'clearTeachingKey']) Reflect.deleteProperty(fixture.bridge, name);
  fixture.bridge.getStatus.mockReset().mockImplementation(async () => ({ connected: fixture.state.connected, planEnabled: fixture.state.connected, desktop: true, model: 'model-one', modelAvailable: fixture.state.modelAvailable }));
});

beforeEach(()=>{fixture.bridge.getLessonNotes.mockReset().mockResolvedValue(null);fixture.bridge.generateLessonNotes.mockReset().mockResolvedValue({id:'11111111-1111-4111-8111-111111111111',sessionId:fixture.session.id,title:'Study notes',createdAt:'2026-10-31T00:00:00Z',studiedSteps:1,providerId:'chatgpt',requestedModel:'model-one'});fixture.bridge.cancelLessonNotes.mockReset().mockResolvedValue(undefined);fixture.bridge.openLessonNotes.mockReset().mockResolvedValue(undefined);fixture.bridge.exportLessonNotes.mockReset().mockResolvedValue({canceled:true});});

describe('studied lesson notes',()=>{
  it('interrupts, saves and reloads acknowledged progress before generating notes without completing the roadmap',async()=>{
    fixture.state.connected=true;
    const studied:LessonSession={...fixture.session,title:'My studied lesson',messages:[{id:'heard-note',role:'tutor',text:'The part I heard.',createdAt:fixture.session.createdAt}],scene:[{id:'my-note',kind:'text',x:20,y:20,text:'Keep my edits',semanticRole:'learner-note'}]};
    fixture.bridge.getSessions.mockResolvedValue([{id:studied.id,title:studied.title,topic:studied.topic,updatedAt:studied.updatedAt,messageCount:1}]);fixture.bridge.loadSession.mockResolvedValue(studied);
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:studied.title}));
    expect(await screen.findByText('0 of 1 concepts covered')).toBeTruthy();
    let finishInterruption!:()=>void;fixture.bridge.interrupt.mockImplementationOnce(()=>new Promise(resolve=>{finishInterruption=resolve;}));
    fixture.bridge.saveScene.mockClear();fixture.bridge.loadSession.mockClear();
    fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));
    await waitFor(()=>expect(fixture.bridge.interrupt).toHaveBeenCalledWith(studied.id));expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
    await act(async()=>{finishInterruption();});await screen.findByRole('button',{name:'Open PDF'});
    expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:studied.id});
    const saved=fixture.bridge.saveScene.mock.invocationCallOrder[0],loaded=fixture.bridge.loadSession.mock.invocationCallOrder[0],generated=fixture.bridge.generateLessonNotes.mock.invocationCallOrder[0];expect(saved).toBeLessThan(loaded);expect(loaded).toBeLessThan(generated);
    expect(screen.getByTestId('canvas').textContent).toContain('my-note');expect(fixture.bridge.startConcept).not.toHaveBeenCalled();
  });

  it('keeps stored PDF actions available without a teaching connection',async()=>{
    const stored={...fixture.session,title:'My offline lesson'};fixture.bridge.getSessions.mockResolvedValue([{id:stored.id,title:stored.title,topic:stored.topic,updatedAt:stored.updatedAt,messageCount:0}]);fixture.bridge.loadSession.mockResolvedValue(stored);
    fixture.bridge.getLessonNotes.mockResolvedValue({id:'11111111-1111-4111-8111-111111111111',sessionId:stored.id,title:'Stored notes',createdAt:stored.createdAt,studiedSteps:1,providerId:'chatgpt',requestedModel:'model-one'});
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:stored.title}));fireEvent.click(await screen.findByRole('button',{name:'Open PDF'}));
    await waitFor(()=>expect(fixture.bridge.openLessonNotes).toHaveBeenCalledTimes(1));expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
    expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('animated learning and safe recovery',()=>{
  const openLesson=async(connected=true)=>{
    fixture.state.connected=connected;
    const stored:LessonSession={...fixture.session,title:'A studied concept',messages:[{id:'heard',role:'tutor',text:'A safe explanation.',createdAt:fixture.session.createdAt}],scene:[{id:'stable-diagram',kind:'circle',x:20,y:30,radius:8}]};
    fixture.bridge.getSessions.mockResolvedValue([{id:stored.id,title:stored.title,topic:stored.topic,updatedAt:stored.updatedAt,messageCount:1}]);fixture.bridge.loadSession.mockResolvedValue(stored);
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:stored.title}));await screen.findByTestId('canvas');return stored;
  };
  it('requests meaningful motion for the current concept through the existing teacher connection',async()=>{
    const stored=await openLesson();fireEvent.click(screen.getByRole('button',{name:'Animate this'}));
    await waitFor(()=>expect(fixture.bridge.sendMessage).toHaveBeenCalledWith(expect.objectContaining({sessionId:stored.id,text:expect.stringMatching(/animate.*current concept/i)})));
    const request=(fixture.bridge.sendMessage.mock.calls[0][0] as {text:string}).text;
    expect(request).toMatch(/motion|movement/i);expect(request).toMatch(/diagram|simulation/i);expect(request).not.toMatch(/quiz/i);
  });
  it('disables animation requests offline while keeping local notes available',async()=>{
    await openLesson(false);expect((screen.getByRole('button',{name:'Animate this'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'Create notes offline'}) as HTMLButtonElement).disabled).toBe(false);expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
  });
  it('retains a blocked question, stops stale teaching, and focuses editing without resending it',async()=>{
    const stored=await openLesson();act(()=>fixture.state.listener?.({type:'status',sessionId:stored.id,epoch:4,phase:'ready'}));
    fixture.bridge.sendMessage.mockRejectedValueOnce(new Error(`Error invoking remote method 'lc:sendMessage': Error: ${LEARNER_SAFETY_MESSAGE}`));
    const input=screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'My question to revise'}});fireEvent.click(screen.getByRole('button',{name:'Send question'}));
    const recovery=await screen.findByRole('status',{name:'Learning guidance'});expect(recovery.textContent).toContain(LEARNER_SAFETY_MESSAGE);expect(input.value).toBe('My question to revise');
    expect(fixture.audioPlayback.stop).toHaveBeenCalled();expect(fixture.voice.stopSpeaking).toHaveBeenCalled();
    act(()=>fixture.state.listener?.({type:'beat',sessionId:stored.id,epoch:4,beat:{id:'blocked-late',narration:'Late stale words.',canvas:{mode:'replace',entities:[{id:'late-object',kind:'circle',x:5,y:5}]}}}));
    expect(screen.queryByText('late-object')).toBeNull();expect(screen.getByText('stable-diagram')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Edit question'}));expect(document.activeElement).toBe(input);expect(input.value).toBe('My question to revise');expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('uses neutral safety recovery when narration approval rejects playback',async()=>{
    const stored=await openLesson();fixture.audioPlayback.play.mockRejectedValueOnce(new Error(SAFETY_REVIEW_MESSAGE));
    await act(async()=>fixture.state.listener?.({type:'beat',sessionId:stored.id,epoch:3,beat:{id:'speech-needs-review',narration:'A short accepted explanation.',next:'ask',canvas:{mode:'replace',entities:stored.scene}}}));
    const guidance=await screen.findByRole('status',{name:'Learning guidance'});expect(guidance.textContent).toContain(SAFETY_REVIEW_MESSAGE);expect(screen.queryByRole('alert')).toBeNull();expect(fixture.voice.stopSpeaking).toHaveBeenCalled();
  });
  it('offers a new topic after an asynchronous safety stop without submitting the current draft',async()=>{
    const stored=await openLesson();fireEvent.change(screen.getByLabelText('Ask your teacher a question'),{target:{value:'Keep this unsent draft'}});
    act(()=>fixture.state.listener?.({type:'error',sessionId:stored.id,epoch:2,message:LEARNER_SAFETY_MESSAGE}));
    await screen.findByRole('status',{name:'Learning guidance'});expect((screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement).value).toBe('Keep this unsent draft');
    fireEvent.click(screen.getByRole('button',{name:'New topic'}));await screen.findByLabelText('What would you like to learn today?');expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
  });
});

describe('topic safety admission',()=>{
  const begin=async()=>{
    fixture.state.connected=true;render(<App/>);
    fireEvent.click(await screen.findByRole('button',{name:/Start learning/}));
    const input=await screen.findByLabelText('What would you like to learn today?') as HTMLTextAreaElement;
    fixture.voice.speak.mockClear();return input;
  };
  it('keeps a blocked original topic editable without creating lesson UI or generation',async()=>{
    const input=await begin();fixture.bridge.createSession.mockRejectedValueOnce(new Error(LEARNER_SAFETY_MESSAGE));
    fireEvent.change(input,{target:{value:'My original question'}});fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));
    await screen.findByRole('status',{name:'Learning guidance'});
    expect(input.value).toBe('My original question');expect(fixture.bridge.createSession).toHaveBeenCalledExactlyOnceWith('My original question',expect.any(String));
    expect(fixture.bridge.planTopic).not.toHaveBeenCalled();expect(fixture.bridge.startConcept).not.toHaveBeenCalled();expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();expect(fixture.bridge.runSimulation).not.toHaveBeenCalled();expect(fixture.voice.speak).not.toHaveBeenCalled();expect(screen.queryByText(/concepts covered/)).toBeNull();expect(screen.queryByTestId('canvas')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:/^New topic$/}));await waitFor(()=>expect(input.value).toBe(''));expect(fixture.voice.speak).not.toHaveBeenCalled();expect(fixture.bridge.createSession).toHaveBeenCalledTimes(1);
  });
  it.each([SAFETY_REVIEW_MESSAGE,SAFETY_HEALTH_MESSAGE])('shows public guidance silently and leaves the topic unstarted: %s',async(copy)=>{
    const input=await begin();fixture.bridge.createSession.mockRejectedValueOnce(new Error(`Error invoking remote method 'lc:createSession': Error: ${copy}`));
    fireEvent.change(input,{target:{value:'My question needing guidance'}});fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));
    const notice=await screen.findByRole('status',{name:'Learning guidance'});expect(notice.textContent).toContain(copy);expect(notice.textContent).not.toMatch(/confidence|reason_code|classifier|category/i);
    expect(input.value).toBe('My question needing guidance');expect(fixture.bridge.planTopic).not.toHaveBeenCalled();expect(fixture.voice.speak).not.toHaveBeenCalled();expect(screen.queryByTestId('canvas')).toBeNull();
    if(copy===SAFETY_REVIEW_MESSAGE)expect(document.activeElement).toBe(input);
  });
  it('only drafts an offered safe alternative and requires an explicit new submission',async()=>{
    const input=await begin();fixture.bridge.createSession.mockRejectedValueOnce(new Error(SAFETY_SEXUAL_MESSAGE));
    fireEvent.change(input,{target:{value:'The original blocked question'}});fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));
    await screen.findByRole('status',{name:'Learning guidance'});fireEvent.click(screen.getByRole('button',{name:'Edit safe alternative'}));
    expect(input.value).toBe(SAFETY_SEXUAL_ALTERNATIVE);expect(document.activeElement).toBe(input);expect(fixture.bridge.createSession).toHaveBeenCalledTimes(1);expect(fixture.bridge.planTopic).not.toHaveBeenCalled();expect(fixture.voice.speak).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));await waitFor(()=>expect(fixture.bridge.createSession).toHaveBeenCalledTimes(2));expect(fixture.bridge.createSession).toHaveBeenLastCalledWith(SAFETY_SEXUAL_ALTERNATIVE,expect.any(String));
  });
  it.each(['success','failure'] as const)('cancels an edited topic admission and ignores obsolete %s',async(result)=>{
    const input=await begin();let approve!:(value:LessonSession)=>void,reject!:(value:Error)=>void;
    fixture.bridge.createSession.mockImplementationOnce(()=>new Promise((resolve,fail)=>{approve=resolve;reject=fail;}));
    fireEvent.change(input,{target:{value:'Original topic'}});fireEvent.submit(input.closest('form')!);fireEvent.submit(input.closest('form')!);
    expect(fixture.bridge.createSession).toHaveBeenCalledTimes(1);expect(screen.queryByTestId('canvas')).toBeNull();
    const requestId=fixture.bridge.createSession.mock.calls[0][1];expect(typeof requestId).toBe('string');
    fireEvent.change(input,{target:{value:'Changed topic'}});await waitFor(()=>expect(fixture.bridge.cancelSafetyAdmission).toHaveBeenCalledWith(requestId));
    await act(async()=>{if(result==='success')approve(fixture.session);else reject(new Error(LEARNER_SAFETY_MESSAGE));});
    expect(input.value).toBe('Changed topic');expect(screen.queryByTestId('canvas')).toBeNull();expect(screen.queryByRole('status',{name:'Learning guidance'})).toBeNull();expect(fixture.bridge.planTopic).not.toHaveBeenCalled();expect((screen.getByRole('button',{name:'Create roadmap'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('cancels pending admission on navigation and unmount',async()=>{
    const input=await begin();fixture.bridge.createSession.mockImplementationOnce(()=>new Promise(()=>{}));
    fireEvent.change(input,{target:{value:'Pending topic'}});fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));
    const id=fixture.bridge.createSession.mock.calls[0][1];fireEvent.click(screen.getByRole('button',{name:'Back to my space'}));
    await waitFor(()=>expect(fixture.bridge.cancelSafetyAdmission).toHaveBeenCalledWith(id));
    expect(await screen.findByRole('button',{name:/Start learning/})).toBeTruthy();
  });
  it('buffers an accepted beat until question admission returns, then starts it once',async()=>{
    fixture.state.connected=true;const stored={...fixture.session,title:'Question admission queue'};
    fixture.bridge.getSessions.mockResolvedValue([{id:stored.id,title:stored.title,topic:stored.topic,updatedAt:stored.updatedAt,messageCount:0}]);fixture.bridge.loadSession.mockResolvedValue(stored);
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:stored.title}));await screen.findByTestId('canvas');fixture.voice.speak.mockClear();
    let accept!:()=>void;fixture.bridge.sendMessage.mockImplementationOnce(()=>new Promise(resolve=>{accept=resolve;}));
    fireEvent.change(screen.getByLabelText('Ask your teacher a question'),{target:{value:'Explain gravity'}});fireEvent.click(screen.getByRole('button',{name:'Send question'}));await waitFor(()=>expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1));
    await act(async()=>fixture.state.listener?.({type:'beat',sessionId:stored.id,epoch:1,beat:{id:'accepted-after-check',narration:'Gravity attracts masses.',next:'ask',canvas:{mode:'replace',entities:[]}}}));
    expect(fixture.voice.speak).not.toHaveBeenCalled();await act(async()=>{accept();});await waitFor(()=>expect(fixture.voice.speak).toHaveBeenCalledExactlyOnceWith('Gravity attracts masses.'));
  });
  it.each(['voice','provider','unmount'] as const)('cancels a pending topic check on %s changes',async(kind)=>{
    const input=await begin();fixture.bridge.createSession.mockImplementationOnce(()=>new Promise(()=>{}));fireEvent.change(input,{target:{value:'Pending original'}});fireEvent.click(screen.getByRole('button',{name:'Create roadmap'}));const requestId=fixture.bridge.createSession.mock.calls[0][1];
    if(kind==='voice')act(()=>fixture.voiceCallbacks.onDraft?.('New spoken topic'));
    else if(kind==='provider')act(()=>fixture.state.listener?.({type:'auth',status:{connected:true,planEnabled:true,desktop:true,teachingProvider:'gemini',teachingRevision:2,model:'other'}}));
    else cleanup();
    await waitFor(()=>expect(fixture.bridge.cancelSafetyAdmission).toHaveBeenCalledWith(requestId));expect(fixture.bridge.planTopic).not.toHaveBeenCalled();
  });
  it('allows Pause to cancel a pending question check without losing its draft or adopting a late error',async()=>{
    fixture.state.connected=true;const stored={...fixture.session,title:'Cancelable question'};fixture.bridge.getSessions.mockResolvedValue([{id:stored.id,title:stored.title,topic:stored.topic,updatedAt:stored.updatedAt,messageCount:0}]);fixture.bridge.loadSession.mockResolvedValue(stored);
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:stored.title}));await screen.findByTestId('canvas');let reject!:(error:Error)=>void;fixture.bridge.sendMessage.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
    const input=screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'Pending original question'}});fireEvent.click(screen.getByRole('button',{name:'Send question'}));await waitFor(()=>expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1));fixture.bridge.interrupt.mockClear();
    const pause=screen.getByRole('button',{name:/^Pause$/}) as HTMLButtonElement;expect(pause.disabled).toBe(false);fireEvent.click(pause);await waitFor(()=>expect(fixture.bridge.interrupt).toHaveBeenCalledWith(stored.id));
    await act(async()=>reject(new Error(SAFETY_REVIEW_MESSAGE)));expect(input.value).toBe('Pending original question');expect(screen.queryByRole('status',{name:'Learning guidance'})).toBeNull();expect((screen.getByRole('button',{name:'Send question'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('holds question submission busy until backend admission settles and restores a blocked draft',async()=>{
    fixture.state.connected=true;const stored={...fixture.session,title:'Admitted lesson'};
    fixture.bridge.getSessions.mockResolvedValue([{id:stored.id,title:stored.title,topic:stored.topic,updatedAt:stored.updatedAt,messageCount:0}]);fixture.bridge.loadSession.mockResolvedValue(stored);
    render(<App/>);fireEvent.click(await screen.findByRole('button',{name:stored.title}));await screen.findByTestId('canvas');
    let reject!:(error:Error)=>void;fixture.bridge.sendMessage.mockImplementationOnce(()=>new Promise((_,fail)=>{reject=fail;}));
    const input=screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'My next question'}});
    const submit=screen.getByRole('button',{name:'Send question'});fireEvent.click(submit);await waitFor(()=>expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1));
    fireEvent.click(submit);expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1);expect((submit as HTMLButtonElement).disabled).toBe(true);expect(input.value).toBe('My next question');
    await act(async()=>reject(new Error(LEARNER_SAFETY_MESSAGE)));await screen.findByRole('status',{name:'Learning guidance'});expect(input.value).toBe('My next question');
  });
});

describe('manual experiment ownership', () => {
  const openPausedReview = async () => {
    fixture.state.connected = true;
    const artifact = { id: 'manual-model', title: 'Manual experiment', source: 'test-only', controls: [{ id: 'mass', label: 'Mass', type: 'slider' as const, value: 1, min: 1, max: 5 }], assumptions: [], validation: 'illustrative' as const };
    const teacher: SceneEntity = { id: 'manual-teacher', kind: 'text', x: 20, y: 20, text: 'Accepted explanation' };
    const beat = { id: 'manual-beat', narration: 'Accepted explanation', chunks: [{ id: 'manual-chunk', text: 'Accepted explanation' }], cues: [], next: 'ask' as const, canvas: { mode: 'replace' as const, entities: [teacher] }, simulation: artifact };
    const simulation: SimulationCheckpoint = { artifact, tick: 0, state: { mass: 1 }, values: { mass: 1 }, initialValues: { mass: 1 }, inputs: [] };
    const checkpoint = { cursor: { beatId: beat.id, chunkId: 'manual-chunk', offsetSeconds: 0, passId: 'manual-accepted' }, completedChunkIds: ['manual-chunk'], appliedCueIds: [], baselineScene: [teacher], visibleScene: [teacher], simulation };
    const a: LessonSession = { ...fixture.session, id: 'manual-a', title: 'Experiment lesson A', beats: [beat], scene: [teacher], simulation, controls: { mass: 1 }, playback: checkpoint };
    const b: LessonSession = { ...a, id: 'manual-b', title: 'Experiment lesson B' };
    fixture.bridge.getSessions.mockResolvedValue([a, b].map(s => ({ id: s.id, title: s.title, topic: s.topic, updatedAt: s.updatedAt, messageCount: 1 })));
    fixture.bridge.loadSession.mockImplementation(async (...args: unknown[]) => structuredClone(args[0] === b.id ? b : a));
    fixture.bridge.runSimulation.mockImplementation(async value => { const input = value as { values: { mass: number } }; return { state: { mass: input.values.mass }, entities: [{ id: 'mass-body', kind: 'circle', x: input.values.mass * 100, y: 100 }] }; });
    fixture.bridge.resumePlayback.mockResolvedValueOnce({ beat, checkpoint, epoch: 5, mode: 'replay' });
    let finishReview: ((result: AudioResult) => void) | undefined;
    fixture.audioPlayback.play.mockImplementationOnce(async () => new Promise<AudioResult>(resolve => { finishReview = resolve; }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: a.title }));
    await screen.findByLabelText('Experiment controls');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(finishReview).toBeTypeOf('function'));
    fixture.audioPlayback.pause.mockImplementationOnce(async () => { finishReview?.('paused'); return 'paused'; });
    fireEvent.click(screen.getByRole('button', { name: 'Pause teaching' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } });
    await waitFor(() => expect(fixture.bridge.runSimulation.mock.calls.some(call => { const input = call[0] as { action: string; values: { mass: number } }; return input.action === 'input' && input.values.mass === 3; })).toBe(true));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save edits' }) as HTMLButtonElement).disabled).toBe(false));
    return { a, b, beat, checkpoint };
  };
  it('saves explicit control edits during review without rewriting acknowledged playback evidence', async () => {
    const { a } = await openPausedReview();
    fixture.bridge.saveScene.mockClear(); fixture.bridge.presentProgress.mockClear(); fixture.bridge.savePlayback.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalledTimes(1));
    expect(fixture.bridge.saveScene.mock.calls[0][0]).toMatchObject({ sessionId: a.id, controls: { mass: 3 }, simulation: { values: { mass: 3 }, state: { mass: 3 }, inputs: [{ tick: 0, values: { mass: 3 } }] } });
    expect(fixture.bridge.presentProgress).not.toHaveBeenCalled();
    expect(fixture.bridge.savePlayback).not.toHaveBeenCalled();
  });
  it('resumes the newly opened lesson instead of sending an old experiment-change question', async () => {
    const { b, beat, checkpoint } = await openPausedReview();
    fireEvent.click(screen.getByRole('button', { name: b.title }));
    await screen.findByRole('heading', { name: b.title });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fixture.bridge.resumePlayback.mockClear(); fixture.bridge.sendMessage.mockClear();
    fixture.bridge.resumePlayback.mockResolvedValueOnce({ beat, checkpoint, epoch: 6, mode: 'replay' });
    fireEvent.click(screen.getByRole('button', { name: 'Resume teaching' }));
    await waitFor(() => expect(fixture.bridge.resumePlayback).toHaveBeenCalledWith({ sessionId: b.id, mode: 'resume' }));
    expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
  });
  it('persists a reviewed experiment reset even when its control values are unchanged', async () => {
    const { a } = await openPausedReview();
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalledTimes(1));
    const saved = fixture.bridge.saveScene.mock.calls[0][0] as { scene: SceneEntity[]; controls: Record<string, number>; simulation: SimulationCheckpoint };
    fixture.bridge.loadSession.mockResolvedValue({ ...a, scene: saved.scene, controls: saved.controls, simulation: saved.simulation });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    fixture.bridge.saveScene.mockClear(); fixture.bridge.runSimulation.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Reset experiment' }));
    await waitFor(() => expect(fixture.bridge.runSimulation).toHaveBeenCalledWith(expect.objectContaining({ action: 'init', tick: 0, values: { mass: 3 } })));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save edits' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalledTimes(1));
    expect(fixture.bridge.saveScene.mock.calls[0][0]).toMatchObject({ sessionId: a.id, controls: { mass: 3 }, simulation: { tick: 0, values: { mass: 3 }, initialValues: { mass: 3 }, inputs: [] } });
    expect(fixture.bridge.presentProgress).not.toHaveBeenCalled(); expect(fixture.bridge.savePlayback).not.toHaveBeenCalled();
  });
  it('supersedes a deferred review autosave with one consistent latest checkpoint and drawing', async () => {
    const { a } = await openPausedReview();
    let releaseRead!: (session: LessonSession) => void;
    fixture.bridge.loadSession.mockImplementationOnce(async () => new Promise<LessonSession>(resolve => { releaseRead = resolve; }));
    fixture.bridge.saveScene.mockClear();
    await waitFor(() => expect(releaseRead).toBeTypeOf('function'), { timeout: 2000 });
    fireEvent.change(screen.getByRole('slider'), { target: { value: '4' } });
    await waitFor(() => expect(fixture.bridge.runSimulation).toHaveBeenCalledWith(expect.objectContaining({ action: 'input', values: { mass: 4 } })));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save edits' }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await act(async () => { releaseRead(a); });
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalledTimes(1));
    const saved = fixture.bridge.saveScene.mock.calls[0][0] as { scene: SceneEntity[]; controls: Record<string, number>; simulation: SimulationCheckpoint };
    expect(saved).toMatchObject({ controls: { mass: 4 }, simulation: { state: { mass: 4 }, values: { mass: 4 }, inputs: [{ tick: 0, values: { mass: 3 } }, { tick: 0, values: { mass: 4 } }] } });
    expect(saved.scene.some(entity => entity.kind === 'circle' && entity.x === 400)).toBe(true);
    expect(saved.scene.some(entity => entity.kind === 'circle' && entity.x === 300)).toBe(false);
    expect(fixture.bridge.presentProgress).not.toHaveBeenCalled(); expect(fixture.bridge.savePlayback).not.toHaveBeenCalled();
  });
});

describe('learner journey and event isolation', () => {
  it.each([
    'Gemini service is temporarily unavailable. Try again later.',
    'Gemini returned malformed stream JSON.',
  ])('stops preparing after roadmap failure and retries the saved topic without duplicating the lesson: %s', async message => {
    fixture.state.connected = true;
    const unplanned: LessonSession = { ...fixture.session, plan: undefined, learningProgress: undefined, scene: [{ id: 'saved-note', kind: 'text', x: 20, y: 20, text: 'Keep this note', semanticRole: 'learner-note' }] };
    fixture.bridge.createSession.mockResolvedValueOnce(unplanned);
    fixture.bridge.loadSession.mockResolvedValueOnce({ ...unplanned, plan: fixture.plan, learningProgress: fixture.session.learningProgress });
    let rejectRoadmap!: (error: Error) => void;
    fixture.bridge.planTopic.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRoadmap = reject; }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'What is gravitation?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    await screen.findByText('Your teacher is preparing…');
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    expect(await screen.findByText('Thinking it through…')).toBeTruthy();
    await act(async () => { rejectRoadmap(new Error(`Error invoking remote method 'lc:planTopic': Error: ${message}`)); });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(message);
    expect(screen.queryByText('Your teacher is preparing…')).toBeNull();
    expect(screen.queryByText('Thinking it through…')).toBeNull();
    expect(screen.queryByText('Finding a way in…')).toBeNull();
    expect(alert.textContent).not.toContain('Error invoking remote method');
    expect(screen.getByTestId('canvas').textContent).toContain('saved-note');
    expect(fixture.bridge.createSession).toHaveBeenCalledTimes(1);
    expect(fixture.bridge.planTopic).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry roadmap' }));
    await screen.findByRole('button', { name: 'Start Teaching' });
    expect(fixture.bridge.planTopic).toHaveBeenCalledTimes(2);
    expect(fixture.bridge.planTopic).toHaveBeenNthCalledWith(2, { sessionId: unplanned.id });
    expect(fixture.bridge.createSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('canvas').textContent).toContain('saved-note');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fixture.bridge.startConcept).not.toHaveBeenCalled();
  });

  it.each(['success', 'failure'] as const)('does not adopt an obsolete roadmap %s after planning is interrupted', async result => {
    fixture.state.connected = true;
    const unplanned: LessonSession = { ...fixture.session, plan: undefined, learningProgress: undefined };
    fixture.bridge.createSession.mockResolvedValueOnce(unplanned);
    let resolveRoadmap!: (plan: LearningPlan) => void, rejectRoadmap!: (error: Error) => void;
    fixture.bridge.planTopic.mockImplementationOnce(() => new Promise((resolve, reject) => { resolveRoadmap = resolve; rejectRoadmap = reject; }));
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Keep this topic after changing connection' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    await screen.findByText('Your teacher is preparing…');
    act(() => fixture.state.listener?.({ type: 'status', sessionId: unplanned.id, epoch: 1, phase: 'paused' }));
    await act(async () => { if (result === 'success') resolveRoadmap(fixture.plan); else rejectRoadmap(new Error('Obsolete connection failure')); });
    expect(screen.queryByRole('button', { name: 'Start Teaching' })).toBeNull();
    expect(screen.queryByText('Your teacher is preparing…')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByRole('button', { name: 'Retry roadmap' }) as HTMLButtonElement).disabled).toBe(false);
    expect(fixture.bridge.loadSession).not.toHaveBeenCalled();
  });

  it('keeps active narration and continuation when refreshing models and removing an inactive provider key', async () => {
    const configuration: TeachingConfiguration = { activeProvider: 'gemini', revision: 1, connections: (['chatgpt', 'gemini', 'groq'] as const).map(providerId => ({ providerId, connected: providerId !== 'chatgpt', hasKey: providerId !== 'chatgpt', model: `${providerId}-model`, modelAvailable: true, models: [{ id: `${providerId}-model`, name: `${providerId} model` }] })) };
    const refreshTeachingModels = vi.fn(async () => configuration), clearTeachingKey = vi.fn(async () => ({ ...configuration, connections: configuration.connections.map(connection => connection.providerId === 'groq' ? { ...connection, connected: false, hasKey: false } : connection) }));
    Object.assign(fixture.bridge, { getTeachingConfiguration: vi.fn(async () => configuration), refreshTeachingModels, clearTeachingKey });
    fixture.bridge.getStatus.mockImplementation(async () => ({ connected: false, planEnabled: false, desktop: true, teachingProvider: 'gemini', teachingConnected: true, teachingReady: true, teachingRevision: 1, model: 'gemini-model', modelAvailable: true }));
    render(<App />);
    await waitFor(() => expect(refreshTeachingModels).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Keep teaching this idea' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    let finishSpeech!: () => void;
    fixture.voice.speak.mockImplementationOnce(() => new Promise<void>(resolve => { finishSpeech = resolve; }));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { id: 'uninterrupted-settings', narration: 'Keep listening to this explanation.', next: 'continue', canvas: { mode: 'replace', entities: [] } } }));
    await waitFor(() => expect(finishSpeech).toBeTypeOf('function'));
    const stops = fixture.audioPlayback.stop.mock.calls.length, voiceStops = fixture.voice.stopSpeaking.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    await screen.findByLabelText('Teaching provider');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));
    await screen.findByText('Teaching models refreshed.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Groq key' }));
    await screen.findByText('Groq API key removed.');
    expect(fixture.audioPlayback.stop).toHaveBeenCalledTimes(stops);
    expect(fixture.voice.stopSpeaking).toHaveBeenCalledTimes(voiceStops);
    expect(fixture.bridge.interrupt).not.toHaveBeenCalled();
    expect(fixture.bridge.saveScene).not.toHaveBeenCalled();
    await act(async () => { finishSpeech(); });
    await waitFor(() => expect(fixture.bridge.continueLesson).toHaveBeenCalledTimes(1));
  });

  it.each(['gemini', 'groq'] as const)('automatically uses %s after key connection for the next lesson with ChatGPT disconnected', async providerId => {
    let configuration: TeachingConfiguration = { activeProvider: 'chatgpt', revision: 0, connections: (['chatgpt', 'gemini', 'groq'] as const).map(id => ({ providerId: id, connected: false, hasKey: false, models: [], modelAvailable: false })) };
    const teachingBridge = {
      getTeachingConfiguration: vi.fn(async () => configuration),
      connectTeachingKey: vi.fn(async () => {
        configuration = { activeProvider: providerId, revision: 1, connections: configuration.connections.map(connection => connection.providerId === providerId ? { ...connection, connected: true, hasKey: true, model: `${providerId}-chosen`, modelAvailable: true, models: [{ id: `${providerId}-chosen`, name: 'Chosen model' }] } : connection) };
        return configuration;
      }),
    };
    Object.assign(fixture.bridge, teachingBridge);
    fixture.bridge.getStatus.mockImplementation(async () => ({ connected: false, planEnabled: false, desktop: true, teachingProvider: configuration.activeProvider, teachingConnected: configuration.activeProvider === providerId, teachingReady: configuration.activeProvider === providerId, teachingRevision: configuration.revision, model: configuration.connections.find(connection => connection.providerId === configuration.activeProvider)?.model }));
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    const name = providerId === 'gemini' ? 'Gemini' : 'Groq';
    const input = await screen.findByLabelText(`${name} API key`);
    await waitFor(() => expect((input as HTMLInputElement).disabled).toBe(false));
    fireEvent.change(input, { target: { value: 'test-only-input' } });
    fireEvent.click(screen.getByRole('button', { name: `Connect ${name}` }));
    await screen.findByText(`${name} selected for your next teaching request.`);
    expect((screen.getByLabelText('Teaching provider') as HTMLSelectElement).value).toBe(providerId);
    expect(screen.getAllByLabelText('Teaching model')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Connect ChatGPT' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy();
    expect(screen.queryByText('ChatGPT connected')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'What makes a rainbow?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    expect(fixture.bridge.signIn).not.toHaveBeenCalled();
  });

  it('refreshes the restored active provider catalog at startup before enabling teaching', async () => {
    const appStatus: AppStatus = { connected: false, planEnabled: false, desktop: true, teachingProvider: 'gemini', teachingConnected: true, teachingReady: false, teachingRevision: 1, model: 'remembered-model', modelAvailable: false };
    fixture.bridge.getStatus.mockImplementation(async () => ({ ...appStatus }));
    const refreshTeachingModels = vi.fn(async () => { appStatus.teachingReady = true; appStatus.modelAvailable = true; return { activeProvider: 'gemini', revision: 1, connections: [] }; });
    Object.assign(fixture.bridge, { refreshTeachingModels });
    render(<App />);
    await waitFor(() => expect(refreshTeachingModels).toHaveBeenCalledWith('gemini'));
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'How does light bend?' } });
    expect(await screen.findByRole('button', { name: 'Create roadmap' })).toBeTruthy();
    expect(fixture.bridge.signIn).not.toHaveBeenCalled();
  });

  it('blocks new generation when active provider is not ready despite a connected ChatGPT account', async () => {
    fixture.bridge.getStatus.mockResolvedValueOnce({ connected: true, planEnabled: true, desktop: true, teachingProvider: 'groq', teachingConnected: true, teachingReady: false, modelAvailable: false });
    render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'What makes a rainbow?' } });
    expect(screen.queryByRole('button', { name: 'Create roadmap' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check teaching model' }));
    await screen.findByRole('dialog');
    expect(fixture.bridge.createSession).not.toHaveBeenCalled();
    expect(fixture.bridge.signIn).not.toHaveBeenCalled();
  });

  it('uses a ready API provider for roadmap, teaching, questions and automatic continuation without ChatGPT', async () => {
    fixture.bridge.getStatus.mockResolvedValueOnce({ connected: false, planEnabled: false, desktop: true, teachingProvider: 'groq', teachingConnected: true, teachingReady: true, model: 'groq-model', modelAvailable: true } as AppStatus);
    render(<App />);
    await waitFor(() => expect(fixture.bridge.getSessions).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Why does bread rise?' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { id: 'api-continue', narration: 'Now we can build on that.', next: 'continue', canvas: { mode: 'replace', entities: [] } } }));
    await waitFor(() => expect(fixture.bridge.continueLesson).toHaveBeenCalledWith({ sessionId: fixture.session.id, epoch: 1 }));
    act(() => fixture.state.listener?.({ type: 'done', sessionId: fixture.session.id, epoch: 1 }));
    fireEvent.change(screen.getByLabelText('Ask your teacher a question'), { target: { value: 'What does yeast do?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(fixture.bridge.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ text: 'What does yeast do?' })));
    expect(screen.queryByText('ChatGPT connected')).toBeNull();
  });

  it('opens masked Gemini and Groq connections in Settings without replacing ChatGPT sign-in', async () => {
    const configuration: TeachingConfiguration = { activeProvider: 'chatgpt', revision: 0, connections: ['chatgpt', 'gemini', 'groq'].map(providerId => ({ providerId: providerId as 'chatgpt' | 'gemini' | 'groq', connected: false, hasKey: false, models: [], modelAvailable: false })) };
    Object.assign(fixture.bridge, { getTeachingConfiguration: vi.fn(async () => configuration) });
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect((await screen.findByLabelText('Gemini API key') as HTMLInputElement).type).toBe('password');
    expect((screen.getByLabelText('Groq API key') as HTMLInputElement).type).toBe('password');
    expect(screen.getByRole('button', { name: 'Connect ChatGPT' })).toBeTruthy();
    Reflect.deleteProperty(fixture.bridge, 'getTeachingConfiguration');
  });

  it.each(['save', 'navigate', 'close', 'note'] as const)('preserves acknowledged simulation when partial review is saved through %s and reopened', async operation => {
    fixture.state.connected = true;
    const artifact = { id: 'durable-program', title: 'Acknowledged experiment', source: 'test-only', controls: [{ id: 'mass', label: 'Mass', type: 'slider' as const, min: 1, max: 3, value: 1 }], assumptions: [], validation: 'illustrative' as const };
    const teacher: SceneEntity = { id: 'durable-teacher', kind: 'text', x: 10, y: 10, text: 'Keep the accepted board' };
    const dynamic: SceneEntity = { id: 'sim:original-run:0', kind: 'circle', x: 20, y: 20 };
    const note: SceneEntity = { id: 'durable-note', kind: 'text', x: 30, y: 30, text: 'My earlier note', semanticRole: 'learner-note' };
    const beat = { id: 'durable-beat', narration: 'The acknowledged explanation.', chunks: [{ id: 'durable-chunk', text: 'The acknowledged explanation.' }], cues: [], next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [teacher] }, simulation: artifact };
    const simulation: SimulationCheckpoint = { artifact, tick: 20, state: { tick: 20 }, values: { mass: 2 }, initialValues: { mass: 1 }, inputs: [{ tick: 10, values: { mass: 2 } }] };
    const checkpoint = { cursor: { beatId: beat.id, chunkId: 'durable-chunk', offsetSeconds: .5, passId: 'accepted-pass' }, completedChunkIds: ['durable-chunk'], appliedCueIds: [], baselineScene: [teacher], visibleScene: [teacher, dynamic], simulation };
    let stored: LessonSession = { ...fixture.session, title: 'Saved experiment', scene: [teacher, dynamic, note], controls: { mass: 2 }, simulation, beats: [beat], playback: checkpoint };
    fixture.bridge.getSessions.mockImplementation(async () => [{ id: stored.id, title: stored.title, topic: stored.topic, updatedAt: stored.updatedAt, messageCount: stored.messages.length }]);
    fixture.bridge.loadSession.mockImplementation(async () => structuredClone(stored));
    fixture.bridge.saveScene.mockImplementation(async value => { const input = value as { scene: SceneEntity[]; controls?: Record<string, number | boolean | string>; simulation?: SimulationCheckpoint }; stored = { ...stored, scene: structuredClone(input.scene), controls: structuredClone(input.controls ?? stored.controls), simulation: structuredClone(input.simulation ?? stored.simulation) }; });
    fixture.bridge.runSimulation.mockImplementation(async value => { const input = value as { tick: number }; return { state: { tick: input.tick }, entities: [{ id: 'moving', kind: 'circle', x: input.tick, y: 20 }] }; });
    fixture.bridge.resumePlayback.mockResolvedValueOnce({ beat, checkpoint, epoch: 5, mode: 'replay' });
    let finishReview: ((result: AudioResult) => void) | undefined;
    fixture.audioPlayback.play.mockImplementationOnce(async (_chunk, cursor, callbacks) => {
      callbacks?.onFrame?.({ cursor, offsetSeconds: .05, durationSeconds: .1, progress: .5, estimated: false });
      return new Promise<AudioResult>(resolve => { finishReview = resolve; });
    });
    const view = render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Saved experiment' }));
    await screen.findByLabelText('Experiment controls');
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(finishReview).toBeTypeOf('function'));
    await waitFor(() => expect(fixture.bridge.runSimulation.mock.calls.some(call => { const input = call[0] as { action: string; tick: number }; return input.action === 'step' && input.tick === 2; })).toBe(true));
    fixture.audioPlayback.pause.mockImplementationOnce(async () => { finishReview?.('paused'); return 'paused'; });
    fireEvent.click(screen.getByRole('button', { name: 'Pause teaching' }));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false));
    if (operation === 'note') fireEvent.click(screen.getByRole('button', { name: 'Test edit canvas' }));
    if (operation === 'close') act(() => fixture.state.listener?.({ type: 'closing' }));
    else if (operation === 'navigate') fireEvent.click(screen.getByRole('button', { name: 'My space' }));
    else fireEvent.click(screen.getByRole('button', { name: operation === 'note' ? 'Save edits' : 'Save' }));
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalled());
    if (operation === 'close') await waitFor(() => expect(fixture.bridge.readyToClose).toHaveBeenCalledTimes(1));
    if (operation === 'navigate') await screen.findByRole('button', { name: /Start learning/ });
    expect(stored.simulation).toEqual(simulation);
    expect(stored.controls).toEqual({ mass: 2 });
    expect(stored.scene.map(entity => entity.id)).toEqual(['durable-teacher', 'sim:original-run:0', operation === 'note' ? 'note-test' : 'durable-note']);
    expect(fixture.bridge.savePlayback).not.toHaveBeenCalled();
    expect(fixture.bridge.presentProgress).not.toHaveBeenCalled();
    view.unmount();
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Saved experiment' }));
    await screen.findByLabelText('Experiment controls');
    const reopened = fixture.bridge.runSimulation.mock.calls.at(-1)?.[0] as { replay?: SimulationCheckpoint; values: Record<string, number> };
    expect(reopened.replay?.tick).toBe(20);
    expect(reopened.values.mass).toBe(2);
  });

  it('returns to a fully heard branch as review without saving or continuing it', async () => {
    fixture.state.connected = true;
    const beat = { id: 'heard-branch', conceptId: 'first-concept', narration: 'Previously heard. Fully heard.', chunks: [{ id: 'heard-a', text: 'Previously heard.' }, { id: 'heard-b', text: ' Fully heard.' }], cues: [], next: 'continue' as const, canvas: { mode: 'append' as const, entities: [{ id: 'accepted-object', kind: 'circle' as const, x: 10, y: 10 }] } };
    const checkpoint = { cursor: { beatId: beat.id, chunkId: 'heard-b', offsetSeconds: .1, passId: 'original-pass' }, baselineScene: beat.canvas.entities, visibleScene: beat.canvas.entities, completedChunkIds: ['heard-a', 'heard-b'], appliedCueIds: [] };
    const branchSession: LessonSession = { ...fixture.session, beats: [beat], scene: beat.canvas.entities, messages: [{ id: beat.id, role: 'tutor', text: beat.narration, createdAt: fixture.session.createdAt }], playback: checkpoint, learningProgress: { ...fixture.session.learningProgress!, conceptStates: { 'first-concept': 'completed' }, status: 'paused', branchReturnPoint: checkpoint.cursor } };
    fixture.bridge.loadSession.mockResolvedValueOnce(branchSession).mockResolvedValueOnce(branchSession).mockResolvedValueOnce(branchSession).mockResolvedValueOnce({ ...branchSession, learningProgress: { ...branchSession.learningProgress!, branchReturnPoint: undefined } });
    fixture.bridge.returnToLesson.mockResolvedValueOnce({ beat, checkpoint, epoch: 7, mode: 'replay' });
    render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Return to my lesson' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    await screen.findByRole('button', { name: 'Back to lesson' });
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { id: 'branch-experiment', narration: 'An experiment for your follow-up.', next: 'ask', canvas: { mode: 'replace', entities: [] }, simulation: { id: 'branch-program', title: 'Branch experiment', source: 'test-only', controls: [], assumptions: [], validation: 'illustrative' } } }));
    await screen.findByText('Teaching step heard');
    await waitFor(() => expect(fixture.bridge.loadSession).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Experiment controls')).toBeTruthy();
    const savedCount = fixture.bridge.savePlayback.mock.calls.length, progressCount = fixture.bridge.presentProgress.mock.calls.length;
    fireEvent.click(await screen.findByRole('button', { name: 'Back to lesson' }));
    await waitFor(() => expect(fixture.bridge.returnToLesson).toHaveBeenCalledWith({ sessionId: fixture.session.id }));
    await waitFor(() => expect(fixture.audioPlayback.play).toHaveBeenCalledTimes(3));
    await screen.findByText('Teaching step heard');
    expect(fixture.audioPlayback.play.mock.calls.slice(1).map(call => call[0].id)).toEqual(['heard-a', 'heard-b']);
    expect(fixture.bridge.savePlayback).toHaveBeenCalledTimes(savedCount);
    expect(fixture.bridge.presentProgress).toHaveBeenCalledTimes(progressCount);
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Back to lesson' })).toBeNull();
    expect(screen.getByText('1 of 1 concepts covered')).toBeTruthy();
    expect(screen.queryByLabelText('Experiment controls')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    expect(screen.getAllByText(beat.narration)).toHaveLength(1);
  });

  it('keeps unavailable audio retryable without inventing heard progress', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A voice test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    fixture.audioPlayback.play.mockResolvedValueOnce('unavailable');
    const beat = { id: 'unavailable-audio', narration: 'This was never heard.', next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }));
    expect(await screen.findByRole('button', { name: 'Retry teaching' })).toBeTruthy();
    expect(screen.queryByText(beat.narration)).toBeNull();
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    expect(fixture.bridge.presentProgress.mock.calls.every(call => !call[0]?.complete)).toBe(true);
  });

  it('does not acknowledge a tween that extends beyond actually played audio', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A visual test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    const beat = { id: 'unfinished-tween', narration: 'A short audio chunk.', chunks: [{ id: 'short-chunk', text: 'A short audio chunk.' }], cues: [{ id: 'long-tween', chunkId: 'short-chunk', at: 'start' as const, action: { type: 'tween' as const, targetId: 'object', property: 'x' as const, from: 0, to: 100, durationMs: 60000 } }], next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [{ id: 'object', kind: 'circle' as const, x: 0, y: 0 }] } };
    await act(async () => { fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }); });
    expect((await screen.findByRole('alert')).textContent).toContain('A teaching visual did not finish with the audio');
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    expect(fixture.bridge.presentProgress.mock.calls.every(call => !call[0]?.complete)).toBe(true);
  });

  it.each([true, false])('pauses audible teaching without interrupting its request and gates resumed continuation on readiness %s', async ready => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Pause and resume' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    let releaseSpeech!: () => void;
    fixture.voice.speak.mockImplementationOnce(() => new Promise<void>(resolve => { releaseSpeech = resolve; }));
    const beat = { id: 'paused-audio', narration: 'A teaching chunk with a real audio result.', next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }));
    await waitFor(() => expect(releaseSpeech).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button', { name: 'Pause teaching' }));
    await waitFor(() => expect(fixture.audioPlayback.pause).toHaveBeenCalledTimes(1));
    expect(fixture.bridge.interrupt).not.toHaveBeenCalled();
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByRole('button', { name: 'Resume teaching' }) as HTMLButtonElement).disabled).toBe(false));
    act(() => fixture.state.listener?.({ type: 'auth', status: { connected: true, planEnabled: true, desktop: true, teachingProvider: 'groq', teachingConnected: true, teachingReady: ready } }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume teaching' }));
    await waitFor(() => expect(fixture.audioPlayback.resume).toHaveBeenCalledTimes(1));
    if (ready) await waitFor(() => expect(fixture.bridge.continueLesson).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(fixture.bridge.presentProgress).toHaveBeenLastCalledWith(expect.objectContaining({ beatId: beat.id, narration: beat.narration, complete: true })));
    expect(fixture.bridge.presentProgress).toHaveBeenLastCalledWith(expect.objectContaining({ beatId: beat.id, narration: beat.narration, complete: true }));
    await act(async () => { releaseSpeech(); });
    expect(fixture.bridge.continueLesson).toHaveBeenCalledTimes(ready ? 1 : 0);
  });

  it('replays accepted content without saving progress, duplicating messages, or continuing', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'Replay this' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    const beat = { id: 'review-audio', narration: 'The accepted teaching content.', next: 'ask' as const, canvas: { mode: 'replace' as const, entities: [] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }));
    await screen.findByText('Teaching step heard');
    const savedCount = fixture.bridge.savePlayback.mock.calls.length, progressCount = fixture.bridge.presentProgress.mock.calls.length;
    fixture.bridge.resumePlayback.mockResolvedValueOnce({ beat, epoch: 2, mode: 'replay', checkpoint: { cursor: { beatId: beat.id, chunkId: 'review-audio:chunk:1', offsetSeconds: 0, passId: 'saved-pass' }, baselineScene: [], visibleScene: [], completedChunkIds: ['review-audio:chunk:1'], appliedCueIds: [] } });
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    await waitFor(() => expect(fixture.audioPlayback.play).toHaveBeenCalledTimes(2));
    await screen.findByText('Teaching step heard');
    expect(fixture.bridge.savePlayback).toHaveBeenCalledTimes(savedCount);
    expect(fixture.bridge.presentProgress).toHaveBeenCalledTimes(progressCount);
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
    expect(screen.getAllByText(beat.narration)).toHaveLength(1);
  });

  it('plans a topic before teaching and leaves the transcript collapsed', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'My exact topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    await screen.findByRole('button', { name: 'Start Teaching' });
    expect(fixture.bridge.createSession).toHaveBeenCalledWith('My exact topic',expect.any(String));
    expect(fixture.bridge.planTopic).toHaveBeenCalledWith({ sessionId: fixture.session.id });
    expect(fixture.bridge.startConcept).not.toHaveBeenCalled();
    expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Lesson conversation')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Start Teaching' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledWith({ sessionId: fixture.session.id, conceptId: 'first-concept' }));
  });

  it('shows material coverage before an outline and opens the planned course lesson', async () => {
    fixture.state.connected = true;
    const document: DocumentManifest = { id: 'material', name: 'My notes.pdf', mimeType: 'application/pdf', byteSize: 100, sha256: 'a'.repeat(64), extractionVersion: 1, status: 'partial', pages: [{ index: 1, status: 'extracted', sectionIds: ['section'] }, { index: 2, status: 'empty', sectionIds: [] }], coverage: .5, warnings: ['Page 2 has no readable text.'], createdAt: '2026-10-22T00:00:00Z' };
    const course: CourseRecord = { id: 'course', title: 'My course', documentIds: [document.id], plan: fixture.plan, progress: fixture.session.learningProgress!, sessionIds: [], lessons: [{ id: 'lesson-1', title: 'First lesson', objectives: ['Explore the text'], conceptIds: ['first-concept'], sourceRefs: [] }], createdAt: '2026-10-22T00:00:00Z', updatedAt: '2026-10-22T00:00:00Z' };
    fixture.bridge.importStudyMaterial.mockResolvedValueOnce([document]); fixture.bridge.planCourse.mockResolvedValueOnce(course); fixture.bridge.startCourseLesson.mockResolvedValueOnce(fixture.session);
    render(<App />); await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload Study Material' }));
    expect(await screen.findByText('50% readable · partial')).toBeTruthy();
    expect(screen.getByText('Page 2 has no readable text.')).toBeTruthy();
    expect(fixture.bridge.planCourse).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Create course outline' }));
    await screen.findByText('First lesson');
    expect(fixture.bridge.planCourse).toHaveBeenCalledWith({ documentIds: ['material'] });
    fireEvent.click(screen.getByRole('button', { name: 'Open lesson' }));
    await screen.findByRole('button', { name: 'Start Teaching' });
    expect(fixture.bridge.startCourseLesson).toHaveBeenCalledWith({ courseId: 'course', lessonId: 'lesson-1' });
    expect(fixture.bridge.startConcept).not.toHaveBeenCalled();
  });

  it('restores a saved course experiment without persisting duplicate old simulation marks', async () => {
    fixture.state.connected = true;
    const artifact = { id: 'course-model', title: 'Course experiment', source: 'test-only', controls: [{ id: 'mass', label: 'Mass', type: 'slider' as const, value: 1, min: 1, max: 5 }], assumptions: [], validation: 'illustrative' as const };
    const simulation: SimulationCheckpoint = { artifact, tick: 0, state: { mass: 2 }, values: { mass: 2 }, initialValues: { mass: 1 }, inputs: [{ tick: 0, values: { mass: 2 } }] };
    const stored: LessonSession = { ...fixture.session, id: 'saved-course-session', title: 'Saved course experiment', controls: { mass: 2 }, simulation, scene: [{ id: 'course-teacher', kind: 'text', x: 20, y: 20, text: 'Accepted course diagram' }, { id: 'sim:old-course-run:0', kind: 'circle', x: 200, y: 100 }, { id: 'course-note', kind: 'text', x: 20, y: 60, text: 'Keep this learner note', semanticRole: 'learner-note' }] };
    const course: CourseRecord = { id: 'saved-course', title: 'Saved course with an experiment', documentIds: ['course-material'], plan: fixture.plan, progress: fixture.session.learningProgress!, sessionIds: [stored.id], lessons: [{ id: 'course-lesson', title: 'A saved experiment lesson', objectives: ['Explore the saved model'], conceptIds: ['first-concept'], sourceRefs: [] }], createdAt: stored.createdAt, updatedAt: stored.updatedAt };
    fixture.bridge.getCourses.mockResolvedValueOnce([course]); fixture.bridge.loadCourse.mockResolvedValueOnce(course); fixture.bridge.startCourseLesson.mockResolvedValueOnce(stored);
    fixture.bridge.runSimulation.mockImplementation(async value => { const input = value as { values: { mass: number } }; return { state: { mass: input.values.mass }, entities: [{ id: 'course-body', kind: 'circle', x: input.values.mass * 100, y: 100 }] }; });
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: /Start learning/ }));
    fireEvent.click(await screen.findByRole('button', { name: course.title }));
    fireEvent.click(await screen.findByRole('button', { name: 'Open lesson' }));
    await screen.findByLabelText('Experiment controls');
    await waitFor(() => expect(fixture.bridge.runSimulation).toHaveBeenCalledWith(expect.objectContaining({ action: 'init', replay: simulation, values: { mass: 2 } })));
    fireEvent.change(screen.getByRole('slider'), { target: { value: '3' } });
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save edits' }) as HTMLButtonElement).disabled).toBe(false));
    fixture.bridge.saveScene.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Save edits' }));
    await waitFor(() => expect(fixture.bridge.saveScene).toHaveBeenCalledTimes(1));
    const saved = fixture.bridge.saveScene.mock.calls[0][0] as { scene: SceneEntity[]; simulation: SimulationCheckpoint };
    expect(saved).toMatchObject({ sessionId: stored.id, controls: { mass: 3 }, simulation: { values: { mass: 3 }, state: { mass: 3 }, inputs: [{ tick: 0, values: { mass: 2 } }, { tick: 0, values: { mass: 3 } }] } });
    expect(saved.scene.some(entity => entity.id === 'sim:old-course-run:0')).toBe(false);
    expect(saved.scene.filter(entity => entity.id.startsWith('sim:'))).toEqual([expect.objectContaining({ kind: 'circle', x: 300, y: 100 })]);
    expect(saved.scene.map(entity => entity.id)).toEqual(expect.arrayContaining(['course-teacher', 'course-note']));
    expect(fixture.bridge.startConcept).not.toHaveBeenCalled(); expect(fixture.bridge.presentProgress).not.toHaveBeenCalled();
  });

  it('recovers an unavailable teaching model without losing the topic', async () => {
    fixture.state.connected = true; fixture.state.modelAvailable = false; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'My retained topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Check teaching model' }));
    expect(await screen.findByLabelText('Teaching model')).toBeTruthy();
    expect(fixture.bridge.planTopic).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect((screen.getByLabelText('What would you like to learn today?') as HTMLTextAreaElement).value).toBe('My retained topic');
  });

  it('awaits the active inference pause and checkpoint before selecting another model', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'status', sessionId: fixture.session.id, epoch: 1, phase: 'thinking' }));
    let releasePause!: () => void;
    fixture.bridge.interrupt.mockImplementationOnce(() => new Promise<void>((resolve) => { releasePause = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    const selector = await screen.findByLabelText('Teaching model');
    await waitFor(() => expect((selector as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(selector, { target: { value: 'model-two' } });
    expect(fixture.bridge.setModel).not.toHaveBeenCalled();
    await waitFor(() => expect(releasePause).toBeTypeOf('function'));
    expect(screen.queryByText('Finding a way in…')).toBeNull();
    await act(async () => { releasePause(); });
    await waitFor(() => expect(fixture.bridge.setModel).toHaveBeenCalledWith('model-two'));
    expect(fixture.bridge.saveScene.mock.invocationCallOrder.at(-1)).toBeLessThan(fixture.bridge.setModel.mock.invocationCallOrder[0]);
    expect(screen.getByText('Take a moment. Ask when you’re ready.')).toBeTruthy();
  });

  it('cancels queued narration and waits for its checkpoint before changing models', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    let finishSpeech!: () => void;
    fixture.voice.speak.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise<void>(resolve => { finishSpeech = resolve; }));
    const beat = { id: 'model-presentation', narration: 'First sentence. Obsolete final sentence.', chunks: [{ id: 'heard-first', text: 'First sentence.' }, { id: 'unheard-last', text: ' Obsolete final sentence.' }], cues: [], next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [{ id: 'visible-model-object', kind: 'text' as const, x: 10, y: 10 }] } };
    act(() => {
      fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat });
      fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { ...beat, id: 'queued-model-beat', narration: 'Obsolete queued narration.' } });
    });
    await screen.findByText('First sentence.');
    await waitFor(() => expect(finishSpeech).toBeTypeOf('function'));
    let finishCheckpoint!: () => void;
    fixture.bridge.saveScene.mockImplementationOnce(() => new Promise<void>((resolve) => { finishCheckpoint = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    const selector = await screen.findByLabelText('Teaching model');
    await waitFor(() => expect((selector as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(selector, { target: { value: 'model-two' } });
    await waitFor(() => expect(finishCheckpoint).toBeTypeOf('function'));
    expect(fixture.bridge.setModel).not.toHaveBeenCalled();
    await act(async () => { finishSpeech(); });
    expect(screen.queryByText(beat.narration)).toBeNull();
    expect(screen.queryByText('Obsolete queued narration.')).toBeNull();
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    await act(async () => { finishCheckpoint(); });
    await waitFor(() => expect(fixture.bridge.setModel).toHaveBeenCalledWith('model-two'));
    expect(screen.getByText('visible-model-object')).toBeTruthy();
    expect(fixture.bridge.presentProgress.mock.calls.at(-1)?.[0]).toMatchObject({ narration: 'First sentence.', complete: false });
  });

  it('stops local presentation when global cancellation reports a terminal paused epoch', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    let finishSpeech!: () => void;
    fixture.voice.speak.mockImplementationOnce(async () => {}).mockImplementationOnce(() => new Promise<void>(resolve => { finishSpeech = resolve; }));
    let rejectProgress!: (error: Error) => void;
    fixture.bridge.presentProgress.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectProgress = reject; }));
    const beat = { id: 'globally-canceled', narration: 'Heard prefix. This suffix was canceled.', chunks: [{ id: 'heard-prefix', text: 'Heard prefix.' }, { id: 'unheard-suffix', text: ' This suffix was canceled.' }], cues: [], next: 'continue' as const, canvas: { mode: 'replace' as const, entities: [] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }));
    await screen.findByText('Heard prefix.');
    await waitFor(() => expect(rejectProgress).toBeTypeOf('function'));
    act(() => fixture.state.listener?.({ type: 'status', sessionId: fixture.session.id, epoch: 2, phase: 'paused' }));
    await act(async () => { rejectProgress(new Error('Presentation progress belongs to a stale lesson turn.')); finishSpeech?.(); });
    expect(screen.queryByText(beat.narration)).toBeNull();
    expect(screen.getByText('Heard prefix.')).toBeTruthy();
    expect(screen.getByText('Take a moment. Ask when you’re ready.')).toBeTruthy();
    expect(fixture.bridge.continueLesson).not.toHaveBeenCalled();
    expect(fixture.bridge.presentProgress).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps a recognized initial topic editable before beginning a lesson', async () => {
    fixture.state.connected = true; fixture.state.recognitionReady = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    await screen.findByLabelText('What would you like to learn today?');
    act(() => { fixture.voiceCallbacks.onDraft?.('I want to understand cavitation'); fixture.voiceCallbacks.onFinal?.('I want to understand cavitation'); });
    expect((screen.getByLabelText('What would you like to learn today?') as HTMLTextAreaElement).value).toBe('I want to understand cavitation');
    expect(fixture.bridge.createSession).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('What would you like to learn today?'), { target: { value: 'I want to understand gravitation' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.createSession).toHaveBeenCalledWith('I want to understand gravitation',expect.any(String)));
  });

  it('shows speech drafts and automatically sends finalized questions while keeping voice enabled', async () => {
    fixture.state.connected = true; fixture.state.recognitionReady = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'done', sessionId: fixture.session.id, epoch: 1 }));
    fireEvent.click(screen.getByRole('button', { name: 'Start voice conversation' }));
    act(() => { fixture.voiceCallbacks.onSpeechStart?.(); fixture.voiceCallbacks.onDraft?.('Could you explain that'); });
    expect((screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement).value).toBe('Could you explain that');
    act(() => fixture.voiceCallbacks.onFinal?.('Could you explain that differently?'));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel & edit' }));
    await new Promise((resolve) => setTimeout(resolve, 750));
    expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1);
    act(() => fixture.voiceCallbacks.onFinal?.('Could you explain that differently?'));
    await waitFor(() => expect(fixture.bridge.sendMessage).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(fixture.bridge.sendMessage.mock.calls.at(-1)?.[0]).toMatchObject({ text: 'Could you explain that differently?' });
    expect(screen.getByRole('button', { name: 'Turn voice conversation off' })).toBeTruthy();
  });

  it('continues a teacher-led lesson after a completed beat without inventing a learner message', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { id: 'continue-one', narration: 'Let us build on that idea.', next: 'continue', canvas: { mode: 'replace', entities: [] } } }));
    await waitFor(() => expect(fixture.bridge.continueLesson).toHaveBeenCalledWith({ sessionId: fixture.session.id, epoch: 1 }));
    expect(fixture.bridge.continueLesson).toHaveBeenCalledTimes(1); expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1);
  });
  it('lets a disconnected learner enter any topic without starting fake inference', async () => {
    render(<App />);
    await screen.findByText('Not connected');
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    const input = await screen.findByLabelText('What would you like to learn today?');
    fireEvent.change(input, { target: { value: 'Why does bread rise?' } });
    expect(screen.getByRole('button', { name: 'Choose teaching connection' })).toBeTruthy();
    expect(fixture.bridge.createSession).not.toHaveBeenCalled();
    expect(fixture.bridge.sendMessage).not.toHaveBeenCalled();
    expect((input as HTMLTextAreaElement).value).toBe('Why does bread rise?');
  });

  it('starts one real request, ignores foreign and superseded events, preserves the scene on pause', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    const beat = { id: 'beat-one', narration: 'Real bridge test narration', canvas: { mode: 'replace' as const, entities: [{ id: 'visible-object', kind: 'text' as const, x: 10, y: 10, text: 'Visible' }] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: 'other-session', epoch: 9, beat }));
    expect(screen.queryByText('Real bridge test narration')).toBeNull();
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 2, beat }));
    expect(await screen.findByText('Real bridge test narration')).toBeTruthy();
    expect(screen.getByText('visible-object')).toBeTruthy();
    // Merely receiving a drawing never autosaves or interrupts the teacher.
    await new Promise((resolve) => setTimeout(resolve, 650));
    expect(fixture.bridge.saveScene).not.toHaveBeenCalled();
    act(() => fixture.state.listener?.({ type: 'status', sessionId: fixture.session.id, epoch: 2, phase: 'thinking' }));
    fireEvent.change(screen.getByLabelText('Ask your teacher a question'), { target: { value: 'Wait, explain that differently.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    await waitFor(() => expect(fixture.bridge.interrupt).toHaveBeenCalledWith(fixture.session.id));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 2, beat: { ...beat, id: 'late-beat', narration: 'Late stale text', canvas: { mode: 'replace', entities: [] } } }));
    expect(screen.queryByText('Late stale text')).toBeNull();
    expect(screen.getByText('visible-object')).toBeTruthy();
  });

  it('retains a failed question and the visible canvas for retry', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'done', sessionId: fixture.session.id, epoch: 1 }));
    fixture.bridge.sendMessage.mockRejectedValueOnce(new Error('Network unavailable'));
    fireEvent.change(screen.getByLabelText('Ask your teacher a question'), { target: { value: 'Could you use another example?' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Ask your teacher a question') as HTMLTextAreaElement).value).toBe('Could you use another example?');
    expect(screen.getByTestId('canvas')).toBeTruthy();
  });

  it('blocks late beats immediately while a completed presentation acknowledgement is pending', async () => {
    let finishAcknowledgement!: () => void;
    fixture.bridge.presentProgress.mockImplementation(async (input?: { complete?: boolean }) => {
      if (input?.complete) await new Promise<void>((resolve) => { finishAcknowledgement = resolve; });
    });
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    const beat = { id: 'ack-pending', narration: 'A sentence that has played.', canvas: { mode: 'replace' as const, entities: [{ id: 'ack-object', kind: 'text' as const, x: 10, y: 10 }] } };
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat }));
    await waitFor(() => expect(finishAcknowledgement).toBeTypeOf('function'));
    fireEvent.change(screen.getByLabelText('Ask your teacher a question'), { target: { value: 'Pause this explanation for my question.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send question' }));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { ...beat, id: 'late-during-ack', narration: 'This must never appear.' } }));
    expect(screen.queryByText('This must never appear.')).toBeNull();
    await act(async () => { finishAcknowledgement(); });
    await waitFor(() => expect(fixture.bridge.interrupt).toHaveBeenCalledWith(fixture.session.id));
    expect(screen.queryByText('This must never appear.')).toBeNull();
    expect(screen.getByText('ack-object')).toBeTruthy();
    fixture.bridge.presentProgress.mockImplementation(async () => {});
  });

  it('checkpoints an otherwise clean lesson before exporting it', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'done', sessionId: fixture.session.id, epoch: 1 }));
    expect(fixture.bridge.saveScene).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Export lesson' }));
    await waitFor(() => expect(fixture.bridge.exportLesson).toHaveBeenCalledWith(fixture.session.id));
    expect(fixture.bridge.saveScene.mock.invocationCallOrder[0]).toBeLessThan(fixture.bridge.exportLesson.mock.invocationCallOrder[0]);
  });

  it('saves an advancing experiment on OS close and acknowledges close only once', async () => {
    fixture.state.connected = true; render(<App />);
    await waitFor(() => expect(window.document.querySelector('.connection-pill.connected')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Start learning/ }));
    fireEvent.change(await screen.findByLabelText('What would you like to learn today?'), { target: { value: 'A fresh topic' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create roadmap' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Start Teaching' }));
    fireEvent.click(screen.getByRole('button', { name: 'Toggle conversation' }));
    await waitFor(() => expect(fixture.bridge.startConcept).toHaveBeenCalledTimes(1));
    act(() => fixture.state.listener?.({ type: 'beat', sessionId: fixture.session.id, epoch: 1, beat: { id: 'close-experiment', narration: 'Watch this experiment.', canvas: { mode: 'replace', entities: [] }, simulation: { id: 'close-program', title: 'Experiment', source: 'test-only', controls: [], assumptions: [], validation: 'illustrative' } } }));
    await waitFor(() => expect(fixture.bridge.runSimulation.mock.calls.length).toBeGreaterThan(2));
    expect(fixture.bridge.saveScene).not.toHaveBeenCalled();
    act(() => { fixture.state.listener?.({ type: 'closing' }); fixture.state.listener?.({ type: 'closing' }); });
    await waitFor(() => expect(fixture.bridge.readyToClose).toHaveBeenCalledTimes(1));
    expect(fixture.bridge.saveScene).toHaveBeenCalled();
    const saved = fixture.bridge.saveScene.mock.calls.at(-1)?.[0] as unknown as { simulation?: { tick: number } };
    expect(saved.simulation?.tick).toBeGreaterThan(0);
    expect(fixture.bridge.saveScene.mock.invocationCallOrder.at(-1)).toBeLessThan(fixture.bridge.readyToClose.mock.invocationCallOrder[0]);
  });
});

describe('atomic scene updates', () => {
  it('updates stable objects and preserves learner notes on an append', () => {
    const result = applyBeat([{ id: 'a', kind: 'circle', x: 1, y: 2 }, { id: 'note', kind: 'text', x: 20, y: 20, text: 'Keep this' }], { id: 'b', narration: 'Update', canvas: { mode: 'append', entities: [{ id: 'a', kind: 'circle', x: 100, y: 2 }, { id: 'new', kind: 'rect', x: 0, y: 0 }] } });
    expect(result.map((entity) => entity.id)).toEqual(['a', 'note', 'new']);
    expect(result[0].x).toBe(100);
  });
});
