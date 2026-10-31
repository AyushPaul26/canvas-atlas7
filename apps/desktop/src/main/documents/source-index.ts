import type { DatabaseSync } from 'node:sqlite';
import { assertSourceRef, type DocumentSection, type SourceExcerpt, type SourceRef } from '@living-canvas/protocol';

const encoder = new TextEncoder();
const tokens = (text: string) => [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
export class SourceIndex {
  private sections: DocumentSection[] = [];
  private fullText = false;
  constructor(private db?: DatabaseSync) {
    if (db) try { db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS temp.atlas_source_search USING fts5(key UNINDEXED, text)'); this.fullText = true; } catch { /* Deterministic lexical retrieval remains available. */ }
  }
  replace(sections: DocumentSection[]) {
    this.sections = sections.filter(section => section.text.trim());
    if (this.fullText && this.db) {
      this.db.exec('DELETE FROM temp.atlas_source_search');
      const insert = this.db.prepare('INSERT INTO temp.atlas_source_search(key,text) VALUES(?,?)');
      this.sections.forEach((section, index) => insert.run(String(index), section.text));
    }
  }
  retrieveEvidence(input: { documentIds: string[]; query: string; sourceRefs?: SourceRef[] }, budgetBytes = 32 * 1024): SourceExcerpt[] {
    const allowed = this.sections.filter(section => input.documentIds.includes(section.documentId));
    const words = tokens(input.query);
    const scores = new Map<DocumentSection, number>();
    allowed.forEach(section => scores.set(section, words.reduce((score, word) => score + (section.text.toLowerCase().includes(word) ? 1 : 0) + (section.title?.toLowerCase().includes(word) ? 3 : 0), 0)));
    if (this.fullText && words.length && this.db) try {
      const rows = this.db.prepare('SELECT key FROM temp.atlas_source_search WHERE text MATCH ? ORDER BY bm25(atlas_source_search) LIMIT 24').all(words.map(word => `"${word.replaceAll('"', '""')}"`).join(' OR ')) as { key: string }[];
      rows.forEach((row, rank) => { const section = this.sections[Number(row.key)]; if (scores.has(section)) scores.set(section, 100 - rank); });
    } catch { /* Unsupported tokenizer/query: keep lexical ranking. */ }
    const result: SourceExcerpt[] = [];
    const add = (ref: SourceRef,capBytes=budgetBytes) => {
      assertSourceRef(ref, allowed); const section = allowed.find(section => section.id === ref.sectionId && section.documentId === ref.documentId)!;
      if (result.some(item => item.ref.documentId === ref.documentId && item.ref.sectionId === ref.sectionId && item.ref.start === ref.start)) return;
      let end = Math.min(ref.end, ref.start + 12000);
      if (/[\uD800-\uDBFF]/.test(section.text[end - 1] ?? '')) end--;
      const excerptAt=(limit:number):SourceExcerpt=>{
        if (/[\uD800-\uDBFF]/.test(section.text[limit - 1] ?? '')&&/[\uDC00-\uDFFF]/.test(section.text[limit]??''))limit--;
        return {ref:{...ref,end:limit},text:section.text.slice(ref.start,limit),warnings:limit<ref.end?['This excerpt is partial; the remaining source is available locally.']:[]};
      };
      const fits=(limit:number)=>encoder.encode(JSON.stringify([...result,excerptAt(limit)])).byteLength<=capBytes;
      if(!fits(end)){let low=ref.start,high=end;while(low<high){const middle=Math.ceil((low+high)/2);if(fits(middle))low=middle;else high=middle-1;}end=low;}
      const excerpt=excerptAt(end);if(excerpt.ref.end<=ref.start)return;assertSourceRef(excerpt.ref,allowed);result.push(excerpt);
    };
    const matchOffsets=(section:DocumentSection)=>words.map(word=>new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'iu').exec(section.text)?.index).filter((index):index is number=>index!==undefined);
    const deepMatch=allowed.some(section=>matchOffsets(section).some(offset=>offset>=12000));
    for (const ref of input.sourceRefs ?? []) if (input.documentIds.includes(ref.documentId)) add(ref,deepMatch?Math.floor(budgetBytes/2):budgetBytes);
    if (!result.length && ![...scores.values()].some(score => score > 0)) return [];
    for (const section of [...allowed].sort((a, b) => (scores.get(b) ?? 0) - (scores.get(a) ?? 0))) {
      if (!(scores.get(section) ?? 0)) continue;
      // Lowercasing may change UTF-16 length (for example capital dotted I).
      // Match on the canonical text so reference offsets remain exact.
      const matches=matchOffsets(section);
      for(const offset of matches.length?matches.reverse():[0]){
        if(result.some(item=>item.ref.documentId===section.documentId&&item.ref.sectionId===section.id&&offset>=item.ref.start&&offset<item.ref.end))continue;
        let start=Math.max(0,offset-128);
        if(start>0&&/[\uD800-\uDBFF]/.test(section.text[start-1])&&/[\uDC00-\uDFFF]/.test(section.text[start]))start--;
        add({ documentId: section.documentId, extractionVersion: section.extractionVersion, sectionId: section.id, ...(section.page ? { page: section.page } : {}), start, end: section.text.length });
        if(result.length>=8)break;
      }
      if (result.length >= 8) break;
    }
    return result;
  }
}
