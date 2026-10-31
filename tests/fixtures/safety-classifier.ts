/** Synthetic HTTP adapter responses for native tests; never imported by the app. */
export function isSafetyClassifierRequest(body:unknown):boolean{return JSON.stringify(body).includes('CANVAS ATLAS SAFETY CLASSIFIER');}
/** Self-contained so its JavaScript source can cross Electron's test boundary. */
export function safetyClassifierResponse(providerId:'gemini'|'groq'|'chatgpt',verdict?:unknown,model='fixture'):{body:string;contentType:string}{
  const text=JSON.stringify(verdict??{decision:'ALLOW',category:'GENERAL_EDUCATION',confidence:.99,reason_code:'SAFE_ACADEMIC_REQUEST',risks:[],safe_alternative:null});
  if(providerId==='gemini'){
    const step={type:'model_output',role:'model',content:[{type:'text',text}]};const events=[{event_type:'interaction.created',interaction:{id:'safety-response',model}},{event_type:'step.start',index:0,step},{event_type:'step.stop',index:0},{event_type:'interaction.completed',interaction:{id:'safety-response',model,status:'completed',steps:[step]}}];
    return {body:events.map(event=>`event: ${event.event_type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('')+'event: done\r\ndata: [DONE]\r\n\r\n',contentType:'text/event-stream'};
  }
  if(providerId==='groq')return {body:`data: ${JSON.stringify({id:'safety-response',model,choices:[{index:0,delta:{content:text},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`,contentType:'text/event-stream'};
  const events=[{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{id:'safety-response',model,status:'completed',output:[{id:'safety-message',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]}}];
  return {body:events.map(event=>`event: ${event.type}\r\ndata: ${JSON.stringify(event)}\r\n\r\n`).join('')+'data: [DONE]\r\n\r\n',contentType:'text/event-stream'};
}
