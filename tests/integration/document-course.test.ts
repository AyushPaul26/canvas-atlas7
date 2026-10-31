import { describe, expect, it } from 'vitest';
import { SourceIndex } from '../../apps/desktop/src/main/documents/source-index';
import { CourseCoordinator } from '../../apps/desktop/src/main/ai/course-coordinator';
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository';
import { DocumentRepository } from '../../apps/desktop/src/main/storage/document-repository';
import { CourseRepository } from '../../apps/desktop/src/main/storage/course-repository';
import type { DocumentManifest, DocumentSection, SourceRef } from '@living-canvas/protocol';

const section: DocumentSection = { id: 'page-1', documentId: 'doc', extractionVersion: 1, page: 1, title: 'Force and distance', text: 'The force between masses follows an inverse-square relationship. Doubling distance gives one quarter of the force.' };
const ref: SourceRef = { documentId: 'doc', extractionVersion: 1, sectionId: 'page-1', page: 1, start: 0, end: section.text.length };
const manifest: DocumentManifest = { id: 'doc', name: 'Physics.pdf', mimeType: 'application/pdf', byteSize: 100, sha256: 'a'.repeat(64), extractionVersion: 1, status: 'partial', pages: [{ index: 1, status: 'extracted', sectionIds: ['page-1'] }, { index: 2, status: 'empty', sectionIds: [] }], warnings: ['Page 2 is unreadable.'], coverage: .5, createdAt: new Date().toISOString() };
describe('source-grounded courses', () => {
  it('retrieves bounded real excerpts with verified ranges and prioritizes the active concept', () => {
    const index = new SourceIndex(); index.replace([section, { ...section, id: 'other', text: 'An unrelated section about plants.' }]);
    const evidence = index.retrieveEvidence({ documentIds: ['doc'], query: 'distance force', sourceRefs: [ref] }, 1000);
    expect(evidence[0]).toMatchObject({ ref, text: section.text });
    expect(new TextEncoder().encode(JSON.stringify(evidence)).byteLength).toBeLessThan(1100);
    expect(() => index.retrieveEvidence({ documentIds: ['doc'], query: 'force', sourceRefs: [{ ...ref, page: 99 }] })).toThrow(/source/i);
  });
  it('plans from readable material, retains warnings, and rejects invented citations', async () => {
    const sessions = new SessionRepository(':memory:'); const documents = new DocumentRepository(sessions.db); const courses = new CourseRepository(sessions.db);
    documents.saveDocument(manifest, [section]);
    const requests: any[] = [];
    let invalid = false;
    const provider = { complete: async (request: any) => {
      requests.push(request); const name = request.tools[0].tools[0].name;
      const value = name === 'summarize_source' ? { summary: 'Masses attract; distance has an inverse-square effect.', sourceRefs: [ref] } : { title: 'Physics from your material', concepts: [{ id: 'force', title: 'Force and distance', objectives: ['Predict how force changes'], prerequisiteIds: [], sourceRefs: [{ ...ref, ...(invalid ? { page: 99 } : {}) }] }], lessons: [{ id: 'lesson-1', title: 'Gravitational force', objectives: ['Explain the relationship'], conceptIds: ['force'], sourceRefs: [ref] }] };
      return { text: '', output: [], calls: [{ type: 'function_call' as const, namespace: 'course', name, call_id: String(requests.length), arguments: JSON.stringify(value) }] };
    } };
    const coordinator = new CourseCoordinator({ sessions, documents, courses, provider, model: () => 'selected' });
    try {
      const course = await coordinator.planCourse({ documentIds: ['doc'] });
      expect(course.lessons?.[0].sourceRefs).toEqual([ref]);
      expect(course.plan.sourceDocumentIds).toEqual(['doc']);
      expect(requests[0].input[0].content).toContain('inverse-square');
      expect(requests[0].input[0].content).not.toContain('Page 2 text');
      expect((course as any).warnings).toBeUndefined(); // Coverage warnings remain on the actual material manifest.
      invalid = true;
      await expect(coordinator.planCourse({ documentIds: ['doc'] })).rejects.toThrow(/source|course|page/i);
    } finally { sessions.close(); }
  });
});
