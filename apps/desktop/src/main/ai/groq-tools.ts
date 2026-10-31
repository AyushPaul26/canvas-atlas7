import type {ProviderRequest} from './provider-contract';

export type GroqToolIdentity={namespace:string;name:string};
const toolNames = new Map<string,GroqToolIdentity>([
  ['teaching__present_beat',{namespace:'teaching',name:'present_beat'}],
  ['planning__propose_plan',{namespace:'planning',name:'propose_plan'}],
  ['course__summarize_source',{namespace:'course',name:'summarize_source'}],
  ['course__plan_course',{namespace:'course',name:'plan_course'}],
  ['notes__create_notes',{namespace:'notes',name:'create_notes'}],
]);
function wireInstructions(text:string):string{
  for(const [wire,identity] of toolNames)text=text.replaceAll(`${identity.namespace}.${identity.name}`,wire);
  return text;
}
const record=(value:unknown):Record<string,any>=>{
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Groq received unsupported teaching context.');
  return value as Record<string,any>;
};
export function groqTools(tools:unknown[]){
  const allowed=new Map<string,GroqToolIdentity>();
  const result:{type:'function';function:{name:string;description?:string;parameters:Record<string,unknown>}}[]=[];
  const add=(value:unknown,namespace:unknown)=>{
    const tool=record(value),name=`${namespace}__${tool.name}`;
    const identity=toolNames.get(name);
    if(tool.type!=='function'||!identity)throw new Error('Groq received an unsupported teaching tool.');
    if(allowed.has(name))throw new Error('Groq received duplicate teaching tools.');
    const parameters=record(tool.parameters);
    // Groq local tools use ordinary JSON Schema. Preserve all schema branches;
    // acceptance by the API never replaces the canonical local Zod validators.
    allowed.set(name,identity);
    result.push({type:'function',function:{name,...(typeof tool.description==='string'?{description:tool.description}:{}),parameters}});
  };
  for(const value of tools){
    const tool=record(value);
    if(tool.type==='namespace'){
      if(!Array.isArray(tool.tools))throw new Error('Groq received an invalid teaching tool namespace.');
      for(const child of tool.tools)add(child,tool.name);
    }else add(tool,tool.namespace);
  }
  return {tools:result,allowed};
}

type GroqCall={id:string;type:'function';function:{name:string;arguments:string}};
type GroqMessage={role:'system'|'user'|'assistant'|'tool';content:string|null;tool_calls?:GroqCall[];tool_call_id?:string};
function messageText(value:unknown):string{
  if(typeof value==='string')return value;
  if(Array.isArray(value))return value.map(item=>{
    const part=record(item);
    if(!['input_text','output_text','text'].includes(part.type)||typeof part.text!=='string')throw new Error('Groq received unsupported teaching message content.');
    return part.text;
  }).join('\n');
  throw new Error('Groq received unsupported teaching message content.');
}
/** Reconstruct native messages from canonical calls/results, never native Responses records. */
export function groqMessages(request:ProviderRequest,allowed:Map<string,GroqToolIdentity>):GroqMessage[]{
  const messages:GroqMessage[]=[{role:'system',content:wireInstructions(request.instructions)}];
  let group:GroqCall[]=[];
  const pending=new Set<string>(),seen=new Set<string>();
  const flush=()=>{if(group.length){messages.push({role:'assistant',content:null,tool_calls:group});group=[];}};
  for(const value of request.input){
    const item=record(value);
    if(item.type==='function_call'){
      if(pending.size&&group.length===0)throw new Error('Groq teaching tool calls must be paired with their results.');
      const name=`${item.namespace}__${item.name}`;
      if(!allowed.has(name))throw new Error('Groq received an unsupported teaching tool call.');
      if(typeof item.call_id!=='string'||!item.call_id||item.call_id.length>200||seen.has(item.call_id))throw new Error('Groq received an invalid or duplicate teaching call ID.');
      if(typeof item.arguments!=='string'||item.arguments.length>1_000_000)throw new Error('Groq received invalid teaching tool arguments.');
      try{JSON.parse(item.arguments);}catch{throw new Error('Groq received invalid teaching tool JSON.');}
      seen.add(item.call_id);pending.add(item.call_id);group.push({id:item.call_id,type:'function',function:{name,arguments:item.arguments}});
    }else if(item.type==='function_call_output'){
      flush();
      if(typeof item.call_id!=='string'||!pending.delete(item.call_id))throw new Error('Groq received an orphaned or duplicate teaching tool result.');
      if(typeof item.output!=='string')throw new Error('Groq received invalid teaching tool result content.');
      messages.push({role:'tool',tool_call_id:item.call_id,content:item.output});
    }else{
      if(pending.size)throw new Error('Groq teaching tool calls must be paired with their results.');
      if(!['user','developer','system','assistant'].includes(item.role)||item.type&&item.type!=='message')throw new Error('Groq received unsupported teaching history.');
      const content=messageText(item.content);
      messages.push({role:item.role==='developer'?'system':item.role,content:item.role==='system'||item.role==='developer'?wireInstructions(content):content});
    }
  }
  if(pending.size)throw new Error('Groq teaching tool calls must be paired with their results.');
  return messages;
}
