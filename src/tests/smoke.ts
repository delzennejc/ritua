import { dialog, app, clipboard, nativeImage } from 'electron'
import { writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { testRecovery } from './recovery-tests'
import type { BrowserWindow } from 'electron'
import { testWorkspaceDomain } from './workspace-tests'
import { verifyCalendarMovePreview, verifyNativeDrag, verifyScheduledProjectDrop } from './drag-smoke'

export async function runSmoke(window:BrowserWindow) {
  // Capture the native clipboard payload without replacing the user's clipboard during tests.
  let copiedImage: Buffer | undefined
  clipboard.write = async items => {
    assert.equal(items.length, 1)
    const blob = await items[0]!.getType('image/png')
    assert.ok(blob instanceof Blob)
    copiedImage = Buffer.from(await blob.arrayBuffer())
    assert.deepEqual(nativeImage.createFromBuffer(copiedImage).getSize(), { width: 1, height: 1 })
  }

  window.webContents.on('console-message', (details) => { if (details.level === 'error') console.error(details.message) })
  const sourceFile = join(app.getPath('userData'), 'smoke-attachment.txt')
  const exportedFile = join(app.getPath('userData'), 'exported-attachment.txt')
  await writeFile(sourceFile, 'Attached file bytes survive restart.\n')
  dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [sourceFile] })) as typeof dialog.showOpenDialog
  dialog.showSaveDialog = (async () => ({ canceled: false, filePath: exportedFile })) as typeof dialog.showSaveDialog
  testWorkspaceDomain()
  await testRecovery()
  const firstRun = await window.webContents.executeJavaScript(`(async () => {
    for (let i = 0; i < 200; i++) {
      const today = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === 'Today');
      if (today) { today.click(); break; }
      await new Promise(r => setTimeout(r, 30));
    }
    for (let i = 0; i < 200; i++) {
      if (document.querySelector('.task-card')) {
        const doc = await window.ritua.loadWorkspace();
        return !doc.entities.some(e => e.kind === 'task' && e.data.content.title === 'Full prototype persistence check');
      }
      await new Promise(r => setTimeout(r, 30));
    }
    throw new Error('Missing initial workspace');
  })()`)
  if (firstRun) {
    await verifyCalendarMovePreview(window)
    console.log('PASS: calendar drag time label follows pointer and scrolling; cancellation preserves the saved event.')
    await verifyScheduledProjectDrop(window)
  }
  const result = await window.webContents.executeJavaScript(`(async()=>{
    const pause=()=>new Promise(r=>setTimeout(r,40));
    const check=(condition,message)=>{if(!condition)throw new Error(message)};
    const wait=async predicate=>{for(let i=0;i<200;i++){if(await predicate())return;await pause()}throw new Error('Timed out: '+predicate.toString()+' | '+document.body.innerText.slice(-500))};
    const button=label=>Array.from((['Repeat','Repeats'].includes(label) ? document.querySelector('.task-details') || document : document).querySelectorAll('button')).find(b=>b.getAttribute('aria-label')===label || (()=>{const copy=b.cloneNode(true);copy.querySelectorAll('svg,[aria-hidden="true"]').forEach(node=>node.remove());return copy.textContent.trim()===label})());
    const click=label=>{const b=button(label);check(b,'Missing '+label+' | '+document.body.innerText.slice(0,700));b.click()};
    const edit=(label,value)=>{const input=document.querySelector('input[aria-label="'+label+'"],textarea[aria-label="'+label+'"],[contenteditable][aria-label="'+label+'"]');check(input,'Missing field '+label);if(input.isContentEditable){Array.from(input.querySelectorAll('.weekly-text-title,.weekly-text-line')).forEach((node,i)=>{node.textContent=i===0?value:''});input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));return;}const proto=input.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));};
    const api=window.ritua;
    await wait(()=>document.querySelector('.task-card'));
    check(typeof window.require==='undefined','Renderer must remain sandboxed');
    check(!document.querySelector('.astryx-button'),'Only prototype controls may render');
    const status=await api.getStatus();
    check(!Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Settings'),'Removed Settings UI must not render');
    const before=await api.loadWorkspace();
    let entity=before.entities.find(e=>e.kind==='task'&&e.data.content.title==='Full prototype persistence check'&&e.data.lane==='today');
    if(entity) {
      check(before.entities.find(e=>e.kind==='task'&&e.id==='before').data.content.subtasks.map(s=>s.id).join(',')==='order-second,order-first','Subtask order must survive native restart');
      check(entity.data.content.media?.length===1,'Task image must survive restart');
      check((await api.readTaskImage(entity.data.content.media[0].attachment.id)).startsWith('data:image/png;base64,'),'Image bytes must survive restart');
      check(entity.data.content.notes==='Saved on close','Notes must survive restart');
      check(entity.data.content.complete===true,'Completion must survive restart');
      check(entity.data.content.recurrence?.preset==='daily','Recurrence must survive restart');
      check(entity.data.content.subtasks.some(t=>t.title==='Persistent subtask'&&t.complete),'Subtasks must survive restart');
      check(JSON.stringify(entity.data.content.comments).includes('Persistent comment'),'Comments must survive restart');
      check(before.entities.some(e=>e.kind==='event'&&e.id===entity.id&&e.data.content.start===600),'Schedule must survive restart and Undo');
      check(before.fields['daily.planText']==='Persistent daily plan','Daily plan must survive restart');
      check(before.fields['weekly.planText']==='Persistent weekly plan','Weekly plan must survive restart');
      check(before.fields['weekly.reviewText']==='Persistent weekly review','Weekly review must survive restart');
      check(before.entities.some(e=>e.kind==='event'&&e.data.content.kind==='shutdown'&&e.data.content.start===1140),'Shutdown must survive restart');
      check(before.entities.some(e=>e.kind==='area'&&e.data.content.label==='Persisted Area'),'Area must survive restart');
      check(before.entities.some(e=>e.kind==='project'&&e.data.content.title==='Persisted Project'),'Project must survive restart');
      click('Today');
      await wait(()=>Array.from(document.querySelectorAll('.task-title')).some(e=>e.textContent==='Full prototype persistence check'));
      click('Full prototype persistence check');
      await wait(()=>document.querySelector('[aria-label="Task notes"]'));
      check(document.querySelector('[aria-label="Task notes"]').value==='Saved on close','Persisted data must hydrate the actual UI');
      check(button('Mark task incomplete'),'Original details must render the saved completion');
      await wait(() => document.querySelector('.task-media img')?.naturalWidth === 1);
      const previewTrigger = button('View image pasted.png');
    previewTrigger.focus(); previewTrigger.click();
    await wait(() => document.querySelector('dialog.task-image-viewer[open]'));
    check(document.querySelector('.task-image-viewer').matches(':modal'), 'Image viewer must make Task details inert');
    check(!document.querySelector('.task-media-tile.expanded'), 'Image must not expand inline');
    document.querySelector('.task-image-viewer').dispatchEvent(new Event('cancel', { cancelable: true }));
    await wait(() => !document.querySelector('.task-image-viewer'));
    check(document.querySelector('.task-details'), 'Closing viewer must preserve Task details');
    check(document.activeElement === previewTrigger, 'Closing viewer must restore thumbnail focus');
    click('Copy image pasted.png');
      await wait(() => document.querySelector('.task-media [role="status"]')?.textContent === 'Image copied to clipboard');
      click('smoke-attachment.txt'); await pause();
      const avatar=document.querySelector('img[alt="You"]');
      await wait(()=>avatar?.complete&&avatar.naturalWidth>0);
      click('Close task details');
      return {...status,phase:'read',taskId:entity.id,entityCount:before.entities.length,revision:before.revision,resizeEnd:before.entities.find(e=>e.kind==='event'&&e.id==='before').data.content.end};
    }
    click('Today');
    await wait(()=>document.querySelector('.today-layout'));
    Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim().startsWith('Add task')).click();
    await wait(()=>document.querySelector('textarea'));
    const input=document.querySelector('textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Full prototype persistence check');
    input.dispatchEvent(new Event('input',{bubbles:true}));await pause();
    input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(async()=>{entity=(await api.loadWorkspace()).entities.find(e=>e.kind==='task'&&e.data.content.title==='Full prototype persistence check'&&e.data.lane==='today');return entity});
    click('Full prototype persistence check');
    await wait(()=>document.querySelector('[aria-label="Task notes"]'));
    edit('Task notes','x'.repeat(200001));
    await wait(()=>document.body.innerText.includes('Text is too long'));
    edit('Task notes','Saved by the original Task details');
    await pause();
    const imageBytes = Uint8Array.from(atob(${JSON.stringify(nativeImage.createFromBitmap(Buffer.from([80, 120, 200, 255]), {width:1,height:1}).toPNG().toString('base64'))}), c => c.charCodeAt(0));
    let imageRejected = false;
    try { await api.importTaskImage({ name: 'fake.png', bytes: new Uint8Array([1,2,3]) }); } catch { imageRejected = true; }
    check(imageRejected, 'Image IPC must reject unsupported bytes');
    const transfer = new DataTransfer(); transfer.items.add(new File([imageBytes], 'pasted.png', { type: 'image/png' }));
    const pasteEvent = new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true });
    document.querySelector('[aria-label="Task notes"]').dispatchEvent(pasteEvent);
    check(pasteEvent.defaultPrevented, 'Image paste must bypass note text insertion');
    await wait(() => document.querySelector('.task-media img')?.naturalWidth === 1);
    click('Copy image pasted.png');
    await wait(() => document.querySelector('.task-media [role="status"]')?.textContent === 'Image copied to clipboard');
    const dropTransfer = new DataTransfer(); dropTransfer.items.add(new File([imageBytes], 'dropped.png', { type: 'image/png' }));
    document.querySelector('.task-details').dispatchEvent(new DragEvent('drop', { dataTransfer: dropTransfer, bubbles: true, cancelable: true }));
    click('Close task details');
    await wait(() => !document.querySelector('.task-details'));
    click('Full prototype persistence check');
    await wait(() => document.querySelectorAll('.task-media img').length === 2);
    click('Remove dropped.png');
    await wait(() => document.querySelectorAll('.task-media img').length === 1);

    await wait(async()=>(await api.loadWorkspace()).entities.find(e=>e.id===entity.id).data.content.notes==='Saved by the original Task details');
    check(!document.body.innerText.includes('Text is too long'),'Corrected validation errors must clear');
    click('Add subtask');await wait(()=>document.querySelector('[aria-label="New subtask title"]'));
    await wait(()=>document.activeElement===document.querySelector('[aria-label="New subtask title"]'));
    // Let the UI's queued autofocus finish before deliberately moving focus away.
    await new Promise(resolve=>requestAnimationFrame(resolve));
    document.querySelector('[aria-label="Task notes"]').focus();
    await wait(()=>!document.querySelector('[aria-label="New subtask title"]'));
    click('Add subtask');await wait(()=>document.querySelector('[aria-label="New subtask title"]'));
    edit('New subtask title','Temporary subtask');await pause();
    document.querySelector('[aria-label="New subtask title"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>button('Edit subtask title: Temporary subtask'));
    click('Edit subtask title: Temporary subtask');await wait(()=>document.querySelector('[aria-label="Subtask title for Temporary subtask"]'));
    edit('Subtask title for Temporary subtask','');await pause();
    document.querySelector('[aria-label="Subtask title for Temporary subtask"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    await wait(()=>button('Edit subtask title: Temporary subtask'));
    check(document.querySelector('.task-details'),'Escape must cancel the subtask edit without closing details');
    click('Edit subtask title: Temporary subtask');await wait(()=>document.querySelector('[aria-label="Subtask title for Temporary subtask"]'));
    edit('Subtask title for Temporary subtask','   ');await pause();
    document.querySelector('[aria-label="Task notes"]').focus();
    await wait(()=>!button('Edit subtask title: Temporary subtask')&&!document.querySelector('[aria-label="Subtask title for Temporary subtask"]'));
    await wait(async()=>!(await api.loadWorkspace()).entities.find(e=>e.id===entity.id).data.content.subtasks?.some(s=>s.title==='Temporary subtask'));
    click('Add subtask');await wait(()=>document.querySelector('[aria-label="New subtask title"]'));
    edit('New subtask title','Persistent subtask');await pause();
    document.querySelector('[aria-label="New subtask title"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>document.body.innerText.includes('Persistent subtask'));
    click('Attach a file'); await wait(()=>document.body.innerText.includes('smoke-attachment.txt'));
    edit('Add a comment','Persistent comment');await pause();click('Send');await pause();
    click('Schedule');await wait(()=>document.querySelector('input[name="start"]'));
    document.querySelector('input[name="start"]').value='10:00';
    document.querySelector('input[name="end"]').value='10:30';
    click('Save time');await pause();
    click('Repeat');await wait(()=>document.querySelector('[aria-label="Task recurrence"]'));
    click('Task recurrence');await wait(()=>Array.from(document.querySelectorAll('[role="menuitemradio"]')).some(b=>b.textContent.trim()==='Daily'));click('Daily');await wait(()=>button('Save repeat'));click('Save repeat');await pause();
    click('Mark task complete');
    await wait(async()=>(await api.loadWorkspace()).entities.some(e=>e.id===entity.id&&e.data.content.complete&&e.data.content.notes==='Saved by the original Task details'));
    const repeatButton=Array.from(document.querySelectorAll('.task-details button')).find(b=>b.textContent.trim()==='Repeats'); check(repeatButton,'Task details repeat control'); repeatButton.click(); await wait(()=>document.querySelector('[aria-label="Task recurrence"]'));
    click('Task recurrence'); await wait(()=>Array.from(document.querySelectorAll('[role="menuitemradio"]')).some(b=>b.textContent.trim().startsWith('Weekly on'))); Array.from(document.querySelectorAll('[role="menuitemradio"]')).find(b=>b.textContent.trim().startsWith('Weekly on')).click(); await wait(()=>button('Save repeat')); click('Save repeat'); await pause();
    const historyTask = (await api.loadWorkspace()).entities.find(e=>e.id===entity.id&&e.kind==='task').data.content;
    check(historyTask.complete && historyTask.notes==='Saved by the original Task details' && historyTask.comments[0].attachment.name==='smoke-attachment.txt','Changing repeat must preserve completed occurrence history and attachments');
    edit('Task title','');await pause();
    document.querySelector('[aria-label="Task notes"]').focus();await pause();
    check(document.querySelector('[aria-label="Task title"]').value==='', 'An empty title must remain editable when focus moves within details');
    edit('Task title','Full prototype persistence check');await pause();
    click('Close task details');
    await wait(()=>!document.querySelector('.task-details'));
    check(!document.querySelector('.undo-snackbar-action'), 'Replacing an empty title before leaving must keep the task');
    for (const exit of ['close', 'escape', 'backdrop']) {
      click('Full prototype persistence check');await wait(()=>document.querySelector('[aria-label="Task title"]'));
      edit('Task title',exit==='escape'?'   ':'');await pause();
      if (exit==='close') click('Close task details');
      else if (exit==='escape') document.querySelector('[aria-label="Task title"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));
      else document.querySelector('.task-details-backdrop').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
      await wait(()=>!document.querySelector('.task-details'));
      await wait(async()=>!(await api.loadWorkspace()).entities.some(e=>e.kind==='task'&&e.id===entity.id));
      check(!(await api.loadWorkspace()).entities.some(e=>e.kind==='event'&&e.id===entity.id), 'Empty-title deletion must remove the calendar event');
      const undo=document.querySelector('.undo-snackbar-action');
      check(undo?.textContent.trim()==='Undo', 'Empty-title deletion must offer Undo');
      const snackbarStyle=getComputedStyle(undo.closest('.undo-snackbar'));
      check(snackbarStyle.position==='fixed'&&parseFloat(snackbarStyle.right)<=16&&parseFloat(snackbarStyle.bottom)<=16, 'Undo must appear at the bottom right');
      undo.click();
      await wait(async()=>(await api.loadWorkspace()).entities.some(e=>e.kind==='task'&&e.id===entity.id));
      const restored=await api.loadWorkspace();
      check(JSON.stringify(restored.entities.find(e=>e.kind==='task'&&e.id===entity.id).data.content)===JSON.stringify(historyTask), 'Undo must restore the last nonempty title and all task details');
      check(restored.entities.some(e=>e.kind==='event'&&e.id===entity.id&&e.data.content.start===600), 'Undo must restore the calendar event');
    }
    click('Full prototype persistence check');await wait(()=>button('More task actions'));click('More task actions');await pause();click('Delete task');await pause();
    const deleteButton=button('This task only');check(deleteButton,'Missing deletion confirmation');
    const deleteRect=deleteButton.getBoundingClientRect();
    check(deleteButton.contains(document.elementFromPoint(deleteRect.left+deleteRect.width/2,deleteRect.top+deleteRect.height/2)),'Deletion confirmation must receive pointer clicks above task details');
    click('This task only');
    await wait(async()=>!(await api.loadWorkspace()).entities.some(e=>e.kind==='task'&&e.id===entity.id));
    click('Undo');
    await wait(async()=>(await api.loadWorkspace()).entities.some(e=>e.kind==='task'&&e.id===entity.id));
    click('Daily planning');await wait(()=>button('Next'));click('Next');await pause();click('Next');
    await wait(()=>button('Add to calendar'));click('Add to calendar');await pause();click('Looks good');
    await wait(()=>document.querySelector('[aria-label="Daily plan"]'));edit('Daily plan','Persistent daily plan');await pause();
    click('Weekly planning');await wait(()=>button('Next'));click('Next');
    await wait(()=>document.querySelector('[aria-label="Tasks finished this week"]'));edit('Tasks finished this week','Persistent weekly review');await pause();click('Wrap up');await pause();click('Next');
    await wait(()=>document.querySelector('[aria-label="Weekly plan"]'));edit('Weekly plan','Persistent weekly plan');await pause();click('Done');await pause();
    click('Add area');await wait(()=>document.querySelector('[aria-label="New area name"]'));
    edit('New area name','Persisted Area');await pause();
    document.querySelector('[aria-label="New area name"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>button('New project in Persisted Area'));
    click('Add area'); await wait(()=>document.querySelector('[aria-label="New area name"]'));
    edit('New area name','Persisted Area'); await pause();
    document.querySelector('[aria-label="New area name"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(()=>[...document.querySelectorAll('[role="alert"]')].some(node=>node.textContent.includes('already exists')));
    check(!document.querySelector('.toast'), 'Success action notices must remain removed');
    document.querySelector('[aria-label="New area name"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await pause();

    document.querySelector('nav [aria-label="New project in Persisted Area"]').click();
    await wait(()=>document.querySelector('textarea[aria-label="New project in Persisted Area"]'));
    edit('New project in Persisted Area','Persisted Project');await pause();
    document.querySelector('textarea[aria-label="New project in Persisted Area"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    await wait(async()=>(await api.loadWorkspace()).entities.some(e=>e.kind==='project'&&e.data.content.title==='Persisted Project'));
    click('Today');
    const doc=await api.loadWorkspace();
    let rejected=false;
    try{await api.commitWorkspace({revision:doc.revision,requestId:'invalid',put:[{kind:'event',id:'invalid',data:{position:0,content:{id:'invalid',start:1440,end:1500}}}],remove:[],fields:doc.fields})}catch{rejected=true}
    check(rejected,'Invalid calendar mutations must be rejected in main');
    check(!(await api.loadWorkspace()).entities.some(e=>e.id==='invalid'),'Rejected transaction must leave no row');
    await pause();await pause();
    const final=await api.loadWorkspace();
    return {...status,phase:'write',taskId:entity.id,entityCount:final.entities.length,revision:final.revision};
  })()`)
  if(result.phase==='write') {
    result.resizeEnd=await verifyNativeDrag(window)
    // Leave a final edit for the real native close/quit handshake to flush.
    await window.webContents.executeJavaScript(`(async()=>{
      await new Promise(r=>setTimeout(r,120));
      Array.from(document.querySelectorAll('.task-title')).find(b=>b.textContent==='Full prototype persistence check').click();
      for(let i=0;i<100;i++) {
        const input=document.querySelector('textarea[aria-label="Task notes"]');
        if(input) {Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,'Saved on close');input.dispatchEvent(new Event('input',{bubbles:true}));return;}
        await new Promise(r=>setTimeout(r,30));
      }
      throw new Error('Missing close-save test editor');
    })()`)
  }
  if (result.phase === 'read') {
    assert.deepEqual(await readFile(exportedFile), await readFile(sourceFile), 'Original attachment UI must export the saved bytes after restart')
    await testRendererRecovery(window, result.taskId)
  }
  assert.ok(copiedImage, 'Copy image action must write PNG bytes to the native clipboard')
  return result

}

async function testRendererRecovery(window: BrowserWindow, taskId: string) {
  const seed = await window.webContents.executeJavaScript(`(async () => {
    const api = window.ritua;
    await new Promise(r => setTimeout(r, 150));
    const base = await api.loadWorkspace();
    const local = structuredClone(base);
    local.entities.find(e => e.id === ${JSON.stringify(taskId)} && e.kind === 'task').data.content.notes = 'Recovered pending note';
    const remote = structuredClone(base);
    const task = remote.entities.find(e => e.id === ${JSON.stringify(taskId)} && e.kind === 'task');
    task.data.content.notes = 'Saved competing note';
    await api.commitWorkspace({ revision: base.revision, requestId: crypto.randomUUID(), fields: remote.fields, put: [task], remove: [] });
    await api.writeRecovery({ base, local, savedAt: new Date().toISOString() });
    return true;
  })()`)
  if (!seed) throw new Error('Recovery setup failed')
  const crashAndReload = async () => {
    await new Promise<void>(resolve => { window.webContents.once('render-process-gone', () => resolve()); window.webContents.forcefullyCrashRenderer() })
    await new Promise<void>(resolve => { window.webContents.once('did-finish-load', () => resolve()); window.webContents.reload() })
    await window.webContents.executeJavaScript(`(async () => {
      for (let i=0;i<150;i++) { if(document.body.innerText.includes('Recovered edits conflict')) return; await new Promise(r=>setTimeout(r,30)); }
      throw new Error('Recovered conflicts must remain explicit after a renderer crash');
    })()`)
  }
  await crashAndReload()
  // A close-like checkpoint must retain the original conflict ancestor.
  window.webContents.send('ritua:flush-request', 'unresolved-conflict-check', false)
  await new Promise(resolve => setTimeout(resolve, 150))
  await crashAndReload()
  await window.webContents.executeJavaScript(`(async () => {
    [...document.querySelectorAll('button')].find(button => button.textContent === 'Use saved conflicting edits').click();
    for(let i=0;i<150;i++) {
      const doc = await window.ritua.loadWorkspace();
      if (!document.querySelector('[role="alert"]') && doc.entities.find(e=>e.id===${JSON.stringify(taskId)}).data.content.notes === 'Saved competing note') return;
      await new Promise(r=>setTimeout(r,30));
    }
    throw new Error('Explicit conflict resolution must save and clear the error');
  })()`)
}
