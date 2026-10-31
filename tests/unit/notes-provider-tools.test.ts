import {describe,it,expect} from 'vitest';
import {geminiTools,canonicalGeminiTool,geminiInstructions} from '../../apps/desktop/src/main/ai/gemini-tools';
import {groqTools,groqMessages} from '../../apps/desktop/src/main/ai/groq-tools';
import {getNotesToolParameters,buildNotesInstructions} from '../../packages/teacher/src/notes';

describe('explicit notes provider tool identity',()=>{
  const tools=()=>[{type:'namespace',name:'notes',tools:[{type:'function',name:'create_notes',strict:true,parameters:getNotesToolParameters()}]}];
  it('maps only the allowed native notes names and preserves the structured schema',()=>{
    const source=tools();expect(geminiTools(source)[0]).toMatchObject({type:'function',name:'notes_create_notes',parameters:source[0].tools[0].parameters});
    expect(canonicalGeminiTool('notes_create_notes')).toEqual({namespace:'notes',name:'create_notes'});
    const native=groqTools(source);expect(native.tools[0]).toMatchObject({type:'function',function:{name:'notes__create_notes',parameters:source[0].tools[0].parameters}});expect(native.allowed.get('notes__create_notes')).toEqual({namespace:'notes',name:'create_notes'});
  });
  it('translates notes instructions and keeps the prompt faithful to presented evidence',()=>{
    const instructions=buildNotesInstructions();expect(instructions).toContain('notes.create_notes');expect(instructions).toMatch(/presented|studied/i);expect(instructions).toMatch(/every.*explanation|all.*explanations/i);
    expect(geminiInstructions(instructions)).toContain('notes_create_notes');
    expect(groqMessages({model:'model',instructions,input:[{role:'user',content:'{}'}],tools:tools()},groqTools(tools()).allowed)[0].content).toContain('notes__create_notes');
  });
});
