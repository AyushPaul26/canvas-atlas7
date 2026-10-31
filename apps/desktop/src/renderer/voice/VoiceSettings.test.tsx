// @vitest-environment jsdom
import React from 'react';
import '@testing-library/jest-dom/vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const io=vi.hoisted(()=>({configuration:vi.fn(),setKey:vi.fn(),clearKey:vi.fn(),list:vi.fn(),save:vi.fn(),synthesize:vi.fn(),cancel:vi.fn()}));
vi.mock('../bridge',()=>({bridge:{getVoiceConfiguration:io.configuration,setElevenLabsKey:io.setKey,clearElevenLabsKey:io.clearKey,listElevenLabsVoices:io.list,saveVoiceConfiguration:io.save,synthesizeSpeech:io.synthesize,cancelSpeech:io.cancel}}));
import VoiceSettings from './VoiceSettings';
const config={provider:'local',voiceId:'',voiceName:'',modelId:'eleven_multilingual_v2',stability:.5,similarityBoost:.75,style:0,hasKey:false,revision:0};
beforeEach(()=>{vi.resetAllMocks();io.configuration.mockResolvedValue(config);io.list.mockResolvedValue({voices:[{id:'teacher',name:'My teacher',accent:'Indian'}],hasMore:false});io.setKey.mockResolvedValue({...config,hasKey:true});io.save.mockImplementation(async settings=>({...settings,hasKey:true,revision:1}));io.clearKey.mockResolvedValue(config);});
afterEach(cleanup);
it('connects a key without displaying it and enables an account voice after a controlled pause',async()=>{
  const pause=vi.fn(async()=>{});render(<VoiceSettings desktop beforeChange={pause}/>);
  await screen.findByLabelText('ElevenLabs API key');
  fireEvent.change(screen.getByLabelText('ElevenLabs API key'),{target:{value:'fixture-key-only-12345'}});
  fireEvent.click(screen.getByRole('button',{name:'Connect ElevenLabs'}));
  await screen.findByRole('option',{name:/My teacher/});expect(screen.getByLabelText('ElevenLabs API key')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('ElevenLabs voice'),{target:{value:'teacher'}});
  fireEvent.click(screen.getByRole('button',{name:'Use this voice'}));
  await waitFor(()=>expect(io.save).toHaveBeenCalledWith(expect.objectContaining({provider:'elevenlabs',voiceId:'teacher'})));
  expect(pause).toHaveBeenCalled();expect(screen.queryByText('fixture-key-only-12345')).toBeNull();
});
it('restores a saved voice and removes the key through an explicit control',async()=>{
  io.configuration.mockResolvedValue({...config,hasKey:true,provider:'elevenlabs',voiceId:'teacher',voiceName:'My teacher'});
  render(<VoiceSettings desktop beforeChange={async()=>{}}/>);
  await screen.findByRole('option',{name:/My teacher/});expect(screen.getByLabelText('ElevenLabs voice')).toHaveValue('teacher');
  fireEvent.click(screen.getByRole('button',{name:'Remove API key'}));await waitFor(()=>expect(io.clearKey).toHaveBeenCalledOnce());
  await waitFor(()=>expect(screen.getByRole('button',{name:'Use this voice'})).toBeDisabled());
});
it('shows an actionable connection error and allows retry without replacing configuration',async()=>{
  io.setKey.mockRejectedValue(new Error('ElevenLabs rejected the API key.'));
  render(<VoiceSettings desktop beforeChange={async()=>{}}/>);await screen.findByLabelText('ElevenLabs API key');
  fireEvent.change(screen.getByLabelText('ElevenLabs API key'),{target:{value:'fixture-key-only-12345'}});fireEvent.click(screen.getByRole('button',{name:'Connect ElevenLabs'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('ElevenLabs rejected');expect(io.save).not.toHaveBeenCalled();
});

it('keeps the saved voice selected when a search result does not contain it',async()=>{
  io.configuration.mockResolvedValue({...config,hasKey:true,provider:'elevenlabs',voiceId:'teacher',voiceName:'My teacher'});
  io.list.mockResolvedValueOnce({voices:[{id:'teacher',name:'My teacher'}],hasMore:false}).mockResolvedValueOnce({voices:[{id:'other',name:'Another voice'}],hasMore:false});
  render(<VoiceSettings desktop beforeChange={async()=>{}}/>);await screen.findByRole('option',{name:'My teacher'});
  fireEvent.change(screen.getByLabelText('Search account voices'),{target:{value:'Another'}});fireEvent.click(screen.getByRole('button',{name:'Refresh voices'}));
  await screen.findByRole('option',{name:'Another voice'});expect(screen.getByLabelText('ElevenLabs voice')).toHaveValue('teacher');expect(screen.getByRole('option',{name:'My teacher'})).toBeInTheDocument();
});

it('does not mix an old page token with a newly typed search',async()=>{
  io.configuration.mockResolvedValue({...config,hasKey:true});io.list.mockResolvedValue({voices:[{id:'teacher',name:'My teacher'}],hasMore:true,nextPageToken:'page-2'});
  render(<VoiceSettings desktop beforeChange={async()=>{}}/>);await screen.findByRole('button',{name:'Load more voices'});
  fireEvent.change(screen.getByLabelText('Search account voices'),{target:{value:'different search'}});
  expect(screen.getByRole('button',{name:'Load more voices'})).toBeDisabled();expect(io.list).toHaveBeenCalledTimes(1);
});

it('cancels a preview requested while the lesson pause is still pending',async()=>{
  io.configuration.mockResolvedValue({...config,hasKey:true,provider:'elevenlabs',voiceId:'teacher',voiceName:'My teacher'});
  let resumePause!:()=>void;const pause=vi.fn(()=>new Promise<void>(resolve=>{resumePause=resolve;}));
  render(<VoiceSettings desktop beforeChange={pause}/>);await screen.findByRole('option',{name:/My teacher/});
  fireEvent.click(screen.getByRole('button',{name:'Preview voice'}));await waitFor(()=>expect(pause).toHaveBeenCalled());
  fireEvent.click(screen.getByRole('button',{name:'Stop preview'}));resumePause();
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Stop preview'})).toBeNull());expect(io.synthesize).not.toHaveBeenCalled();
});
