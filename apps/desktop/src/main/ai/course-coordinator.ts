import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { learningPlanSchema, type CourseRecord, type DocumentSection, type SourceExcerpt } from '@living-canvas/protocol';
import { courseInstructions, courseOutlineSchema, courseTool, sourceSummarySchema } from '../../../../../packages/teacher/src/course-planner';
import { parseToolInput } from '../../../../../packages/teacher/src/tool-schema';
import { assertSuppliedSourceRefs } from '../../../../../packages/teacher/src/index';
import type { SessionRepository } from '../storage/session-repository';
import type { DocumentRepository } from '../storage/document-repository';
import type { CourseRepository } from '../storage/course-repository';
import {completeTeaching,type TeachingProvider} from './provider-contract';
import {assertLearnerSafe} from '../../../../../packages/teacher/src/learner-safety';
import type {SafetyGate,SafetyPermit,SafetyTask} from '../safety/contracts';
type Options = { sessions: SessionRepository; documents: DocumentRepository; courses: CourseRepository; provider: TeachingProvider; model(): string | undefined;safety?:SafetyGate };

export class CourseCoordinator {
  private job?: AbortController;
  constructor(private options: Options) {}
  cancelAll() { this.job?.abort(new Error('Course planning was canceled.')); this.job = undefined; }
  private evidence(sections: DocumentSection[]): SourceExcerpt[] {
    assertLearnerSafe(sections,'study-material');
    const excerpts: SourceExcerpt[] = [];
    for (const section of sections) for (let start = 0; start < section.text.length;) {
      let end = Math.min(section.text.length, start + 8000);
      if (/[\uD800-\uDBFF]/.test(section.text[end - 1] ?? '')) end--;
      excerpts.push({ ref: { documentId: section.documentId, extractionVersion: section.extractionVersion, sectionId: section.id, ...(section.page ? { page: section.page } : {}), start, end }, text: section.text.slice(start, end), warnings: [] }); start = end;
    }
    return excerpts;
  }
  private async call<T>(model: string, stage: 'summary' | 'outline', input: unknown, schema: z.ZodType<T>, signal: AbortSignal, validate: (value: T) => void,safetyPermit:SafetyPermit|undefined,current:()=>void,safetyTask:SafetyTask): Promise<T> {
    const scope=this.options.provider.scope?.();
    const name = stage === 'summary' ? 'summarize_source' : 'plan_course', items: unknown[] = [{ role: 'user', content: JSON.stringify(input) }];
    for (let attempt = 0; attempt <= 2; attempt++) {
      current();
      const result = await completeTeaching(this.options.provider,{ model, instructions: courseInstructions(stage), input: items, tools: courseTool(name),scope,safetyPermit,safetyTask }, signal);
      current();if(this.options.safety){await this.options.safety.inspect(result,'model-output',signal);current();}
      let diagnostic = 'Return the requested source-grounded course tool.';
      let parsed!:T,accepted=false;
      try {
        if(result.repairDiagnostic)throw new Error(result.repairDiagnostic);
        if (result.calls.length !== 1 || result.calls[0].namespace !== 'course' || result.calls[0].name !== name) throw new Error(diagnostic);
        parsed = parseToolInput(schema, JSON.parse(result.calls[0].arguments)); validate(parsed);accepted=true;
      } catch (error) { diagnostic = error instanceof Error ? error.message : diagnostic; }
      if(accepted){current();this.options.safety?.derive(parsed,[result],'model-output');return parsed;}
      if (attempt === 2) throw new Error(`The source course could not be prepared after two repairs. ${diagnostic}`);
      items.push(...result.output);
      for (const call of result.calls) items.push({ type: 'function_call_output', call_id: call.call_id, output: JSON.stringify({ ok: false, diagnostics: diagnostic.slice(0, 2000) }) });
      items.push({ role: 'developer', content: diagnostic.slice(0, 2000) });
    }
    throw new Error('Course planning failed.');
  }
  async planCourse(input: { documentIds: string[] }): Promise<CourseRecord> {
    const model = this.options.model(); if (!model) throw new Error('Choose an available teaching model in Settings before planning your course.');
    if (this.job) throw new Error('A course outline is already being prepared.');
    const ids = [...new Set(input.documentIds)]; if (!ids.length || ids.length > 5) throw new Error('Choose between one and five study materials.');
    const documents = ids.map(id => { const doc = this.options.documents.loadDocument(id); if (!doc) throw new Error('A selected study material was not found.'); return doc; });
    assertLearnerSafe(documents,'study-material');
    if (documents.some(doc => !['ready', 'partial'].includes(doc.manifest.status) || !doc.sections.some(section => section.text.trim()))) throw new Error('This document has no readable extracted content. Choose a text-searchable PDF or notes.');
    if (documents.reduce((sum, doc) => sum + doc.manifest.byteSize, 0) > 50 * 1024 * 1024 || documents.reduce((sum, doc) => sum + doc.manifest.pages.length, 0) > 200) throw new Error('Choose a smaller set of materials or page range for this course.');
    const evidence = this.evidence(documents.flatMap(doc => doc.sections).filter(section => section.text.trim()));
    const batches: SourceExcerpt[][] = []; let batch: SourceExcerpt[] = [], bytes = 0;
    for (const excerpt of evidence) { const size = new TextEncoder().encode(JSON.stringify(excerpt)).byteLength; if (bytes + size > 48 * 1024 && batch.length) { batches.push(batch); batch = []; bytes = 0; } batch.push(excerpt); bytes += size; }
    if (batch.length) batches.push(batch); if (batches.length > 32) throw new Error('This source needs more than 32 processing batches. Choose a smaller page range.');
    const job = new AbortController(); this.job = job;
    const selectedScope=this.options.provider.scope?.(),scope=selectedScope?{...selectedScope}:undefined,identity=this.options.provider.identity?.(),snapshot=JSON.stringify(documents),task:SafetyTask={operation:'course',originalRequest:'Create a course from the selected study materials.',subjectId:`course:${ids.join(',')}`,context:{documents}};
    let safetyPermit:SafetyPermit|undefined;
    const current=()=>{job.signal.throwIfAborted();if(this.job!==job||this.options.model()!==model||identity!==this.options.provider.identity?.()||JSON.stringify(scope)!==JSON.stringify(this.options.provider.scope?.()))throw new Error('The teaching connection changed. Retry course planning.');if(this.options.safety&&JSON.stringify(ids.map(id=>this.options.documents.loadDocument(id)))!==snapshot)throw new Error('Your source material changed during course planning. Try again.');if(safetyPermit)this.options.safety?.assertCurrent(safetyPermit,task);};
    const verify = (refs: z.infer<typeof sourceSummarySchema>['sourceRefs'], supplied: z.infer<typeof sourceSummarySchema>['sourceRefs']) => { assertSuppliedSourceRefs(refs,supplied);for (const ref of refs) { if (!ids.includes(ref.documentId)) throw new Error('Course cites an unselected source.'); this.options.documents.assertSourceRef(ref); } };
    try {
      if(this.options.safety){safetyPermit=await this.options.safety.authorize(task,job.signal);current();await this.options.safety.inspect(documents,'study-material',job.signal);current();this.options.safety.derive(evidence,[documents],'study-material');}
      const cacheKey = `course-summary:${createHash('sha256').update(JSON.stringify(['provider-summaries-v2',scope?.providerId??'chatgpt',model,safetyPermit?.policyVersion??'legacy',safetyPermit?.binding??'legacy',documents.map(doc => [doc.manifest.id, doc.manifest.sha256, doc.manifest.extractionVersion])])).digest('hex')}`;
      let summaries: z.infer<typeof sourceSummarySchema>[];
      try { summaries = JSON.parse(this.options.sessions.getPreference(cacheKey) ?? '[]').map((value: unknown) => sourceSummarySchema.parse(value)); } catch { summaries = []; }
      assertLearnerSafe(summaries,'saved-content');if(this.options.safety){await this.options.safety.inspect(summaries,'saved-content',job.signal);current();}
      for (let index = 0; index < batches.length; index++) {
        current();
        const supplied=batches[index].map(excerpt=>excerpt.ref);
        if (summaries[index]) { verify(summaries[index].sourceRefs,supplied); continue; }
        const summary = await this.call(model, 'summary', { evidence: batches[index], warnings: documents.flatMap(doc => doc.manifest.warnings) }, sourceSummarySchema, job.signal, value => verify(value.sourceRefs,supplied),safetyPermit,current,task);
        current();const prior=summaries;summaries=[...summaries,summary];this.options.safety?.derive(summaries,[prior,summary],'saved-content');this.options.sessions.setPreference(cacheKey, JSON.stringify(summaries));
      }
      const supplied=summaries.flatMap(summary=>summary.sourceRefs);
      const outline = await this.call(model, 'outline', { materials: documents.map(doc => ({ name: doc.manifest.name, coverage: doc.manifest.coverage, warnings: doc.manifest.warnings })), summaries }, courseOutlineSchema, job.signal, value => {
        for (const concept of value.concepts) { if (!concept.sourceRefs.length) throw new Error('Each course concept needs source evidence.'); verify(concept.sourceRefs,supplied); }
        const conceptIds = value.concepts.map(concept => concept.id), assigned = value.lessons.flatMap(lesson => lesson.conceptIds);
        if (new Set(value.lessons.map(lesson => lesson.id)).size !== value.lessons.length || new Set(assigned).size !== assigned.length || assigned.length !== conceptIds.length || assigned.some(id => !conceptIds.includes(id))) throw new Error('Every course concept must belong to exactly one valid lesson.');
        for (const lesson of value.lessons) verify(lesson.sourceRefs,supplied);
      },safetyPermit,current,task);
      current();
      const plan = learningPlanSchema.parse({ id: randomUUID(), version: 1, title: outline.title, sourceDocumentIds: ids, concepts: outline.concepts });
      this.options.safety?.derive(plan,[outline,documents],'model-output');
      return this.options.sessions.transaction(()=>{current();const course=this.options.courses.createCourse(plan,ids,outline.lessons);this.options.safety?.derive(course,[plan,outline,documents],'saved-content');return course;});
    } finally { if (this.job === job) this.job = undefined; }
  }
  loadCourse(id: string): CourseRecord {
    const course = this.options.courses.loadCourse(id); if (!course) throw new Error('This course was not found.');
    assertLearnerSafe(course,'saved-content');
    this.options.safety?.assertApproved(course);const approved=this.options.safety?structuredClone(course):undefined;
    for (const lesson of course.lessons ?? []) if (lesson.sessionId) {
      const progress = this.options.sessions.loadLearningProgress(lesson.sessionId);
      if (progress) for (const conceptId of lesson.conceptIds) course.progress.conceptStates[conceptId] = progress.conceptStates[conceptId] ?? 'planned';
    }
    course.progress.status = course.plan.concepts.every(concept => course.progress.conceptStates[concept.id] === 'completed') ? 'completed' : 'planned';
    if(approved)this.options.safety?.derive(course,[approved],'saved-content');
    return course;
  }
  startCourseLesson(input: { courseId: string; lessonId: string }) {
    const course = this.loadCourse(input.courseId), lesson = course.lessons?.find(lesson => lesson.id === input.lessonId);
    if (!lesson) throw new Error('This course lesson was not found.');
    if (lesson.sessionId) {const saved=this.options.sessions.load(lesson.sessionId);assertLearnerSafe(saved,'saved-content');this.options.safety?.assertApproved(saved);return saved;}
    return this.options.sessions.transaction(() => {
      const session = this.options.sessions.create(lesson.title), concepts = course.plan.concepts.filter(concept => lesson.conceptIds.includes(concept.id)).map(concept => ({ ...concept, prerequisiteIds: concept.prerequisiteIds.filter(id => lesson.conceptIds.includes(id)) }));
      const plan = { ...course.plan, id: randomUUID(), title: lesson.title, concepts };
      this.options.safety?.derive(plan,[course],'saved-content');this.options.sessions.savePlan(session.id, plan);
      const created=this.options.sessions.load(session.id);this.options.safety?.derive(created,[course,plan],'saved-content');
      const linked=this.options.courses.linkSession(course.id,session.id,lesson.id);this.options.safety?.derive(linked,[course,created],'saved-content');return created;
    });
  }
}
