import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import katex from 'katex';
import {parseScene,studyNotesDocumentSchema,type SceneEntity,type StudyNotesDocument} from '@living-canvas/protocol';

// Avoid the `require` name: electron-vite injects its own ESM compatibility shim.
const assetRequire=createRequire(import.meta.url);
const escape=(text:unknown)=>String(text??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]!));
const number=(value:number)=>Number(value.toFixed(3));
const paragraphs=(text:string)=>text.split(/\n\s*\n/).filter(Boolean).map(part=>`<p>${escape(part).replace(/\n/g,'<br>')}</p>`).join('');
const math=(latex:string,displayMode=true)=>katex.renderToString(latex,{displayMode,throwOnError:false,trust:false,strict:'ignore',maxExpand:1000,output:'htmlAndMathml',errorColor:'#18243B'});
let cachedAssets:string|undefined;
function assets():string{
  if(cachedAssets)return cachedAssets;
  const cssPath=assetRequire.resolve('katex/dist/katex.min.css');
  const katexCss=readFileSync(cssPath,'utf8').replace(/src:[^;}]+/g,source=>{
    const file=source.match(/url\(fonts\/([\w-]+\.woff2)\)/)?.[1];
    return file?`src:url("data:font/woff2;base64,${readFileSync(join(dirname(cssPath),'fonts',file)).toString('base64')}") format("woff2")`:source;
  });
  const face=(family:string,weight:number,path:string)=>`@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};src:url("data:font/woff2;base64,${readFileSync(assetRequire.resolve(path)).toString('base64')}") format("woff2");font-display:block}`;
  cachedAssets=katexCss+face('DM Sans',400,'@fontsource/dm-sans/files/dm-sans-latin-400-normal.woff2')+face('DM Sans',600,'@fontsource/dm-sans/files/dm-sans-latin-600-normal.woff2')+face('Bricolage Grotesque',600,'@fontsource/bricolage-grotesque/files/bricolage-grotesque-latin-600-normal.woff2');
  return cachedAssets;
}

type Bounds={left:number;top:number;right:number;bottom:number};
function textLines(text:string):string[]{
  return text.split('\n').flatMap(line=>{
    if(line.length<=52)return [line];
    const result:string[]=[];let remaining=line;
    while(remaining.length>52){let cut=remaining.lastIndexOf(' ',52);if(cut<20)cut=52;result.push(remaining.slice(0,cut));remaining=remaining.slice(cut).trimStart();}
    if(remaining)result.push(remaining);return result;
  });
}
function bounds(entity:SceneEntity):Bounds{
  const font=entity.fontSize??18;
  let left=entity.x,top=entity.y,right=entity.x+1,bottom=entity.y+1;
  if(entity.kind==='circle'){const radius=entity.radius??20;left-=radius;top-=radius;right=entity.x+radius;bottom=entity.y+radius;}
  else if(entity.kind==='ellipse'){const width=Math.abs(entity.width??40),height=Math.abs(entity.height??30);left-=width/2;top-=height/2;right=entity.x+width/2;bottom=entity.y+height/2;}
  else if(entity.kind==='rect'){left+=Math.min(0,entity.width??40);top+=Math.min(0,entity.height??30);right=left+Math.abs(entity.width??40);bottom=top+Math.abs(entity.height??30);}
  else if(entity.kind==='text'){const lines=textLines(entity.text??entity.label??'');right=entity.x+Math.max(1,...lines.map(line=>[...line].length))*font*.62;bottom=entity.y+Math.max(1,lines.length)*font*1.3;}
  else if(entity.kind==='equation'){right=entity.x+Math.max(100,Math.min(900,(entity.text?.length??1)*font*.68));bottom=entity.y+Math.max(60,font*3);}
  else{
    const points=entity.points?.length?entity.points:[0,0,entity.width??80,entity.height??0];
    const xs:number[]=[],ys:number[]=[];for(let index=0;index+1<points.length;index+=2){xs.push(entity.x+points[index]);ys.push(entity.y+points[index+1]);}
    if(xs.length){left=Math.min(...xs);right=Math.max(...xs);top=Math.min(...ys);bottom=Math.max(...ys);}
  }
  if(entity.label&&entity.kind!=='text'&&entity.kind!=='equation'){
    const width=Math.max(...textLines(entity.label).map(line=>[...line].length),1)*font*.62;
    left=Math.min(left,entity.x-width/2);right=Math.max(right,entity.x+width/2);bottom+=textLines(entity.label).length*font*1.3+8;
  }
  if(entity.rotation){
    const radians=entity.rotation*Math.PI/180,cos=Math.cos(radians),sin=Math.sin(radians);
    const corners=[[left,top],[left,bottom],[right,top],[right,bottom]].map(([x,y])=>[entity.x+(x-entity.x)*cos-(y-entity.y)*sin,entity.y+(x-entity.x)*sin+(y-entity.y)*cos]);
    left=Math.min(...corners.map(point=>point[0]));right=Math.max(...corners.map(point=>point[0]));top=Math.min(...corners.map(point=>point[1]));bottom=Math.max(...corners.map(point=>point[1]));
  }
  const padding=Math.max(8,entity.strokeWidth??2);return {left:left-padding,top:top-padding,right:right+padding,bottom:bottom+padding};
}
function entityMarkup(entity:SceneEntity):string{
  const {x,y}=entity,font=entity.fontSize??18,stroke=escape(entity.stroke??'#18243B'),fill=escape(entity.fill??'none');
  const paint=`stroke="${stroke}" stroke-width="${entity.strokeWidth??2}" fill="${fill}"`;
  const lines=(text:string,atX:number,atY:number,anchor='start')=>`<text x="${atX}" y="${atY}" fill="${stroke}" stroke="none" font-size="${font}" text-anchor="${anchor}" font-family="DM Sans, Nirmala UI, Segoe UI, sans-serif">${textLines(text).map((line,index)=>`<tspan x="${atX}" dy="${index?font*1.3:font}">${escape(line)}</tspan>`).join('')}</text>`;
  let shape:string;
  if(entity.kind==='circle')shape=`<circle cx="${x}" cy="${y}" r="${entity.radius??20}" ${paint}/>`;
  else if(entity.kind==='ellipse')shape=`<ellipse cx="${x}" cy="${y}" rx="${Math.abs(entity.width??40)/2}" ry="${Math.abs(entity.height??30)/2}" ${paint}/>`;
  else if(entity.kind==='rect')shape=`<rect x="${x+Math.min(0,entity.width??40)}" y="${y+Math.min(0,entity.height??30)}" width="${Math.abs(entity.width??40)}" height="${Math.abs(entity.height??30)}" rx="3" ${paint}/>`;
  else if(entity.kind==='text')shape=lines(entity.text??entity.label??'',x,y);
  else if(entity.kind==='equation')shape=`<foreignObject x="${x}" y="${y}" width="${Math.max(100,Math.min(900,(entity.text?.length??1)*font*.68))}" height="${Math.max(60,font*3)}"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${font}px;color:${stroke};padding:4px">${math(entity.text??'',false)}</div></foreignObject>`;
  else{
    const points=entity.points?.length?entity.points:[0,0,entity.width??80,entity.height??0];const pairs:string[]=[];
    for(let index=0;index+1<points.length;index+=2)pairs.push(`${number(x+points[index])},${number(y+points[index+1])}`);
    shape=`<polyline points="${pairs.join(' ')}" ${paint} stroke-linecap="round" stroke-linejoin="round"${entity.kind==='arrow'?' marker-end="url(#notes-arrow)"':''}/>`;
  }
  if(entity.label&&entity.kind!=='text'&&entity.kind!=='equation'){
    const withoutLabel={...entity,label:undefined},edge=bounds(withoutLabel).bottom;
    shape+=lines(entity.label,x,edge+2,'middle');
  }
  return `<g opacity="${entity.opacity??1}"${entity.rotation?` transform="rotate(${entity.rotation} ${x} ${y})"`:''}>${shape}</g>`;
}

/** Render only the validated, already-presented primitives; never simulation code. */
export function renderNotesDiagram(input:SceneEntity[]):string{
  const entities=parseScene(input);if(!entities.length)return '';
  const boxes=entities.map(bounds),left=Math.min(...boxes.map(box=>box.left))-14,top=Math.min(...boxes.map(box=>box.top))-14;
  const width=Math.max(80,Math.max(...boxes.map(box=>box.right))-left+14),height=Math.max(60,Math.max(...boxes.map(box=>box.bottom))-top+14);
  const displayedHeight=Math.max(140,Math.min(300,height/width*650));
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Diagram from your lesson" viewBox="${number(left)} ${number(top)} ${number(width)} ${number(height)}" preserveAspectRatio="xMidYMid meet" style="display:block;width:100%;height:${number(displayedHeight)}px"><defs><marker id="notes-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto-start-reverse" markerUnits="strokeWidth"><path d="M0 0 L8 4 L0 8 Z" fill="#18243B"/></marker></defs>${entities.map(entityMarkup).join('')}</svg>`;
}

export function renderNotesHtml(input:StudyNotesDocument):string{
  const document=studyNotesDocumentSchema.parse(input),notes=document.content;
  const usedVisuals=new Set<number>();
  const figure=(index:number)=>{const visual=document.visuals[index],diagram=renderNotesDiagram(visual.entities);return diagram?`<figure>${diagram}<figcaption>${escape(visual.title)}</figcaption></figure>`:'';};
  const sections=notes.sections.map((section,index)=>{
    const diagrams=document.visuals.flatMap((visual,visualIndex)=>{if(usedVisuals.has(visualIndex)||!section.evidenceIds.includes(visual.evidenceId))return [];usedVisuals.add(visualIndex);return [figure(visualIndex)];}).join('');
    return `<section class="topic"><h2><span class="section-number">${String(index+1).padStart(2,'0')}</span>${escape(section.title)}</h2>${paragraphs(section.explanation)}${section.keyPoints.length?`<aside class="key-points"><h3>Keep in mind</h3><ul>${section.keyPoints.map(point=>`<li>${escape(point)}</li>`).join('')}</ul></aside>`:''}${section.definitions.length?`<div class="definitions"><h3>Words to know</h3><dl>${section.definitions.map(item=>`<div><dt>${escape(item.term)}</dt><dd>${paragraphs(item.meaning)}</dd></div>`).join('')}</dl></div>`:''}${section.equations.map(item=>`<div class="equation-card"><div class="math">${math(item.latex)}</div>${paragraphs(item.explanation)}</div>`).join('')}${section.examples.map(item=>`<div class="example"><h3>${escape(item.title)}</h3>${paragraphs(item.explanation)}</div>`).join('')}${diagrams}</section>`;
  }).join('');
  const remaining=document.visuals.flatMap((_visual,index)=>usedVisuals.has(index)?[]:[figure(index)]).join('');
  const date=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(document.createdAt));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; object-src 'none'"><title>${escape(notes.title)} · Canvas Atlas</title><style>${assets()}
    @page { size: A4; }
    * { box-sizing: border-box; }
    html { background: #FFFFFF; color: #18243B; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font: 11pt/1.62 "DM Sans", "Nirmala UI", "Segoe UI", sans-serif; overflow-wrap: anywhere; }
    header { border-bottom: 2px solid #7775E7; padding-bottom: 18px; margin-bottom: 23px; }
    .brand { display: flex; align-items: center; gap: 8px; font-weight: 600; font-size: 10pt; letter-spacing: .04em; }
    .brand-mark { color: #7775E7; font-size: 19pt; line-height: 1; }
    .eyebrow { margin: 20px 0 7px; color: #5754BD; font-size: 9pt; text-transform: uppercase; letter-spacing: .12em; font-weight: 600; }
    h1,h2,h3 { font-family: "Bricolage Grotesque", "Nirmala UI", "Segoe UI", sans-serif; font-weight: 600; line-height: 1.23; break-after: avoid; }
    h1 { font-size: 28pt; margin: 0 0 14px; letter-spacing: -.6px; }
    .metadata { display: flex; flex-wrap: wrap; gap: 6px 18px; color: #667185; font-size: 9pt; }
    .scope { margin: 9px 0 0; color: #667185; font-size: 9pt; }
    .overview { background: #F0EFFC; border-left: 4px solid #7775E7; padding: 14px 18px; margin: 0 0 26px; border-radius: 0 10px 10px 0; box-decoration-break: clone; }
    p { margin: 0 0 10px; orphans: 3; widows: 3; }
    .topic { margin: 25px 0 29px; }
    h2 { font-size: 18pt; display: flex; align-items: baseline; gap: 12px; margin: 0 0 15px; padding-bottom: 8px; border-bottom: 1px solid #DFE4EC; }
    .section-number { color: #7775E7; font: 600 10pt/1.3 "DM Sans", sans-serif; }
    h3 { font-size: 11pt; margin: 0 0 6px; }
    ul { margin: 6px 0 0; padding-left: 20px; } li { margin-bottom: 5px; orphans: 2; widows: 2; }
    .key-points { background: #F5F7FA; padding: 13px 17px; border-radius: 10px; margin: 14px 0; box-decoration-break: clone; }
    .key-points li::marker { color: #5754BD; }
    .definitions { border-left: 3px solid #61A68B; background: #EDF7F1; padding: 13px 17px; margin: 15px 0; border-radius: 0 10px 10px 0; box-decoration-break: clone; }
    dl { margin: 8px 0 0; } dl>div { margin-bottom: 10px; } dt { font-weight: 600; } dd { margin: 2px 0 0; }
    .equation-card { margin: 16px 0; padding: 13px 17px; border: 1px solid #D9D5F7; border-radius: 10px; break-inside: avoid; }
    .math { margin: 3px 0 9px; color: #34316F; overflow-wrap: anywhere; } .katex-display { margin: .4em 0; } .katex { font-size: 1.07em; }
    .example { background: #FFF5E5; border-left: 3px solid #D78A64; margin: 15px 0; padding: 13px 17px; border-radius: 0 10px 10px 0; box-decoration-break: clone; }
    .example p:last-child,.definitions p:last-child,.overview p:last-child,.equation-card p:last-child { margin-bottom: 0; }
    figure { margin: 18px 0; padding: 12px 14px 9px; border: 1px solid #DFE4EC; border-radius: 10px; break-inside: avoid; }
    figcaption { color: #667185; text-align: center; font-size: 9pt; padding-top: 7px; }
    .revision { margin: 27px 0 0; padding-top: 15px; border-top: 2px solid #7775E7; }
    .recap { background: #EDF7F1; padding: 14px 18px; border-radius: 10px; box-decoration-break: clone; }
    .question { margin: 17px 0; break-inside: avoid; } .question h3 { color: #5754BD; } .answer-label { color: #667185; font-size: 9pt; font-weight: 600; margin: 7px 0 3px; break-after: avoid; }
  </style></head><body><header><div class="brand"><span class="brand-mark">✦</span>canvas atlas.</div><div class="eyebrow">Your study notes</div><h1>${escape(notes.title)}</h1><div class="metadata"><span>${escape(date)}</span><span>${document.studiedSteps} explained ${document.studiedSteps===1?'step':'steps'}</span></div><p class="scope">${escape(document.topic)}</p></header><div class="overview">${paragraphs(notes.overview)}</div>${sections}${remaining?`<section><h2>From your lesson canvas</h2>${remaining}</section>`:''}<section class="revision"><h2>Quick recap</h2><div class="recap"><ul>${notes.recap.map(point=>`<li>${escape(point)}</li>`).join('')}</ul></div></section>${notes.reviewQuestions.length?`<section class="revision"><h2>Check your understanding</h2>${notes.reviewQuestions.map((item,index)=>`<div class="question"><h3>${index+1}. ${escape(item.question)}</h3><div class="answer-label">Answer</div>${paragraphs(item.answer)}</div>`).join('')}</section>`:''}</body></html>`;
}
