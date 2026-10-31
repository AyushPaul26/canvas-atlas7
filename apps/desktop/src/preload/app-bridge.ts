import {contextBridge,ipcRenderer} from 'electron';
import type {TutorBridge,TutorEvent,VoiceStatus} from '@living-canvas/protocol';

const bridge:TutorBridge={
  getLessonNotes:id=>ipcRenderer.invoke('lc:getLessonNotes',id),generateLessonNotes:input=>ipcRenderer.invoke('lc:generateLessonNotes',input),
  cancelLessonNotes:id=>ipcRenderer.invoke('lc:cancelLessonNotes',id),openLessonNotes:input=>ipcRenderer.invoke('lc:openLessonNotes',input),exportLessonNotes:input=>ipcRenderer.invoke('lc:exportLessonNotes',input),
  planTopic:input=>ipcRenderer.invoke('lc:planTopic',input),startConcept:input=>ipcRenderer.invoke('lc:startConcept',input),
  savePlayback:input=>ipcRenderer.invoke('lc:savePlayback',input),resumePlayback:input=>ipcRenderer.invoke('lc:resumePlayback',input),returnToLesson:input=>ipcRenderer.invoke('lc:returnToLesson',input),
  importStudyMaterial:input=>ipcRenderer.invoke('lc:importStudyMaterial',input),cancelDocumentImport:id=>ipcRenderer.invoke('lc:cancelDocumentImport',id),
  getDocuments:()=>ipcRenderer.invoke('lc:getDocuments'),getSourceExcerpt:input=>ipcRenderer.invoke('lc:getSourceExcerpt',input),getSourcePreview:input=>ipcRenderer.invoke('lc:getSourcePreview',input),
  planCourse:input=>ipcRenderer.invoke('lc:planCourse',input),getCourses:()=>ipcRenderer.invoke('lc:getCourses'),loadCourse:id=>ipcRenderer.invoke('lc:loadCourse',id),startCourseLesson:input=>ipcRenderer.invoke('lc:startCourseLesson',input),
  readyToClose:()=>ipcRenderer.invoke('lc:readyToClose'),
  getStatus:()=>ipcRenderer.invoke('lc:getStatus'),signIn:()=>ipcRenderer.invoke('lc:signIn'),signOut:()=>ipcRenderer.invoke('lc:signOut'),
  getModels:()=>ipcRenderer.invoke('lc:getModels'),setModel:(id)=>ipcRenderer.invoke('lc:setModel',id),
  getTeachingConfiguration:()=>ipcRenderer.invoke('lc:getTeachingConfiguration'),refreshTeachingModels:providerId=>ipcRenderer.invoke('lc:refreshTeachingModels',providerId),
  selectTeachingProvider:input=>ipcRenderer.invoke('lc:selectTeachingProvider',input),connectTeachingKey:input=>ipcRenderer.invoke('lc:connectTeachingKey',input),clearTeachingKey:providerId=>ipcRenderer.invoke('lc:clearTeachingKey',providerId),
  getSessions:()=>ipcRenderer.invoke('lc:getSessions'),loadSession:id=>ipcRenderer.invoke('lc:loadSession',id),createSession:(topic,requestId)=>ipcRenderer.invoke('lc:createSession',requestId?{topic,requestId}:topic),cancelSafetyAdmission:requestId=>ipcRenderer.invoke('lc:cancelSafetyAdmission',requestId),
  sendMessage:input=>ipcRenderer.invoke('lc:sendMessage',input),interrupt:id=>ipcRenderer.invoke('lc:interrupt',id),saveScene:input=>ipcRenderer.invoke('lc:saveScene',input),deleteSession:id=>ipcRenderer.invoke('lc:deleteSession',id),exportLesson:id=>ipcRenderer.invoke('lc:exportLesson',id),
  continueLesson:input=>ipcRenderer.invoke('lc:continueLesson',input),
  presentProgress:input=>ipcRenderer.invoke('lc:presentProgress',input),
  voiceStatus:()=>ipcRenderer.invoke('lc:voiceStatus'),installVoiceModel:id=>ipcRenderer.invoke('lc:installVoiceModel',id),transcribeAudio:audio=>ipcRenderer.invoke('lc:transcribeAudio',audio),synthesizeSpeech:(text,job)=>ipcRenderer.invoke('lc:synthesizeSpeech',text,job),runSimulation:input=>ipcRenderer.invoke('lc:runSimulation',input),
  cancelSpeech:id=>ipcRenderer.invoke('lc:cancelSpeech',id),
  getVoiceConfiguration:()=>ipcRenderer.invoke('lc:getVoiceConfiguration'),saveVoiceConfiguration:value=>ipcRenderer.invoke('lc:saveVoiceConfiguration',value),
  setElevenLabsKey:key=>ipcRenderer.invoke('lc:setElevenLabsKey',key),clearElevenLabsKey:()=>ipcRenderer.invoke('lc:clearElevenLabsKey'),listElevenLabsVoices:query=>ipcRenderer.invoke('lc:listElevenLabsVoices',query),
  onEvent:callback=>{const listener=(_event:Electron.IpcRendererEvent,value:TutorEvent)=>callback(value);ipcRenderer.on('lc:event',listener);return ()=>ipcRenderer.removeListener('lc:event',listener);},
  onVoiceProgress:callback=>{const listener=(_event:Electron.IpcRendererEvent,value:VoiceStatus)=>callback(value);ipcRenderer.on('lc:voiceProgress',listener);return ()=>ipcRenderer.removeListener('lc:voiceProgress',listener);},
};
contextBridge.exposeInMainWorld('livingCanvas',Object.freeze(bridge));
