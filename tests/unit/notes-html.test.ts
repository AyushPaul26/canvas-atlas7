import {describe,expect,it} from 'vitest';
import type {StudyNotesDocument} from '@living-canvas/protocol';
import {renderNotesHtml,renderNotesDiagram} from '../../apps/desktop/src/main/notes/notes-html';

const fixture=():StudyNotesDocument=>({
  version:1,id:'a2cc0341-36fe-4ec7-9ae8-e2e36c71ad46',sessionId:'lesson',topic:'Earth and the Sun',createdAt:'2026-10-31T10:30:00.000Z',coverageHash:'a'.repeat(64),studiedSteps:2,
  content:{title:'Earth’s yearly journey',overview:'A clear record of the explanation you studied.',sections:[{title:'Orbit and rotation',evidenceIds:['heard-1'],explanation:'Earth follows an orbit around the Sun.\n\nRotation is a different motion.',keyPoints:['An orbit is a path.'],definitions:[{term:'Revolution',meaning:'Travel around another body.'}],equations:[{latex:'T = 1\\,\\text{year}',explanation:'T represents one orbital period.'}],examples:[{title:'A quarter of an orbit',explanation:'After about three months, Earth has completed a quarter of its yearly trip.'}]}],recap:['Revolution and rotation describe different motions.'],reviewQuestions:[{question:'Which motion takes about one year?',answer:'Earth’s revolution around the Sun.',evidenceIds:['heard-1']}]},
  visuals:[{evidenceId:'heard-1',title:'The orbit shown in your lesson',entities:[{id:'sun',kind:'circle',x:300,y:260,radius:30,fill:'#F7C870',label:'Sun'},{id:'earth',kind:'circle',x:410,y:260,radius:12,fill:'#3C9B80',label:'Earth'}]}],
  modelMetadata:{providerId:'gemini',requestedModel:'gemini-fixture',servedModel:'gemini-fixture',completedAt:'2026-10-31T10:30:00.000Z'},
});
const inspect=(html:string)=>html.replace(/data:font\/woff2;base64,[A-Za-z0-9+/=]+/g,'data:font/woff2;base64,FIXTURE');

describe('colourful local notes template',()=>{
  it('includes detailed structured content, equations, diagrams and readable print rules',()=>{
    const html=inspect(renderNotesHtml(fixture()));
    for(const text of ['Earth’s yearly journey','Orbit and rotation','An orbit is a path.','Revolution','A quarter of an orbit','Quick recap','Check your understanding','Which motion takes about one year?','2 explained steps'])expect(html).toContain(text);
    expect(html).toContain('class="katex"');expect(html).toContain('<svg');
    expect(html).toContain('size: A4');expect(html).toContain('break-after: avoid');
    expect(html).toContain('font/woff2;base64,');
    expect(html).not.toMatch(/(?:src|href)=["']https?:/i);
    expect(html).not.toContain('undefined');
  });
  it('escapes AI text in every field and prevents executable markup and untrusted KaTeX links',()=>{
    const document=fixture(),attack='</style><script>alert(1)</script><img src="https://evil.invalid/x" onerror="alert(2)">';
    document.content.title=attack;document.content.overview=attack;document.content.sections[0].explanation=attack;
    document.content.sections[0].keyPoints=[attack];document.content.sections[0].definitions=[{term:attack,meaning:attack}];
    document.content.sections[0].examples=[{title:attack,explanation:attack}];
    document.content.sections[0].equations=[{latex:'\\href{https://evil.invalid/}{click}',explanation:attack}];
    document.content.recap=[attack];document.content.reviewQuestions=[{question:attack,answer:attack,evidenceIds:['heard-1']}];
    document.visuals[0].title=attack;document.visuals[0].entities.push({id:'label',kind:'text',x:300,y:310,text:attack});
    const html=inspect(renderNotesHtml(document));
    expect(html).not.toContain('<script>');expect(html).not.toContain('<img ');
    expect(html).not.toContain('href="https://evil.invalid/"');
    expect(html).toContain('&lt;script&gt;');expect(html).toContain('default-src');
  });
  it('keeps long Unicode explanations as flowing paragraphs without clipping or fixed-height content',()=>{
    const document=fixture();document.content.sections[0].explanation=Array.from({length:22},(_,index)=>`विचार ${index+1} — पृथ्वी सूर्य की परिक्रमा करती है. Ελληνικά: τροχιά. 中文：轨道。`).join('\n\n');
    const html=inspect(renderNotesHtml(document));
    expect(html).toContain('विचार 22');expect(html).toContain('轨道');
    expect(html.match(/<p>/g)!.length).toBeGreaterThan(22);
    const documentStyles=html.slice(html.indexOf('@page'));
    expect(documentStyles).not.toContain('overflow: hidden');expect(documentStyles).not.toContain('max-height:');
  });
  it('crops a presented diagram to its actual marks and escapes labels while retaining all primitive kinds',()=>{
    const entities=fixture().visuals[0].entities;
    entities.push({id:'caption',kind:'text',x:290,y:310,text:'Sun < Earth'},
      {id:'line',kind:'line',x:290,y:240,points:[0,0,90,0]},
      {id:'arrow',kind:'arrow',x:300,y:300,points:[0,0,65,0]},
      {id:'orbit',kind:'ellipse',x:300,y:260,width:140,height:60,fill:'transparent'},
      {id:'box',kind:'rect',x:280,y:220,width:20,height:15,fill:'none'},
      {id:'path',kind:'path',x:280,y:200,points:[0,0,20,20,40,0]},
      {id:'plot',kind:'plot',x:290,y:240,points:[0,0,20,-10,40,-30]},
      {id:'equation',kind:'equation',x:290,y:345,text:'T=1'});
    const svg=renderNotesDiagram(entities);
    expect(svg).toContain('Sun &lt; Earth');expect(svg).toContain('<ellipse');expect(svg).toContain('<rect');expect(svg).toContain('<polyline');expect(svg).toContain('marker-end');expect(svg).toContain('katex');
    const viewBox=svg.match(/viewBox="([^"]+)"/)![1].split(' ').map(Number);
    expect(viewBox).toHaveLength(4);expect(viewBox.every(Number.isFinite)).toBe(true);expect(viewBox[2]).toBeLessThan(1000);expect(viewBox[3]).toBeLessThan(650);
  });
  it('does not depend on the app locale for a stable date or show internal evidence identifiers',()=>{
    const document=fixture();const html=inspect(renderNotesHtml(document));
    expect(html).toContain('31 October 2026');expect(html).not.toContain('heard-1');expect(html).not.toContain(document.coverageHash);
  });
});
