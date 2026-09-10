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

export async function verifyScheduledProjectDrop(window: BrowserWindow) {
  window.show(); window.focus()
  const navigate = async (label: string) => {
    await window.webContents.executeJavaScript(`(() => {
      const button = [...document.querySelectorAll('nav button')].find(b => {
        const copy = b.cloneNode(true); copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(n => n.remove());
        return copy.textContent.trim() === ${JSON.stringify(label)};
      });
      if (!button) throw new Error('Missing navigation: ' + ${JSON.stringify(label)});
      button.click();
    })()`)
    await new Promise(r => setTimeout(r, 200))
  }
  const readTask = () => window.webContents.executeJavaScript(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    return { task: doc.entities.find(e => e.kind === 'task' && e.id === 'before'),
      event: doc.entities.find(e => e.kind === 'event' && e.id === 'before') };
  })()`)
  const original = await readTask()
  const drag = async (objectiveId: string | null, cancel = false) => {
    const points = await window.webContents.executeJavaScript(`(() => {
      const source = document.querySelector('[data-board-task-id="before"]');
      const target = [...document.querySelectorAll('[data-backlog-schedule-target="true"][data-collection-drop-proxy="true"]')]
        .find(e => (e.dataset.backlogObjectiveId || null) === ${JSON.stringify(objectiveId)} && e.dataset.backlogChannel === 'Work');
      if (!source || !target) throw new Error('Missing Scheduled drag source or project target');
      source.scrollIntoView({ block: 'center', behavior: 'instant' });
      const s = source.getBoundingClientRect(), t = target.getBoundingClientRect();
      return { x: Math.round(s.right - 30), y: Math.round(s.top + s.height / 2), tx: Math.round(t.left + t.width / 2), ty: Math.round(t.top + t.height / 2) };
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: points.x, y: points.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: points.x, y: points.y, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 15; step++) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(points.x + (points.tx - points.x) * step / 15), y: Math.round(points.y + (points.ty - points.y) * step / 15), button: 'left' })
      await new Promise(r => setTimeout(r, 20))
    }
    if (cancel) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: points.tx, y: points.ty, button: 'left', clickCount: 1 })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await new Promise(r => setTimeout(r, 250))
    for (let i = 0; i < 100; i++) {
      const saved = await readTask()
      if ((saved.task.data.content.objectiveId || null) === (cancel ? null : objectiveId)) {
        if (saved.task.data.lane !== original.task.data.lane || saved.task.data.content.time !== original.task.data.content.time || JSON.stringify(saved.event) !== JSON.stringify(original.event)) {
          throw new Error('Project drop changed the scheduled date or calendar event')
        }
        return
      }
      await new Promise(r => setTimeout(r, 30))
    }
    throw new Error('Scheduled project drop did not persist: ' + JSON.stringify({ objectiveId, points, saved: await readTask() }))
  }
  await navigate('Scheduled')
  await drag('test-project', true)
  await drag('test-project')
  await navigate('Work')
  await drag(null)
  await drag('test-project')
  await navigate('Today')
  await verifySubtaskReordering(window)
}

async function verifySubtaskReordering(window: BrowserWindow) {
  await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 100; i++) {
      const title = document.querySelector('[data-task-title-id="before"]');
      if (title) { title.click(); return; }
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('Missing task for subtask reorder test');
  })()`)
  const getOrder = () => window.webContents.executeJavaScript(`(async () => {
    const doc = await window.ritua.loadWorkspace();
    return doc.entities.find(e => e.kind === 'task' && e.id === 'before').data.content.subtasks;
  })()`)
  const original = await getOrder()
  const drag = async (cancel: boolean) => {
    const points = await window.webContents.executeJavaScript(`(async () => {
      for (let i = 0; i < 100; i++) {
        const rows = [...document.querySelectorAll('.task-details-subtasks li')];
        if (rows.length === 2) {
          const source = rows[0].querySelector('.subtask-reorder-handle').getBoundingClientRect();
          const target = rows[1].getBoundingClientRect();
          return { x: Math.round(source.left + source.width / 2), y: Math.round(source.top + source.height / 2), tx: Math.round(source.left + source.width / 2), ty: Math.round(target.bottom - 3) };
        }
        await new Promise(r => setTimeout(r, 30));
      }
      throw new Error('Missing sortable subtasks');
    })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: points.x, y: points.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: points.x, y: points.y, button: 'left', clickCount: 1 })
    for (let i = 1; i <= 15; i++) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(points.x + (points.tx - points.x) * i / 15), y: Math.round(points.y + (points.ty - points.y) * i / 15), button: 'left' })
      await new Promise(r => setTimeout(r, 20))
    }
    if (cancel) window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: points.tx, y: points.ty, button: 'left', clickCount: 1 })
    if (cancel) window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
    await new Promise(r => setTimeout(r, 200))
  }
  await drag(false)
  const expected = JSON.stringify([original[1], original[0]])
  let saved = false
  for (let i = 0; i < 100; i++) {
    if (JSON.stringify(await getOrder()) === expected) { saved = true; break }
    await new Promise(r => setTimeout(r, 30))
  }
  if (!saved) throw new Error('Subtask drag must persist order and preserve all subtask fields')
  await drag(true)
  if (JSON.stringify(await getOrder()) !== expected) throw new Error('Cancelled subtask drag changed saved order')
  await window.webContents.executeJavaScript(`(async () => {
    const close = document.querySelector('[aria-label="Close task details"]');
    if (!close) throw new Error('Cancelling a subtask drag must leave task details open');
    close.click();
  })()`)
}
