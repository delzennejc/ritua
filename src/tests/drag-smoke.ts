import type { BrowserWindow } from 'electron'
export async function verifyNativeDrag(window:BrowserWindow) {
  window.show();window.focus()
  const inspect=()=>window.webContents.executeJavaScript(`(async()=>{
    for(let i=0;i<100;i++) {
      const handle=document.querySelector('[aria-label="Resize Calendar resize task from the bottom"]');
      if(handle) {
        handle.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
        await new Promise(r=>setTimeout(r,80));
        const r=handle.getBoundingClientRect(), x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);
        const hit=document.elementFromPoint(x,y);
        if(!hit || !handle.contains(hit)) continue;
        const doc=await window.ritua.loadWorkspace();const event=doc.entities.find(e=>e.kind==='event'&&e.id==='before');
        return {x,y,end:event.data.content.end};
      }
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error('Missing native resize handle');
  })()`)
  const move=async(point:{x:number;y:number},cancel:boolean)=>{
    window.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y})
    window.webContents.sendInputEvent({type:'mouseDown',x:point.x,y:point.y,button:'left',clickCount:1})
    for(let step=1;step<=12;step++) {
      window.webContents.sendInputEvent({type:'mouseMove',x:point.x,y:point.y+step*4,button:'left'})
      await new Promise(r=>setTimeout(r,20))
    }
    if(cancel) window.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'})
    window.webContents.sendInputEvent({type:'mouseUp',x:point.x,y:point.y+48,button:'left',clickCount:1})
    if(cancel) window.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'})
  }
  const before=await inspect()
  await move(before,false)
  const after=await window.webContents.executeJavaScript(`(async()=>{
    for(let i=0;i<100;i++) {
      const doc=await window.ritua.loadWorkspace();const event=doc.entities.find(e=>e.kind==='event'&&e.id==='before');const task=doc.entities.find(e=>e.kind==='task'&&e.id==='before');
      if(event.data.content.end>${before.end} && task.data.content.minutes===event.data.content.end-event.data.content.start) return event.data.content.end;
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error('Native resize must persist both calendar and task duration atomically');
  })()`)
  const point=await inspect()
  await move(point,true)
  await new Promise(r=>setTimeout(r,200))
  const cancelled=await inspect()
  if(cancelled.end!==after) throw new Error('Canceled resize changed durable time')
  window.hide()
  return after as number
}
