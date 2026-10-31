// @vitest-environment jsdom
import React from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {LessonNotesRecord,LessonSession} from '@living-canvas/protocol';
const fixture=vi.hoisted(()=>({bridge:{getLessonNotes:vi.fn(),generateLessonNotes:vi.fn(),cancelLessonNotes:vi.fn(),openLessonNotes:vi.fn(),exportLessonNotes:vi.fn()}}));
vi.mock('../bridge',()=>({bridge:fixture.bridge}));
import LessonNotes from './LessonNotes';
const session:LessonSession={id:'lesson-one',title:'Gravity',topic:'Gravity',createdAt:'2026-10-31T00:00:00Z',updatedAt:'2026-10-31T00:00:00Z',messages:[{id:'heard-one',role:'tutor',text:'Mass attracts other mass.',createdAt:'2026-10-31T00:00:00Z'}],beats:[],scene:[],controls:{}};
const saved:LessonNotesRecord={id:'11111111-1111-4111-8111-111111111111',sessionId:session.id,title:'Gravity study notes',createdAt:'2026-10-31T00:00:00Z',studiedSteps:1,providerId:'gemini',requestedModel:'gemini-example'};
const props=()=>({session,desktop:true,canGenerate:true,connectionKey:'gemini:one',beforeGenerate:vi.fn(async()=>session)});
beforeEach(()=>{vi.resetAllMocks();fixture.bridge.getLessonNotes.mockResolvedValue(null);fixture.bridge.cancelLessonNotes.mockResolvedValue(undefined);fixture.bridge.openLessonNotes.mockResolvedValue(undefined);fixture.bridge.exportLessonNotes.mockResolvedValue({canceled:false,path:'fixture.pdf'});});
afterEach(cleanup);
describe('lesson notes controls',()=>{
  it('creates offline notes explicitly without a teaching connection or a failed AI attempt',async()=>{
    fixture.bridge.generateLessonNotes.mockResolvedValue({...saved,providerId:'local',requestedModel:'local-extract'});
    const initial=props();render(<LessonNotes {...initial} canGenerate={false}/>);
    fireEvent.click(screen.getByRole('button',{name:'Create notes offline'}));
    await screen.findByRole('button',{name:'Open PDF'});
    expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:session.id,mode:'local'});
    expect(initial.beforeGenerate).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Offline study record ready · 1 studied step')).toBeTruthy();
  });
  it('requires a presented explanation without requiring completion of the roadmap',async()=>{
    const initial=props();const {rerender}=render(<LessonNotes {...initial} session={{...session,messages:[]}}/>);
    await waitFor(()=>expect(fixture.bridge.getLessonNotes).toHaveBeenCalledWith(session.id));
    expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Study part of this lesson to generate notes.')).toBeTruthy();
    rerender(<LessonNotes {...initial}/>);
    expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText('Uses your selected AI service.')).toBeTruthy();expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
  });
  it('waits for checkpoint/save and reload before one explicit generation, even after repeated clicks',async()=>{
    let finishPreparation!:(value:LessonSession)=>void;const initial=props();
    initial.beforeGenerate.mockImplementation(()=>new Promise(resolve=>{finishPreparation=resolve;}));fixture.bridge.generateLessonNotes.mockResolvedValue(saved);
    render(<LessonNotes {...initial}/>);const button=screen.getByRole('button',{name:'Generate notes'});fireEvent.click(button);fireEvent.click(button);
    expect(initial.beforeGenerate).toHaveBeenCalledTimes(1);expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
    await act(async()=>{finishPreparation(session);});await screen.findByRole('button',{name:'Open PDF'});
    expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:session.id});expect(screen.getByText('Notes ready · 1 studied step')).toBeTruthy();
  });
  it('opens and exports the saved PDF offline without generating again',async()=>{
    fixture.bridge.getLessonNotes.mockResolvedValue(saved);const initial=props();render(<LessonNotes {...initial} canGenerate={false}/>);
    fireEvent.click(await screen.findByRole('button',{name:'Open PDF'}));await waitFor(()=>expect(fixture.bridge.openLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:session.id,notesId:saved.id}));
    fireEvent.click(screen.getByRole('button',{name:'Save PDF'}));await screen.findByText('PDF saved.');
    expect(fixture.bridge.exportLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:session.id,notesId:saved.id});expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();expect(initial.beforeGenerate).not.toHaveBeenCalled();
  });
  it('retains the prior PDF and settles after a provider failure without an automatic retry',async()=>{
    fixture.bridge.getLessonNotes.mockResolvedValue(saved);fixture.bridge.generateLessonNotes.mockRejectedValue(new Error("Error invoking remote method 'lc:generateLessonNotes': Error: Groq request or token rate limit reached."));
    render(<LessonNotes {...props()}/>);await screen.findByRole('button',{name:'Open PDF'});fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));
    expect((await screen.findByRole('alert')).textContent).toBe('Groq request or token rate limit reached.');
    expect((screen.getByRole('button',{name:'Generate notes'}) as HTMLButtonElement).disabled).toBe(false);expect(screen.getByRole('button',{name:'Open PDF'})).toBeTruthy();
    expect(screen.queryByRole('button',{name:'Cancel notes'})).toBeNull();expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledTimes(1);
  });
  it('cancels during preparation before any model request starts',async()=>{
    let finishPreparation!:(value:LessonSession)=>void;const initial=props();initial.beforeGenerate.mockImplementation(()=>new Promise(resolve=>{finishPreparation=resolve;}));
    render(<LessonNotes {...initial}/>);fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));fireEvent.click(screen.getByRole('button',{name:'Cancel notes'}));
    await act(async()=>{finishPreparation(session);});expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();expect(screen.getByText('Notes generation canceled.')).toBeTruthy();
  });
  it('ignores a late generated result after cancellation and keeps the saved PDF',async()=>{
    let finishGeneration!:(value:LessonNotesRecord)=>void;fixture.bridge.getLessonNotes.mockResolvedValue(saved);fixture.bridge.generateLessonNotes.mockImplementation(()=>new Promise(resolve=>{finishGeneration=resolve;}));
    render(<LessonNotes {...props()}/>);await screen.findByRole('button',{name:'Open PDF'});fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));await waitFor(()=>expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button',{name:'Cancel notes'}));await act(async()=>{finishGeneration({...saved,id:'22222222-2222-4222-8222-222222222222',studiedSteps:2});});
    fireEvent.click(screen.getByRole('button',{name:'Open PDF'}));await waitFor(()=>expect(fixture.bridge.openLessonNotes).toHaveBeenCalledWith({sessionId:session.id,notesId:saved.id}));expect(fixture.bridge.cancelLessonNotes).toHaveBeenCalledExactlyOnceWith(session.id);
  });
  it('invalidates pending generation on a connection change',async()=>{
    let finishGeneration!:(value:LessonNotesRecord)=>void;fixture.bridge.generateLessonNotes.mockImplementation(()=>new Promise(resolve=>{finishGeneration=resolve;}));
    const initial=props();const {rerender}=render(<LessonNotes {...initial}/>);fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));await waitFor(()=>expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledTimes(1));
    rerender(<LessonNotes {...initial} connectionKey="groq:two"/>);await waitFor(()=>expect(fixture.bridge.cancelLessonNotes).toHaveBeenCalledWith(session.id));await act(async()=>{finishGeneration(saved);});
    expect(screen.queryByRole('button',{name:'Open PDF'})).toBeNull();expect(screen.queryByRole('button',{name:'Cancel notes'})).toBeNull();
  });
  it('cancels pending generation when leaving the lesson and does not display stale read results',async()=>{
    let finishRead!:(value:LessonNotesRecord)=>void;fixture.bridge.getLessonNotes.mockImplementationOnce(()=>new Promise(resolve=>{finishRead=resolve;}));
    const initial=props();const {rerender,unmount}=render(<LessonNotes {...initial}/>);rerender(<LessonNotes {...initial} session={{...session,id:'lesson-two'}}/>);await act(async()=>{finishRead(saved);});
    expect(screen.queryByRole('button',{name:'Open PDF'})).toBeNull();initial.beforeGenerate.mockResolvedValue({...session,id:'lesson-two'});fixture.bridge.generateLessonNotes.mockImplementation(()=>new Promise(()=>{}));
    fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));await waitFor(()=>expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledWith({sessionId:'lesson-two'}));unmount();expect(fixture.bridge.cancelLessonNotes).toHaveBeenCalledWith('lesson-two');
  });
  it('does not call the model if a fresh saved snapshot has no acknowledged explanation',async()=>{
    const initial=props();initial.beforeGenerate.mockResolvedValue({...session,messages:[]});render(<LessonNotes {...initial}/>);fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));
    expect((await screen.findByRole('alert')).textContent).toContain('Study part of this lesson');expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
  });
  it('clears an older saved-note read failure when an explicit generation succeeds',async()=>{
    let rejectRead!:(error:Error)=>void,finishGeneration!:(value:LessonNotesRecord)=>void;
    fixture.bridge.getLessonNotes.mockImplementation(()=>new Promise((_resolve,reject)=>{rejectRead=reject;}));
    fixture.bridge.generateLessonNotes.mockImplementation(()=>new Promise(resolve=>{finishGeneration=resolve;}));
    render(<LessonNotes {...props()}/>);fireEvent.click(screen.getByRole('button',{name:'Generate notes'}));
    await waitFor(()=>expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledTimes(1));
    await act(async()=>{rejectRead(new Error('The saved notes PDF is unavailable. Generate notes again.'));});
    expect((await screen.findByRole('alert')).textContent).toContain('saved notes PDF is unavailable');
    await act(async()=>{finishGeneration(saved);});await screen.findByRole('button',{name:'Open PDF'});
    expect(screen.queryByRole('alert')).toBeNull();expect(screen.getByText('Notes ready · 1 studied step')).toBeTruthy();
    expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledTimes(1);
  });
  it('creates an explicit offline record without a teaching connection and labels only that action as busy',async()=>{
    let finish!:(value:LessonNotesRecord)=>void;fixture.bridge.generateLessonNotes.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    render(<LessonNotes {...props()} canGenerate={false}/>);
    fireEvent.click(screen.getByRole('button',{name:'Create notes offline'}));
    await waitFor(()=>expect(fixture.bridge.generateLessonNotes).toHaveBeenCalledExactlyOnceWith({sessionId:session.id,mode:'local'}));
    expect(screen.getByRole('button',{name:'Creating offline record…'}).getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button',{name:'Generate notes'}).getAttribute('aria-busy')).toBe('false');
    expect(screen.queryByRole('button',{name:'Generating notes…'})).toBeNull();
    expect(screen.getByText('Creating an offline study record on this device…')).toBeTruthy();
    await act(async()=>{finish({...saved,providerId:'local',requestedModel:'local-extract'});});
    expect(screen.getByText('Offline study record · No AI request used.')).toBeTruthy();
    expect(screen.getByText('Offline study record ready · 1 studied step')).toBeTruthy();
  });
  it('identifies a saved local PDF as an offline study record after restart',async()=>{
    fixture.bridge.getLessonNotes.mockResolvedValue({...saved,providerId:'local',requestedModel:'local-extract'});
    render(<LessonNotes {...props()}/>);await screen.findByRole('button',{name:'Open PDF'});
    expect(screen.getByText('Offline study record · No AI request used.')).toBeTruthy();expect(fixture.bridge.generateLessonNotes).not.toHaveBeenCalled();
  });
});
