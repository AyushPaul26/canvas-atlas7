import type {ApiProviderId,ModelInfo,ProviderId} from '@living-canvas/protocol';
import type {CompletedResponse} from './tool-stream';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyPermit,SafetyTask} from '../safety/contracts';

export type ProviderScope={providerId:ProviderId;modelId:string;credentialRevision:string;accountId?:string};
/** Compatibility DTO owned by the coordinator, never a renderer-supplied HTTP payload.
 * Native adapters translate messages, namespace/function definitions and tool feedback
 * at this boundary so the existing ChatGPT teaching behavior remains unchanged. */
export type ProviderRequest={model:string;instructions:string;input:unknown[];tools:unknown[];scope?:ProviderScope;safetyPermit?:SafetyPermit;safetyTask?:SafetyTask};
export type TeachingRequest=ProviderRequest;
export type TeachingResponse=CompletedResponse;
export interface AIProvider {
  readonly id:ProviderId;
  listModels(signal?:AbortSignal):Promise<ModelInfo[]>;
  complete(request:ProviderRequest,signal:AbortSignal):Promise<CompletedResponse>;
}
export interface ApiKeyAIProvider extends AIProvider {
  readonly id:ApiProviderId;
  validateKey(key:string,signal?:AbortSignal):Promise<ModelInfo[]>;
}
export type TeachingProvider=Pick<AIProvider,'complete'>&{readonly id?:ProviderId;scope?():ProviderScope|undefined;identity?():string};
export class ProviderToolGenerationError extends Error {
  readonly repairable=true;
  readonly code='tool_use_failed';
  constructor(readonly providerId:ApiProviderId,diagnostic:string){super(diagnostic);this.name='ProviderToolGenerationError';}
}
/** A rejected generated call has no accepted call ID. Let the existing coordinator
 * repair budget add a diagnostic, without fabricating function-result messages. */
export async function completeTeaching(provider:TeachingProvider,request:ProviderRequest,signal:AbortSignal):Promise<CompletedResponse>{
  assertLearnerSafe(request.input,'learner-input');
  try{const result=await provider.complete(request,signal);assertLearnerSafe(result,'model-output');return result;}
  catch(error){signal.throwIfAborted();if(!(error instanceof ProviderToolGenerationError))throw error;return {calls:[],output:[],text:'',repairDiagnostic:error.message};}
}
export function sameProviderScope(a:ProviderScope|undefined,b:ProviderScope|undefined):boolean{
  return !!a&&!!b&&a.providerId===b.providerId&&a.modelId===b.modelId&&a.credentialRevision===b.credentialRevision&&a.accountId===b.accountId;
}
