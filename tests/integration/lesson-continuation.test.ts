import { expect, it } from 'vitest'
import { LessonCoordinator } from '../../apps/desktop/src/main/ai/lesson-coordinator'
import { SessionRepository } from '../../apps/desktop/src/main/storage/session-repository'
import type { TutorEvent, TeachingBeat } from '@living-canvas/protocol'

function setup(next: TeachingBeat['next'] = 'continue', later: TeachingBeat['next'] = 'ask') {
  const store = new SessionRepository(':memory:'); const lesson = store.create('an unfamiliar concept'); const events: TutorEvent[] = []; const requests: any[] = []
  const provider = { complete: async (request: any) => {
    requests.push(structuredClone(request))
    const beat = { id: 'untrusted', narration: requests.length === 1 ? 'An opening explanation.' : 'A worked example that develops the idea.', next: requests.length === 1 ? next : later, canvas: { mode: 'append', entities: [] } }
    const call = { type: 'function_call' as const, call_id: String(requests.length), name: 'present_beat', namespace: 'teaching', arguments: JSON.stringify(beat) }
    return { calls: [call], output: [call], text: '', modelMetadata: { requestedModel: request.model, servedModel: 'account-astra', responseId: 'r' + requests.length, completedAt: new Date().toISOString() } }
  } }
  const teacher = { buildTeacherInstructions: () => '', buildLessonContext: (_lesson: any, request: string, selectedIds?: string[]) => JSON.stringify({request,selectedIds}), getTeachingToolParameters: () => ({}), parseTeachingBeat: (value: any) => value }
  const coordinator = new LessonCoordinator({ store, provider, teacher, model: () => 'account-astra', emit: event => events.push(event) })
  const complete = () => { const event = events.filter(e => e.type === 'beat').at(-1) as Extract<TutorEvent, { type: 'beat' }>; coordinator.presentProgress({ sessionId: lesson.id, epoch: event.epoch, beatId: event.beat.id, scene: [], narration: event.beat.narration, complete: true }); return event.epoch }
  return { store, lesson, events, requests, coordinator, complete }
}
it('continues a presented lesson once without inventing a student message', async () => {
  const value = setup()
  try {
    await value.coordinator.send({ sessionId: value.lesson.id, text: 'Please teach me' })
    const epoch = value.complete()
    await value.coordinator.continueLesson({ sessionId: value.lesson.id, epoch })
    expect(value.requests).toHaveLength(2)
    expect(value.requests[1].input.at(-1).content).toMatch(/continue/i)
    expect(value.requests[1].input.some((item:any)=>item.role==='user')).toBe(false)
    expect(value.store.load(value.lesson.id).messages.filter(message => message.role === 'student').map(message => message.text)).toEqual(['Please teach me'])
    expect(value.events.filter(event => event.type === 'model')).toHaveLength(2)
    expect(value.store.load(value.lesson.id).modelRuns).toHaveLength(2)
    await value.coordinator.continueLesson({ sessionId: value.lesson.id, epoch })
    expect(value.requests).toHaveLength(2)
  } finally { value.store.close() }
})
it('preserves the selected drawing across continuation and settles at its automatic-round limit',async()=>{
  const value=setup('continue','continue')
  try{
    await value.coordinator.send({sessionId:value.lesson.id,text:'Explain this deeply',selectionIds:['focus']})
    for(let round=0;round<8;round++)await value.coordinator.continueLesson({sessionId:value.lesson.id,epoch:value.complete()})
    expect(value.requests).toHaveLength(9)
    expect(JSON.parse(value.requests[1].input.find((item:any)=>item.role==='developer').content).selectedIds).toEqual(['focus'])
    const epoch=value.complete();const previous=value.events.length
    await value.coordinator.continueLesson({sessionId:value.lesson.id,epoch})
    expect(value.requests).toHaveLength(9)
    expect(value.events.slice(previous)).toContainEqual({type:'status',sessionId:value.lesson.id,epoch,phase:'ready'})
  }finally{value.store.close()}
})
it('repairs a fresh model step without a progression decision instead of silently stopping',async()=>{
  const value=setup(null as any)
  try{
    await value.coordinator.send({sessionId:value.lesson.id,text:'Teach me this topic'})
    expect(value.requests).toHaveLength(2)
    expect(value.events.filter(event=>event.type==='beat')).toHaveLength(1)
    expect(value.requests[1].input.some((item:any)=>item.type==='function_call_output'&&/next/.test(item.output))).toBe(true)
  }finally{value.store.close()}
})
it('stages the whole response before presentation so a short first step cannot advance past a pending second step', async () => {
  const store = new SessionRepository(':memory:'); const lesson = store.create('topic'); const events: TutorEvent[] = []
  let release: () => void = () => {}
  const pending = new Promise<void>(resolve => { release = resolve })
  const first = { id: 'a', narration: 'Start.', next: 'continue', canvas: { mode: 'append', entities: [] } }
  const second = { ...first, id: 'b', narration: 'Now consider this example.', next: 'ask', simulation: { id: 'model', title: 'Model', source: 'generated', controls: [], assumptions: [], validation: 'illustrative' } }
  const calls = [first, second].map((beat, index) => ({ type: 'function_call' as const, call_id: String(index), name: 'present_beat', namespace: 'teaching', arguments: JSON.stringify(beat) }))
  const teacher = { buildTeacherInstructions: () => '', buildLessonContext: () => '', getTeachingToolParameters: () => ({}), parseTeachingBeat: (value: any) => value }
  const coordinator = new LessonCoordinator({ store, teacher, model: () => 'account-astra', emit: event => events.push(event), provider: { complete: async () => ({ calls, output: calls, text: '' }) }, prepareSimulation: async beat => { await pending; return beat } })
  try {
    const work = coordinator.send({ sessionId: lesson.id, text: 'Teach me' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(events.filter(event => event.type === 'beat')).toHaveLength(0)
    release(); await work
    expect(events.filter(event => event.type === 'beat')).toHaveLength(2)
  } finally { release(); store.close() }
})
it('does not advance from partial presentation, deliberate questions, or interrupted epochs', async () => {
  for (const next of ['continue', 'ask'] as const) {
    const value = setup(next)
    try {
      await value.coordinator.send({ sessionId: value.lesson.id, text: 'Teach me' })
      const event = value.events.find(e => e.type === 'beat') as Extract<TutorEvent, { type: 'beat' }>
      await value.coordinator.continueLesson({ sessionId: value.lesson.id, epoch: event.epoch })
      expect(value.requests).toHaveLength(1)
      const epoch = value.complete()
      if(next==='ask'){
        await value.coordinator.continueLesson({ sessionId: value.lesson.id, epoch })
        expect(value.requests).toHaveLength(1)
      }
      value.coordinator.interrupt(value.lesson.id)
      await value.coordinator.continueLesson({ sessionId: value.lesson.id, epoch })
      expect(value.requests).toHaveLength(1)
    } finally { value.store.close() }
  }
})
