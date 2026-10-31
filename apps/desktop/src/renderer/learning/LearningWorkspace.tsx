import { useState } from 'react';
import type { LessonSession, SourceRef } from '@living-canvas/protocol';
import Roadmap from './Roadmap';

export default function LearningWorkspace({ session, busy, onStart, onSource, onReturn, activeConceptId }: { session: LessonSession; busy: boolean; onStart: (id: string) => void; onSource: (ref: SourceRef) => void; onReturn?: () => void; activeConceptId?: string }) {
  const plan = session.plan, progress = session.learningProgress;
  if (!plan) return null;
  const concept = plan.concepts.find(item => item.id === (activeConceptId ?? progress?.activeConceptId));
  return <><div className="concept-context"><div><span className="eyebrow">{progress?.status === 'planned' && session.beats.length === 0 ? 'READY TO EXPLORE' : 'CURRENT CONCEPT'}</span><strong>{concept?.title ?? plan.title}</strong></div>{progress?.branchReturnPoint && onReturn && <button type="button" className="button secondary compact" disabled={busy} onClick={onReturn}>Back to lesson</button>}<span>{plan.concepts.filter(c => progress?.conceptStates[c.id] === 'completed').length} of {plan.concepts.length} concepts covered</span></div><details className="roadmap-disclosure" open={progress?.status === 'planned' && session.beats.length === 0}><summary>Learning roadmap</summary><Roadmap plan={plan} progress={progress && activeConceptId ? { ...progress, activeConceptId } : progress} busy={busy} onStart={onStart} onSource={onSource} /></details>{concept && <div className="source-links">{concept.sourceRefs.map((ref, i) => <button key={i} className="text-button" type="button" onClick={() => onSource(ref)}>View source{ref.page ? ` · page ${ref.page}` : ''}</button>)}</div>}</>;
}

export function UnderstandingCheck({ session, busy, onAnswer }: { session: LessonSession; busy: boolean; onAnswer: (text: string) => void }) {
  const [answer, setAnswer] = useState('');
  const check = session.learningProgress?.pendingCheck;
  if (!check || check.evidence) return null;
  return <section className="understanding-check" aria-label="Understanding check"><span className="eyebrow">A MOMENT TO THINK</span><p>{check.question}</p><form noValidate onSubmit={event => { event.preventDefault(); if (answer.trim()) { onAnswer(answer.trim()); setAnswer(''); } }}><label htmlFor="check-answer">Your answer</label><input id="check-answer" value={answer} maxLength={6000} onChange={event => setAnswer(event.target.value)} /><button className="button primary compact" disabled={busy || !answer.trim()}>Share answer</button><button type="button" className="text-button" disabled={busy} onClick={() => onAnswer('Help me with this understanding check. Please use a different explanation.')}>Help me think it through</button><button type="button" className="text-button" disabled={busy} onClick={() => onAnswer('Skip this understanding check and continue.')}>Skip for now</button></form><small>Listening covers a concept. Your answer helps the teacher understand what needs another look.</small></section>;
}
