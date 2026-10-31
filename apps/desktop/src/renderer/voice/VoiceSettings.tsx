import {useCallback,useEffect,useRef,useState} from 'react';
import {AudioLines,LoaderCircle} from 'lucide-react';
import {VOICE_PREVIEW_TEXT,type AccountVoice,type VoiceConfiguration,type VoiceSettings as Settings} from '@living-canvas/protocol';
import {bridge} from '../bridge';
import {createAudioPlayback} from '../audioPlayback';
import {requestSpeech} from '../speechRequest';
import './voice-settings.css';

type Props={desktop:boolean;beforeChange:()=>Promise<void>;rate?:number};
const defaults:Settings={provider:'local',voiceId:'',voiceName:'',modelId:'eleven_multilingual_v2',stability:.5,similarityBoost:.75,style:0};
const settingsOf=(value:VoiceConfiguration):Settings=>({provider:value.provider,voiceId:value.voiceId,voiceName:value.voiceName,modelId:value.modelId,stability:value.stability,similarityBoost:value.similarityBoost,style:value.style});
const messageOf=(error:unknown)=>error instanceof Error?error.message:'Voice settings could not be updated. Try again.';

export default function VoiceSettings({desktop,beforeChange,rate=.96}:Props){
  const previewRate=useRef(rate);previewRate.current=rate;
  const [configuration,setConfiguration]=useState<VoiceConfiguration|null>(null);
  const [draft,setDraft]=useState<Settings>(defaults);
  const [apiKey,setApiKey]=useState('');
  const [search,setSearch]=useState('');
  const [catalogQuery,setCatalogQuery]=useState('');
  const [voices,setVoices]=useState<AccountVoice[]>([]);
  const [nextPageToken,setNextPageToken]=useState<string>();
  const [loading,setLoading]=useState(true);
  const [catalogLoading,setCatalogLoading]=useState(false);
  const [busy,setBusy]=useState<string|null>(null);
  const [error,setError]=useState<string|null>(null);
  const [notice,setNotice]=useState<string|null>(null);
  const [previewState,setPreviewState]=useState<'idle'|'preparing'|'playing'>('idle');
  const [available,setAvailable]=useState(true);
  const mounted=useRef(true),initialization=useRef(0),catalogGeneration=useRef(0),previewGeneration=useRef(0),busyRef=useRef<string|null>(null);
  const knownVoices=useRef(new Map<string,AccountVoice>());
  const preview=useRef<ReturnType<typeof createAudioPlayback>|null>(null);
  if(!preview.current)preview.current=createAudioPlayback({
    rate:()=>previewRate.current,
    synthesize:(text,signal)=>requestSpeech(text,'preview',signal),
    onActivity:(playing,preparing)=>{if(mounted.current)setPreviewState(preparing?'preparing':playing?'playing':'idle');},
    onError:message=>{if(mounted.current)setError(message);},
  });
  const stopPreview=useCallback(()=>{previewGeneration.current++;preview.current?.stop();if(mounted.current)setPreviewState('idle');},[]);
  const accept=useCallback((value:VoiceConfiguration)=>{setConfiguration(value);setDraft(settingsOf(value));},[]);
  const loadCatalog=useCallback(async(query:string,append=false,token?:string)=>{
    const generation=++catalogGeneration.current;setCatalogLoading(true);setError(null);
    try{
      const page=await bridge.listElevenLabsVoices({...(query.trim()?{search:query.trim()}:{}),...(token?{nextPageToken:token}:{})});
      if(!mounted.current||generation!==catalogGeneration.current)return;
      for(const voice of page.voices){if(knownVoices.current.size<1000||knownVoices.current.has(voice.id))knownVoices.current.set(voice.id,voice);}
      setVoices(current=>[...new Map([...(append?current:[]),...page.voices].map(voice=>[voice.id,voice])).values()].slice(0,1000));
      setCatalogQuery(query.trim());
      setNextPageToken(page.hasMore?page.nextPageToken:undefined);
    }catch(error){if(mounted.current&&generation===catalogGeneration.current)setError(messageOf(error));}
    finally{if(mounted.current&&generation===catalogGeneration.current)setCatalogLoading(false);}
  },[]);
  useEffect(()=>{
    mounted.current=true;const generation=++initialization.current;
    if(!desktop||typeof bridge.getVoiceConfiguration!=='function'){setAvailable(false);setLoading(false);}
    else{
      setAvailable(true);setLoading(true);
      void bridge.getVoiceConfiguration().then(value=>{
        if(!mounted.current||generation!==initialization.current)return;
        accept(value);if(value.hasKey)void loadCatalog('');
      }).catch(error=>{if(mounted.current&&generation===initialization.current)setError(messageOf(error));})
        .finally(()=>{if(mounted.current&&generation===initialization.current)setLoading(false);});
    }
    return()=>{mounted.current=false;initialization.current++;catalogGeneration.current++;preview.current?.stop();};
  },[desktop,accept,loadCatalog]);
  const perform=async(name:string,operation:()=>Promise<void>)=>{
    if(busyRef.current)return;
    busyRef.current=name;setBusy(name);setError(null);setNotice(null);stopPreview();
    try{await beforeChange();if(!mounted.current)return;await operation();}
    catch(error){if(mounted.current)setError(messageOf(error));}
    finally{busyRef.current=null;if(mounted.current)setBusy(null);}
  };
  const connect=()=>{
    const key=apiKey.trim();setApiKey('');
    void perform('connect',async()=>{
      const value=await bridge.setElevenLabsKey(key);if(!mounted.current)return;
      catalogGeneration.current++;knownVoices.current.clear();setVoices([]);setSearch('');accept(value);
      setNotice('ElevenLabs connected. Choose a voice from your account.');await loadCatalog('');
    });
  };
  const removeKey=()=>void perform('remove',async()=>{
    const value=await bridge.clearElevenLabsKey();if(!mounted.current)return;
    catalogGeneration.current++;knownVoices.current.clear();setVoices([]);setNextPageToken(undefined);setCatalogLoading(false);setApiKey('');accept(value);setNotice('API key removed. Local narration is selected.');
  });
  const selected=knownVoices.current.get(draft.voiceId)??(configuration?.voiceId===draft.voiceId&&draft.voiceId?{id:draft.voiceId,name:configuration.voiceName}:undefined);
  const choices=selected&&!voices.some(voice=>voice.id===selected.id)?[selected,...voices]:voices;
  const edited=!!configuration&&(draft.voiceId!==configuration.voiceId||draft.stability!==configuration.stability||draft.similarityBoost!==configuration.similarityBoost||draft.style!==configuration.style);
  const disabled=!desktop||!available||loading||!!busy;
  const changeDraft=(value:Partial<Settings>)=>{stopPreview();setNotice(null);setDraft(current=>({...current,...value}));};
  const useVoice=()=>void perform('save',async()=>{
    const value=await bridge.saveVoiceConfiguration({...draft,provider:'elevenlabs',voiceName:selected?.name??draft.voiceName});
    if(mounted.current){accept(value);setNotice('Teacher voice updated. Resume your lesson when you are ready.');}
  });
  const useLocal=()=>void perform('local',async()=>{
    const value=await bridge.saveVoiceConfiguration({...draft,provider:'local'});
    if(mounted.current){accept(value);setNotice('Local narration selected.');}
  });
  const startPreview=()=>{
    const generation=previewGeneration.current+1;
    void perform('preview',async()=>{
      if(generation!==previewGeneration.current)return;
      const result=await preview.current!.play({id:'voice-preview',text:VOICE_PREVIEW_TEXT},{beatId:'voice-preview',chunkId:'voice-preview',offsetSeconds:0,passId:crypto.randomUUID()});
      if(mounted.current&&result==='unavailable')setError('No audio was available. Check your voice selection and try again.');
    });
  };
  return <section className="settings-section eleven-voice-settings" aria-labelledby="eleven-voice-title">
    <div className="settings-section-heading"><span className="settings-icon"><AudioLines size={20}/></span><div><h3 id="eleven-voice-title">Teacher narration</h3><p>Choose a local voice or a voice from your ElevenLabs account.</p></div></div>
    {!available&&<p className="settings-footnote">ElevenLabs settings are available in the updated Windows desktop app.</p>}
    {loading&&<p className="settings-footnote" role="status">Loading voice settings…</p>}
    {configuration&&<div className="settings-status-row"><span>Selected provider</span><strong className="status-label">{configuration.provider==='elevenlabs'?`ElevenLabs · ${configuration.voiceName||'Choose a voice'}`:'Local narration'}</strong></div>}
    <label className="field-label" htmlFor="eleven-api-key">ElevenLabs API key</label>
    <input id="eleven-api-key" type="password" value={apiKey} maxLength={512} autoComplete="off" spellCheck={false} placeholder={configuration?.hasKey?'A key is saved securely on this device':'Enter your ElevenLabs API key'} disabled={disabled} onChange={event=>setApiKey(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&apiKey.trim().length>=16&&!disabled){event.preventDefault();connect();}}}/>
    <div className="eleven-actions"><button type="button" className="button secondary compact" disabled={disabled||apiKey.trim().length<16} onClick={connect}>{busy==='connect'&&<LoaderCircle size={15} className="spin"/>}{configuration?.hasKey?'Replace API key':'Connect ElevenLabs'}</button>{configuration?.hasKey&&<button type="button" className="text-button" disabled={disabled} onClick={removeKey}>Remove API key</button>}</div>
    <p className="settings-footnote">The key is encrypted on this device. ElevenLabs narration sends spoken lesson text to ElevenLabs and uses your account credits. Microphone recognition stays local.</p>
    <div className="eleven-search"><label className="field-label" htmlFor="eleven-voice-search">Search account voices</label><div><input id="eleven-voice-search" value={search} maxLength={120} disabled={disabled||!configuration?.hasKey} placeholder="Voice name, accent, or description" onChange={event=>{stopPreview();setSearch(event.target.value);}} onKeyDown={event=>{if(event.key==='Enter'&&!event.nativeEvent.isComposing&&!disabled&&configuration?.hasKey){event.preventDefault();stopPreview();void loadCatalog(search);}}}/><button type="button" className="button secondary compact" disabled={disabled||!configuration?.hasKey||catalogLoading} onClick={()=>{stopPreview();void loadCatalog(search);}}>Refresh voices</button></div></div>
    <label className="field-label" htmlFor="eleven-voice">ElevenLabs voice</label>
    <select id="eleven-voice" value={draft.voiceId} disabled={disabled||!configuration?.hasKey} onChange={event=>changeDraft({voiceId:event.target.value,voiceName:knownVoices.current.get(event.target.value)?.name??''})}>
      <option value="">Choose an account voice</option>{choices.map(voice=><option key={voice.id} value={voice.id}>{voice.name}{voice.accent?` · ${voice.accent}`:''}{voice.gender?` · ${voice.gender}`:''}</option>)}
    </select>
    {catalogLoading&&<p className="settings-footnote" role="status">Loading account voices…</p>}
    {!catalogLoading&&configuration?.hasKey&&!voices.length&&<p className="settings-footnote">No voices match this search. Try another name or refresh the list.</p>}
    {nextPageToken&&<button type="button" className="text-button eleven-load-more" disabled={disabled||catalogLoading||voices.length>=1000||search.trim()!==catalogQuery} onClick={()=>void loadCatalog(catalogQuery,true,nextPageToken)}>Load more voices</button>}
    <div className="eleven-tuning">{([{key:'stability',label:'Stability'},{key:'similarityBoost',label:'Voice similarity'},{key:'style',label:'Style strength'}] as const).map(({key,label})=><label key={key} htmlFor={`eleven-${key}`}><span>{label}<output>{Math.round(draft[key]*100)}%</output></span><input id={`eleven-${key}`} type="range" min="0" max="1" step="0.05" value={draft[key]} disabled={disabled||!configuration?.hasKey} onChange={event=>changeDraft({[key]:Number(event.target.value)})}/></label>)}</div>
    <div className="eleven-actions"><button type="button" className="button primary compact" disabled={disabled||catalogLoading||!configuration?.hasKey||!draft.voiceId} onClick={useVoice}>Use this voice</button><button type="button" className="button secondary compact" disabled={disabled||!configuration?.hasKey||configuration.provider!=='elevenlabs'||edited} onClick={startPreview}>Preview voice</button>{(previewState!=='idle'||busy==='preview')&&<button type="button" className="button secondary compact" onClick={stopPreview}>Stop preview</button>}<button type="button" className="text-button" disabled={disabled||configuration?.provider==='local'} onClick={useLocal}>Use local voice</button></div>
    {edited&&<p className="settings-footnote">Select “Use this voice” to save these changes before previewing.</p>}
    {previewState!=='idle'&&<p className="settings-footnote" role="status">{previewState==='preparing'?'Preparing ElevenLabs preview…':'Playing voice preview…'}</p>}
    {notice&&<p className="settings-footnote" role="status">{notice}</p>}
    {error&&<p className="inline-error" role="alert">{error}</p>}
  </section>;
}
