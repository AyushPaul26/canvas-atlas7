import type { AppStatus, LessonSession, TutorBridge } from '@living-canvas/protocol';

export type Values = Record<string, number | boolean | string>;
export type LivingCanvasBridge = TutorBridge;

declare global { interface Window { livingCanvas?: LivingCanvasBridge } }

const unavailable = () => Promise.reject(new Error('Open the desktop app to connect a teaching service and use local voice.'));
const STORAGE_KEY = 'living-canvas-preview-sessions-v1';
const previewStatus: AppStatus = { connected: false, planEnabled: false, desktop: false };

/** Browser preview is deliberately empty: it never supplies inference or a signed-in identity. */
export function createPreviewBridge(): LivingCanvasBridge {
  const read = (): LessonSession[] => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as LessonSession[]; }
    catch { return []; }
  };
  const write = (sessions: LessonSession[]) => localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  return {
    getLessonNotes:async()=>null,generateLessonNotes:unavailable,cancelLessonNotes:async()=>{},openLessonNotes:unavailable,exportLessonNotes:unavailable,
    planTopic: unavailable, startConcept: unavailable, savePlayback: unavailable, resumePlayback: unavailable, returnToLesson: unavailable,
    importStudyMaterial: unavailable, cancelDocumentImport: async () => {}, getDocuments: async () => [],
    getSourceExcerpt: unavailable, getSourcePreview: unavailable, planCourse: unavailable, getCourses: async () => [],
    loadCourse: unavailable, startCourseLesson: unavailable,
    getStatus: async () => previewStatus,
    signIn: unavailable,
    signOut: async () => previewStatus,
    getModels: async () => [],
    setModel: unavailable,
    getTeachingConfiguration:unavailable,refreshTeachingModels:unavailable,selectTeachingProvider:unavailable,connectTeachingKey:unavailable,clearTeachingKey:unavailable,
    getSessions: async () => read().map(({ id, title, topic, updatedAt, messages }) => ({ id, title, topic, updatedAt, messageCount: messages.length })).reverse(),
    loadSession: async (id) => { const session = read().find((item) => item.id === id); if (!session) throw new Error('This lesson could not be found.'); return session; },
    createSession: async (topic) => {
      const now = new Date().toISOString();
      const session: LessonSession = { id: crypto.randomUUID(), topic, title: topic, createdAt: now, updatedAt: now, messages: [], beats: [], scene: [], controls: {} };
      write([...read(), session]); return session;
    },
    cancelSafetyAdmission:async()=>{},
    sendMessage: unavailable,
    continueLesson: unavailable,
    presentProgress: async () => {},
    readyToClose: async () => {},
    interrupt: async () => {},
    saveScene: async ({ sessionId, scene, controls }) => write(read().map((item) => item.id === sessionId ? { ...item, scene, controls: controls ?? item.controls, updatedAt: new Date().toISOString() } : item)),
    deleteSession: async (id) => write(read().filter((item) => item.id !== id)),
    exportLesson: unavailable,
    onEvent: () => () => {},
    voiceStatus: async () => ({ recognitionReady: false, synthesisReady: false }),
    installVoiceModel: unavailable,
    transcribeAudio: unavailable,
    synthesizeSpeech: async () => null,
    cancelSpeech: async () => {},getVoiceConfiguration: unavailable,saveVoiceConfiguration: unavailable,setElevenLabsKey: unavailable,clearElevenLabsKey: unavailable,listElevenLabsVoices: unavailable,
    onVoiceProgress: () => () => {},
    runSimulation: unavailable,
  };
}

export const bridge = window.livingCanvas ?? createPreviewBridge();
