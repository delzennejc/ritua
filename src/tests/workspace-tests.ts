import { testWorkspace, seedTestWorkspace } from './fixtures/workspace'
import assert from 'node:assert/strict'
import { openDatabase } from '../main/db/database'
import { recurrenceForPreset } from '../domain/recurrence'
import { normalize, project, applyChanges, changes, validateCommit, type Data, type WorkspaceDocument } from '../domain/workspace'
import { testLiveWorkspace } from './live-workspace-tests'
const canonical=(doc:WorkspaceDocument)=>JSON.stringify({...doc,entities:[...doc.entities].sort((a,b)=>(a.kind+a.id).localeCompare(b.kind+b.id))})
export function testWorkspaceDomain() {
  testLiveWorkspace()
  const seed=testWorkspace()
  assert.equal(canonical(normalize(project(seed))),canonical(seed),'Canonical entities must survive projection roundtrip')
  const fields=project(seed)
  const task=(fields.tasks as Data[]).find(t=>t.id==='main')!
  task.media=[{attachment:{id:'task-image',name:'reference.png',size:64}}]
  task.notes='Notes survive'
  task.comments=[{id:'comment',text:'Full comment',attachment:{ id: 'test-file', name: 'reference.pdf', size: 10 }}]
  task.activity=[{id:'activity',label:'You edited this',timestamp:123}]
  task.recurrence={...recurrenceForPreset('weekly','2026-07-14'),interval:2,end:{type:'after',count:4,date:''}}
  task.actualMinutes=27
  const subtask=(task.subtasks as Data[])[0]!
  subtask.title='Edited subtask';subtask.actualMinutes=12;subtask.complete=true
  fields['daily.planText']='Durable daily plan'
  fields['weekly.reviewText']='Durable weekly review'
  fields['weekly.planText']='Durable weekly plan'
  fields['daily.yesterdayTaskIdsByLane']={worked:['main'],missed:['tests']}
  const changed=normalize(fields)
  const command=changes(seed,changed,'roundtrip')
  const saved=applyChanges(seed,command)
  const restored=project(saved)
  assert.deepEqual((restored.tasks as Data[]).find(t=>t.id==='main'),task)
  for(const key of ['daily.planText','weekly.reviewText','weekly.planText','daily.yesterdayTaskIdsByLane']) assert.deepEqual(restored[key],fields[key])
  assert.equal(saved.entities.filter(e=>e.kind==='task'&&e.id==='main').length,1,'Mirrors must not duplicate a task')
  assert.throws(()=>applyChanges(saved,command),/Workspace changed/,'Stale updates must fail')
  assert.throws(()=>validateCommit({...command,fields:{injected:'no'}}),/Unknown workspace/)
  assert.throws(()=>validateCommit({...command,put:[{kind:'sql',id:'x',data:{}}]}),/entity kind/)
  assert.throws(()=>applyChanges(seed,{...command,put:[...command.put,{kind:'event',id:'invalid',data:{position:0,content:{id:'invalid',start:1440,end:1500}}}]}),/calendar event/)
  const empty=normalize({...fields,tasks:[],datedTasksByDate:{},backlogGroups:[],weeklyObjectives:[],archivedObjectives:[],events:[],'weekly.accomplishedObjectives':[]})
  assert.equal((project(empty).tasks as Data[]).length,0,'Empty workspaces must stay empty')
  const database=openDatabase(':memory:')
  seedTestWorkspace(database)
  try {
    const current=database.loadWorkspace()
    const write={revision:current.revision,requestId:'retry-test',put:[],remove:[],fields:{...current.fields,view:'today'}}
    const result=database.commitWorkspace(write)
    assert.deepEqual(database.commitWorkspace(write),result,'Lost acknowledgements must be safely retryable')
    assert.equal(database.loadWorkspace().revision,result.revision,'Retry must not apply twice')
    assert.throws(()=>database.commitWorkspace({...write,fields:{...write.fields,view:'home'}}),/reused/)
    const beforeFailure=canonical(database.loadWorkspace())
    const original=database.loadWorkspace().entities.find(e=>e.kind==='task')!
    assert.throws(()=>database.commitWorkspace({revision:result.revision,requestId:'rollback-test',put:[{...original,data:{...original.data,content:{...(original.data.content as Data),title:'Must not save'}}},{kind:'event',id:'bad',data:{position:0,content:{id:'bad',start:-1,end:3}}}],remove:[],fields:write.fields}),/calendar event/)
    assert.equal(canonical(database.loadWorkspace()),beforeFailure,'Rejected batches must roll back every related entity')
  } finally {database.close()}

}
