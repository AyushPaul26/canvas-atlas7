import {ProviderToolGenerationError} from './provider-contract';

export class GroqToolGenerationError extends ProviderToolGenerationError {
  constructor(){super('groq','Groq could not generate a valid teaching tool call. Return a complete valid call using the supplied tool schema.');this.name='GroqToolGenerationError';}
}
type ErrorKind='key'|'model'|'quota'|'rate'|'size'|'context'|'tools'|'request'|'service'|'tool_use_failed'|'unknown';
/** Only fixed local diagnostics and classifications cross the provider boundary. */
export class GroqAPIError extends Error {
  constructor(readonly kind:Exclude<ErrorKind,'tool_use_failed'>,message:string){super(message);this.name='GroqAPIError';}
}
function errorKind(error:unknown):ErrorKind{
  if(!error||typeof error!=='object'||Array.isArray(error))return 'unknown';
  const {code,type,message}=error as {code?:unknown;type?:unknown;message?:unknown};
  const kinds:Record<string,ErrorKind>={
    tool_use_failed:'tool_use_failed',invalid_api_key:'key',authentication_error:'key',
    model_not_found:'model',model_decommissioned:'model',model_permission_blocked:'model',permission_denied:'model',permission_error:'model',
    insufficient_quota:'quota',billing_hard_limit_reached:'quota',rate_limit_exceeded:'rate',rate_limit_error:'rate',
    request_too_large:'size',context_length_exceeded:'context',max_context_length_exceeded:'context',context_window_exceeded:'context',
    tool_use_not_supported:'tools',unsupported_tools:'tools',function_calling_not_supported:'tools',
    invalid_request_error:'request',unprocessable_entity:'request',
    internal_error:'service',server_error:'service',service_unavailable:'service',
  };
  // An explicit known code takes precedence over a general error type.
  const knownCode=typeof code==='string'&&Object.hasOwn(kinds,code)?kinds[code]:undefined;
  if(knownCode&&knownCode!=='request')return knownCode;
  // Preserve bounded classification of common context/tool rejection messages.
  // Neither the remote message nor failed_generation is retained on the error.
  if(typeof message==='string'){
    const text=message.slice(0,8_000);
    if(/\b(?:maximum context length|context length exceeded|context window exceeded)\b/i.test(text))return 'context';
    if(/\b(?:does not support|doesn't support|unsupported)\b.{0,100}\b(?:tools?|tool use|function calling)\b|\b(?:tools?|tool use|function calling)\b.{0,100}\b(?:not supported|unsupported|not available)\b/i.test(text))return 'tools';
  }
  return knownCode??(typeof type==='string'&&Object.hasOwn(kinds,type)?kinds[type]:'unknown');
}

/** Groq's official SDK treats SSE data.error as an API failure without an HTTP
 * error status. Use the same safe code classification for both transports.
 * https://github.com/groq/groq-typescript/blob/main/src/core/streaming.ts */
export function groqAPIError(error:unknown,status?:number):GroqAPIError|GroqToolGenerationError{
  let kind=errorKind(error);
  // Authentication, quota, and service HTTP statuses remain authoritative even
  // if an inconsistent body happens to contain a generated-content error code.
  if(status===401)kind='key';
  else if(status===403||status===404)kind='model';
  else if(status===402)kind='quota';
  else if(status===429)kind='rate';
  else if(status===413)kind='size';
  else if(status!==undefined&&status>=500)kind='service';
  else if(kind==='tool_use_failed'&&status!==undefined&&status!==400&&status!==422)kind='unknown';
  if(kind==='tool_use_failed')return new GroqToolGenerationError();
  if(kind==='unknown'&&(status===400||status===422))kind='request';
  const messages:Record<Exclude<ErrorKind,'tool_use_failed'|'unknown'>,string>={
    key:'Groq rejected the API key. Replace the key in Teaching settings.',
    model:'Groq project or model access is unavailable. Review project model permissions or choose an available model.',
    quota:'Groq credits or quota are exhausted. Review billing and project limits, then try again.',
    rate:'Groq request or token rate limit reached. Wait for quota to recover, then try again.',
    size:'Groq rejected the teaching request because its size is too large. Use a shorter topic or smaller source excerpt, or choose a model with a larger context window in Teaching settings.',
    context:'Groq teaching context exceeds this model\'s token limit. Choose a model with a larger context window in Teaching settings, or use a shorter topic or smaller source excerpt.',
    tools:'Groq rejected local tool use for the selected model. Choose a model with tool support in Teaching settings.',
    request:'Groq rejected the request or tool schema for this model. Choose another compatible model or retry after reviewing settings.',
    service:'Groq service is temporarily unavailable. Your lesson is saved; try again later.',
  };
  return new GroqAPIError(kind,kind==='unknown'?(status===undefined?'Groq returned an unrecognized streaming error. Your lesson is saved; try again or choose another model in Teaching settings.':'Groq could not complete this request. Your lesson is saved; try again.'):messages[kind]);
}
