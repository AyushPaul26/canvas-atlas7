/** Explicit identities keep provider-generated names outside the local action surface. */
const identities = [
  ['teaching', 'present_beat'], ['planning', 'propose_plan'],
  ['course', 'summarize_source'], ['course', 'plan_course'],
  ['notes', 'create_notes'],
] as const;
export function geminiToolName(namespace: unknown, name: unknown): string {
  const identity = identities.find(([space, tool]) => space === namespace && tool === name);
  if (!identity) throw new Error('Gemini received an unsupported teaching tool.');
  return identity.join('_');
}
export function canonicalGeminiTool(name: unknown): {namespace:string;name:string} {
  const identity = identities.find(pair => pair.join('_') === name);
  if (!identity) throw new Error('Gemini returned an unsupported teaching tool.');
  return {namespace:identity[0],name:identity[1]};
}
export function geminiInstructions(text:string):string {
  let result=text;
  for(const [namespace,name] of identities) result=result.replaceAll(`${namespace}.${name}`,`${namespace}_${name}`);
  return result;
}
export function geminiTools(tools:unknown[]):Record<string,unknown>[] {
  const result:Record<string,unknown>[]=[];const names=new Set<string>();
  for(const entry of tools){
    if(!entry||typeof entry!=='object')throw new Error('Gemini received an unsupported teaching tool.');
    const group=entry as Record<string,unknown>;
    if(group.type!=='namespace'||!Array.isArray(group.tools))throw new Error('Gemini received an unsupported teaching tool.');
    for(const raw of group.tools){
      if(!raw||typeof raw!=='object')throw new Error('Gemini received an unsupported teaching tool.');
      const tool=raw as Record<string,unknown>;const name=geminiToolName(group.name,tool.name);
      if(tool.type!=='function'||!tool.parameters||typeof tool.parameters!=='object'||Array.isArray(tool.parameters)||names.has(name))throw new Error('Gemini received an unsupported or duplicate teaching tool.');
      names.add(name);
      // Interactions accepts JSON Schema directly. Retain constraints even where the
      // service documents them as advisory; canonical Zod validation still enforces them.
      result.push({type:'function',name,...(typeof tool.description==='string'?{description:tool.description}:{}),parameters:tool.parameters});
    }
  }
  return result;
}
