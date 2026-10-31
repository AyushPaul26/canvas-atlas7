import {expect,it} from 'vitest';
import {migrateTeachingSettings,providerIdSchema,teachingConfigurationSchema,teachingKeyInputSchema,teachingSelectionInputSchema} from '../../packages/protocol/src/ai';

it('accepts only the three teaching services and excludes account sign-in from key entry',()=>{
  for(const id of ['chatgpt','gemini','groq'])expect(providerIdSchema.parse(id)).toBe(id);
  expect(()=>providerIdSchema.parse('grok')).toThrow();
  expect(teachingKeyInputSchema.parse({providerId:'groq',key:' fixture-key '})).toEqual({providerId:'groq',key:'fixture-key'});
  expect(()=>teachingKeyInputSchema.parse({providerId:'chatgpt',key:'fixture-key'})).toThrow();
  expect(()=>teachingKeyInputSchema.parse({providerId:'gemini',key:'x'.repeat(513)})).toThrow();
  expect(()=>teachingKeyInputSchema.parse({providerId:'gemini',key:'header\ninjection'})).toThrow();
});
it('migrates legacy model preference only into the ChatGPT connection',()=>{
  expect(migrateTeachingSettings(undefined,'exact/astra')).toEqual({version:1,activeProvider:'chatgpt',models:{chatgpt:'exact/astra'}});
  const saved={version:1,activeProvider:'groq',models:{groq:'exact/model',gemini:'exact/model'}};
  expect(migrateTeachingSettings(JSON.stringify(saved),'old-model')).toEqual(saved);
  expect(migrateTeachingSettings('broken','old-model').models).toEqual({chatgpt:'old-model'});
});
it('keeps provider identity separate from matching model strings and rejects secret public fields',()=>{
  expect(teachingSelectionInputSchema.parse({providerId:'groq',modelId:'exact/model'})).not.toEqual(teachingSelectionInputSchema.parse({providerId:'gemini',modelId:'exact/model'}));
  const connection={providerId:'groq',connected:true,hasKey:true,models:[{id:'exact/model',name:'Model'}],model:'exact/model',modelAvailable:true};
  expect(teachingConfigurationSchema.parse({activeProvider:'groq',revision:1,connections:[connection]}).connections[0]).toEqual(connection);
  expect(()=>teachingConfigurationSchema.parse({activeProvider:'groq',revision:1,connections:[{...connection,key:'never-public'}]})).toThrow();
});
