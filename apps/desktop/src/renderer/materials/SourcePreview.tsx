import { useEffect, useRef, useState } from 'react';
import type { SourceRef, SourcePreview as Preview } from '@living-canvas/protocol';
import { bridge } from '../bridge';

export default function SourcePreview({ source, onClose }: { source: SourceRef; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [preview, setPreview] = useState<Preview>();
  const [error, setError] = useState('');
  useEffect(() => { const target = document.activeElement as HTMLElement | null; dialog.current?.showModal(); return () => { dialog.current?.close(); target?.focus(); }; }, []);
  useEffect(() => { let active = true; void bridge.getSourcePreview(source).then(result => { if (active) setPreview(result); }).catch(cause => { if (active) setError(String(cause)); }); return () => { active = false; }; }, [source]);
  return <dialog className="modal source-preview" ref={dialog} aria-labelledby="source-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="modal-header"><h2 id="source-title">Source{preview?.pageLabel || source.page ? ` · page ${preview?.pageLabel ?? source.page}` : ''}</h2><button autoFocus className="button secondary compact" type="button" onClick={onClose}>Close source</button></div>{error ? <p role="alert">Could not open this source: {error}</p> : !preview ? <p role="status">Opening the saved source…</p> : <><p>{preview.caption}</p>{source.page && preview.pageLabel && preview.pageLabel !== String(source.page) && <p className="subtle small-copy">Physical page {source.page} of the saved document</p>}{preview.dataUrl && <img src={preview.dataUrl} alt={preview.caption} />}{preview.text && <pre>{preview.text}</pre>}{preview.warnings.map(warning => <p key={warning} className="material-warning">{warning}</p>)}</>}</dialog>;
}
