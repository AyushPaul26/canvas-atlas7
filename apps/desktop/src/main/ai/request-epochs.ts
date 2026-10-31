export class RequestEpochs {
  private current=new Map<string,{epoch:number;controller:AbortController}>();
  begin(sessionId:string){const previous=this.current.get(sessionId);previous?.controller.abort();const entry={epoch:(previous?.epoch??0)+1,controller:new AbortController()};this.current.set(sessionId,entry);return {epoch:entry.epoch,signal:entry.controller.signal};}
  interrupt(sessionId:string){return this.begin(sessionId).epoch;}
  isCurrent(sessionId:string,epoch:number){const entry=this.current.get(sessionId);return entry?.epoch===epoch&&!entry.controller.signal.aborted;}
  cancelAll(){for(const entry of this.current.values())entry.controller.abort();}
}
