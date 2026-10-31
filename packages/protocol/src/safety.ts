/** Fixed public copy only. Rejected learner/model passages must never enter errors. */
export const LEARNER_SAFETY_MESSAGE='Canvas Atlas can help with safe, age-appropriate learning. Try a non-graphic educational question.';
export const LEARNER_SAFETY_LIMIT_MESSAGE='This learning content is too large to check safely. Choose a smaller passage and try again.';
export const SAFETY_SEXUAL_MESSAGE="I'm here to help you learn through educational lessons. This topic falls outside the content guidelines of Canvas Atlas. Please choose another subject, and I'll be happy to help you explore it.";
export const SAFETY_DANGEROUS_MESSAGE="I can help you understand the science behind this topic, but I can't provide instructions that could cause harm. We can explore the underlying concepts safely instead.";
export const SAFETY_REVIEW_MESSAGE='Could you clarify what you would like to learn? I want to make sure I provide an appropriate educational explanation.';
export const SAFETY_UNAVAILABLE_MESSAGE='The safety check is temporarily unavailable. Your request has not started. Check your teaching connection and try again.';
export const SAFETY_HEALTH_MESSAGE='For personal symptoms or a potentially urgent health concern, seek advice from an appropriate medical professional. If symptoms are severe or you may be in immediate danger, contact local emergency services. Canvas Atlas will not start a detailed lesson about this concern.';
export const SAFETY_LEGACY_MESSAGE='This saved material needs a safety review before it can be opened. Connect your teaching service and try again. Previously approved material remains available offline.';
export const SAFETY_SEXUAL_ALTERNATIVE='How do hormones help the body function?';
export const SAFETY_DANGEROUS_ALTERNATIVE='Explain the underlying science safely, without procedures for causing harm.';
export type PublicSafetyOutcome={decision:'BLOCK'|'REVIEW';message:string;safeAlternative?:string};
export const LEARNER_SAFETY_MESSAGES:readonly string[]=Object.freeze([LEARNER_SAFETY_MESSAGE,LEARNER_SAFETY_LIMIT_MESSAGE,SAFETY_SEXUAL_MESSAGE,SAFETY_DANGEROUS_MESSAGE,SAFETY_REVIEW_MESSAGE,SAFETY_UNAVAILABLE_MESSAGE,SAFETY_HEALTH_MESSAGE,SAFETY_LEGACY_MESSAGE]);
export type SafetySurface='learner-input'|'study-material'|'model-output'|'saved-content'|'simulation-frame'|'narration';
/** Recognize fixed copy after Electron adds its remote-method Error wrapper. */
export function isLearnerSafetyMessage(value:unknown):boolean{
  const text=value instanceof Error?value.message:typeof value==='string'?value:'';
  return LEARNER_SAFETY_MESSAGES.some(message=>text===message||text.endsWith(`Error: ${message}`)||text===`Experiment paused: ${message}`);
}
/** Electron drops custom Error fields; recover only fixed, approved public copy. */
export function safetyOutcomeFromError(value:unknown):PublicSafetyOutcome|undefined{
  const text=value instanceof Error?value.message:typeof value==='string'?value:'';
  const message=LEARNER_SAFETY_MESSAGES.find(copy=>text===copy||text.endsWith(`Error: ${copy}`)||text===`Experiment paused: ${copy}`);
  if(!message)return undefined;
  const decision=[SAFETY_REVIEW_MESSAGE,SAFETY_UNAVAILABLE_MESSAGE,SAFETY_LEGACY_MESSAGE,LEARNER_SAFETY_LIMIT_MESSAGE].includes(message)?'REVIEW':'BLOCK';
  return {decision,message,...(message===SAFETY_SEXUAL_MESSAGE?{safeAlternative:SAFETY_SEXUAL_ALTERNATIVE}:message===SAFETY_DANGEROUS_MESSAGE?{safeAlternative:SAFETY_DANGEROUS_ALTERNATIVE}:{})};
}
