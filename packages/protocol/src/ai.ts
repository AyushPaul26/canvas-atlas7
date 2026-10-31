import {z} from 'zod';

export const providerIdSchema=z.enum(['chatgpt','gemini','groq']);
export const apiProviderIdSchema=z.enum(['gemini','groq']);
export type ProviderId=z.infer<typeof providerIdSchema>;
export type ApiProviderId=z.infer<typeof apiProviderIdSchema>;
const modelId=z.string().min(1).max(200).regex(/^[A-Za-z0-9][\w:./-]*$/);
const model=z.object({id:modelId,name:z.string().min(1).max(240)}).strict();
export const teachingKeyInputSchema=z.object({providerId:apiProviderIdSchema,key:z.string().trim().min(1).max(512).regex(/^[!-~]+$/)}).strict();
export const teachingSelectionInputSchema=z.object({providerId:providerIdSchema,modelId:modelId.optional()}).strict();
export const teachingSettingsSchema=z.object({version:z.literal(1),activeProvider:providerIdSchema,models:z.object({chatgpt:modelId.optional(),gemini:modelId.optional(),groq:modelId.optional()}).strict()}).strict();
export type TeachingSettings=z.infer<typeof teachingSettingsSchema>;
export const teachingConnectionSchema=z.object({providerId:providerIdSchema,connected:z.boolean(),hasKey:z.boolean(),models:z.array(model).max(1000),model:modelId.optional(),modelAvailable:z.boolean(),error:z.string().max(1000).optional()}).strict();
export type TeachingConnection=z.infer<typeof teachingConnectionSchema>;
export const teachingConfigurationSchema=z.object({activeProvider:providerIdSchema,revision:z.number().int().nonnegative(),connections:z.array(teachingConnectionSchema).max(3)}).strict();
export type TeachingConfiguration=z.infer<typeof teachingConfigurationSchema>;

export function migrateTeachingSettings(raw?:string,legacyModel?:string):TeachingSettings{
  if(raw){try{const value=teachingSettingsSchema.safeParse(JSON.parse(raw));if(value.success)return value.data;}catch{/* Restore a legacy configuration without trusting malformed preference data. */}}
  const legacy=modelId.safeParse(legacyModel);
  return {version:1,activeProvider:'chatgpt',models:legacy.success?{chatgpt:legacy.data}:{}};
}
