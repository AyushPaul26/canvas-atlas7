import type {SafetySurface} from '@living-canvas/protocol';

export type SafetyOperation='topic'|'follow-up'|'roadmap'|'lesson'|'continuation'|'course'|'notes'|'material'|'saved-content'|'narration'|'simulation';
export type SafetyTask={operation:SafetyOperation;originalRequest:string;context?:unknown;subjectId?:string};
/** Opaque backend capability: callers cannot manufacture an ALLOW verdict. */
export type SafetyPermit={readonly token:string;readonly policyVersion:string;readonly binding:string};
export type SafetyEvaluation={kind:'intent'|'content';operation:SafetyOperation;originalRequest:string;context?:unknown;content?:unknown;surface?:SafetySurface};
export interface SafetyGate{
  authorize(task:SafetyTask,signal?:AbortSignal):Promise<SafetyPermit>;
  assertCurrent(permit:SafetyPermit,task?:SafetyTask):void;
  inspect(content:unknown,surface:SafetySurface,signal?:AbortSignal):Promise<void>;
  isApproved(content:unknown):boolean;
  assertApproved(content:unknown,surface?:SafetySurface):void;
  /** Backend-only: compile-time app copy, never learner/provider/file content. */
  registerTrusted(content:unknown):void;
  /** Only a verified deterministic derivation with no new language may inherit approval. */
  derive(content:unknown,parents:unknown[],surface?:SafetySurface):void;
  cancel(subjectId:string):void;
  cancelAll():void;
}
