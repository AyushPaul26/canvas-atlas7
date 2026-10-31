import { randomUUID } from 'node:crypto';
import { learningPlanSchema, type LearningPlan } from '@living-canvas/protocol';
import { buildPlanningInstructions, getPlanningToolParameters } from '../../../../../packages/teacher/src/planner';
import { parseToolInput } from '../../../../../packages/teacher/src/tool-schema';
import type { SessionRepository } from '../storage/session-repository';
import {completeTeaching,type TeachingProvider} from './provider-contract';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../safety/contracts';

type Options = { store: SessionRepository; provider: TeachingProvider; model(): string | undefined;safety?:SafetyGate };

export class LearningPlanCoordinator {
  private jobs = new Map<string, AbortController>();
  constructor(private options: Options) {}
  cancelAll() { for (const job of this.jobs.values()) job.abort(new Error('Roadmap planning was canceled.')); this.jobs.clear(); }
  cancel(sessionId: string) { this.jobs.get(sessionId)?.abort(new Error('Roadmap planning was canceled.')); this.jobs.delete(sessionId);this.options.safety?.cancel(sessionId); }

  async planTopic(input: { sessionId: string; level?: string }): Promise<LearningPlan> {
    const model = this.options.model();
    if (!model) throw new Error('Choose an available teaching model in Settings before planning a lesson.');
    const selectedScope=this.options.provider.scope?.(),scope=selectedScope?{...selectedScope}:undefined,identity=this.options.provider.identity?.();
    if (this.jobs.has(input.sessionId)) throw new Error('This roadmap is already being prepared.');
    const session = this.options.store.load(input.sessionId);
    assertLearnerSafe(session,'saved-content');if(input.level)assertLearnerSafe(input.level,'learner-input');
    const job = new AbortController(); this.jobs.set(input.sessionId, job);
    const snapshot=JSON.stringify(session),task:SafetyTask={operation:'roadmap',originalRequest:session.topic,subjectId:session.id,context:{lesson:session,...(input.level?{learnerNeeds:input.level}:{})}};
    let safetyPermit:SafetyPermit|undefined;
    const current=()=>{job.signal.throwIfAborted();if(this.jobs.get(session.id)!==job||this.options.model()!==model||identity!==this.options.provider.identity?.()||JSON.stringify(scope)!==JSON.stringify(this.options.provider.scope?.()))throw new Error('Your teaching connection changed. Plan the lesson again.');if(this.options.safety&&JSON.stringify(this.options.store.load(session.id))!==snapshot)throw new Error('Your lesson changed during roadmap planning. Try again.');if(safetyPermit)this.options.safety?.assertCurrent(safetyPermit,task);};
    const tools = [{ type: 'namespace', name: 'planning', description: 'Prepare a concise learner-visible roadmap.', tools: [{ type: 'function', name: 'propose_plan', description: 'Propose the topic-specific concepts and their learning objectives.', strict: true, parameters: getPlanningToolParameters() }] }];
    const items: unknown[] = [{ role: 'user', content: JSON.stringify({ topic: session.topic, ...(input.level ? { learnerNeeds: input.level.slice(0, 2000) } : {}) }) }];
    try {
      if(this.options.safety){safetyPermit=await this.options.safety.authorize(task,job.signal);current();await this.options.safety.inspect(session,'saved-content',job.signal);current();}
      for (let attempt = 0; attempt <= 2; attempt++) {
        current();
        const response = await completeTeaching(this.options.provider,{ model, instructions: buildPlanningInstructions(), input: items, tools,scope,safetyPermit,safetyTask:task }, job.signal);
        current();await this.options.safety?.inspect(response,'model-output',job.signal);current();
        let diagnostic = 'Use planning.propose_plan with one complete roadmap.';
        let proposed:LearningPlan|undefined;
        try {
          if(response.repairDiagnostic)throw new Error(response.repairDiagnostic);
          if (response.calls.length !== 1) throw new Error('Return exactly one roadmap.');
          const call = response.calls[0];
          if (call.namespace !== 'planning' || call.name !== 'propose_plan') throw new Error('Unsupported roadmap action.');
          const plan = parseToolInput(learningPlanSchema, { ...JSON.parse(call.arguments), id: randomUUID(), version: (this.options.store.loadPlan(session.id)?.version ?? 0) + 1 });
          if (plan.sourceDocumentIds.length || plan.concepts.some(concept => concept.sourceRefs.length)) throw new Error('A topic roadmap must not invent document sources.');
          proposed=plan;
        } catch (error) { diagnostic = error instanceof Error ? error.message : 'The roadmap was invalid.'; }
        if(proposed){
          const plan=proposed;current();this.options.safety?.derive(plan,[response,session],'model-output');
          return this.options.store.transaction(()=>{current();this.options.store.savePlan(session.id,plan);this.options.safety?.derive(this.options.store.load(session.id),[session,plan],'saved-content');return plan;});
        }
        if (attempt === 2) throw new Error(`The roadmap could not be prepared after two repairs. ${diagnostic}`);
        items.push(...response.output);
        for (const call of response.calls) items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, diagnostics: diagnostic, repairAttemptsRemaining: 2 - attempt }) });
        items.push({ role: 'developer', content: diagnostic.slice(0, 2000) });
      }
      throw new Error('The roadmap could not be prepared.');
    } finally { if (this.jobs.get(input.sessionId) === job) this.jobs.delete(input.sessionId); }
  }
}
