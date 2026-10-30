#!/usr/bin/env node
// DolphinScheduler 3.2.0 operations with OpenAPI operationId guards.
import process from 'node:process';
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const command = args[0];
const opts = {};
for (let i=1;i<args.length;i++) if(args[i].startsWith('--')) opts[args[i].slice(2)]=args[++i];
const base = process.env.DS_URL;
const user = process.env.DS_USER;
const password = process.env.DS_PASSWORD;
if (!base || !user || !password) throw new Error('Set DS_URL, DS_USER and DS_PASSWORD in the environment');
const url = new URL(base);
if (!['http:','https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('DS_URL must be a credential-free service root');
const cookie = new Map();
let spec;
function assertOp(path, method, expected) {
  const got = spec.paths?.[path]?.[method]?.operationId;
  if (got !== expected) throw new Error(`OpenAPI mismatch ${method.toUpperCase()} ${path}: ${got}`);
}
async function request(method,path,params={},useFormBody=false,jsonBody=false,queryParams={}) {
  const u = new URL(base.replace(/\/$/, '') + path);
  const form=new URLSearchParams(); for (const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) form.set(k,String(v));
  if(!useFormBody&&!jsonBody) for (const [k,v] of form) u.searchParams.set(k,v);
  else for (const [k,v] of Object.entries(queryParams)) if(v!==undefined&&v!==null) u.searchParams.set(k,String(v));
  const headers={}; if(cookie.size) headers.Cookie=[...cookie].map(([k,v])=>`${k}=${v}`).join('; ');
  if(useFormBody){headers['Content-Type']='application/x-www-form-urlencoded';}
  if(jsonBody) headers['Content-Type']='application/json';
  const res=await fetch(u,{method,headers,body:jsonBody?JSON.stringify(params):useFormBody?form.toString():undefined});
  for(const c of res.headers.getSetCookie?.() ?? []) { const [pair]=c.split(';'); const i=pair.indexOf('='); if(i>0) cookie.set(pair.slice(0,i),pair.slice(i+1)); }
  let data;
  try { data=await res.json(); } catch { throw new Error(`${method} ${path} failed: HTTP ${res.status}, non-JSON response`); }
  if(!res.ok || data.code!==0) {
    const message=String(data.msg??data.message??'').replace(/https?:\/\/\S+/g,'[url]').replace(/(token|password|webhook|secret)\s*[:=]\s*[^,;\s]+/gi,'$1=[redacted]').slice(0,240);
    throw new Error(`${method} ${path} failed: HTTP ${res.status}, DS code ${data.code}, ${message||'no message'}`);
  }
  return data.data;
}
async function requestPages(path, params) {
  const rows=[]; const seen=new Set();
  for(let pageNo=1;pageNo<=1000;pageNo++) {
    const page=await request('GET',path,{...params,pageNo,pageSize:100});
    if(!Array.isArray(page?.totalList)) throw new Error('Unexpected paginated response');
    const batch=page.totalList;
    if(batch.length) {
      const key=JSON.stringify(batch.map(x=>x.id));
      if(seen.has(key)) throw new Error('Repeated page; refusing incomplete result');
      seen.add(key); rows.push(...batch);
    }
    if(Number.isFinite(page.total) && rows.length>=page.total) return {totalList:rows,total:rows.length};
    if(!batch.length) {
      if(Number.isFinite(page.total) && rows.length<page.total) throw new Error('Pagination ended before total');
      return {totalList:rows,total:rows.length};
    }
  }
  throw new Error('Pagination limit reached; result incomplete');
}
spec=await (await fetch(base.replace(/\/$/,'')+'/v3/api-docs')).json();
if(spec.info?.version!=='3.2.0') throw new Error(`Expected DS 3.2.0, got ${spec.info?.version}`);
assertOp('/login','post','login');
const login=spec.paths['/login'].post.parameters??[];
if(!login.some(p=>p.name==='userName') || !login.some(p=>p.name==='userPassword')) throw new Error('Unexpected login contract');
await request('POST','/login',{userName:user,userPassword:password});
const project=opts.project, code=opts.code;
if(!project||!code) throw new Error('--project and --code are required');
const defPath='/projects/{projectCode}/process-definition/{code}';
const instPath='/projects/{projectCode}/process-instances';
const schedPath='/projects/{projectCode}/schedules';
assertOp(defPath,'get','queryProcessDefinitionByCode');
assertOp(instPath,'get','queryProcessInstanceList');
assertOp(schedPath,'get','queryScheduleListPaging');
const actualDef=`/projects/${project}/process-definition/${code}`;
const actualInst=`/projects/${project}/process-instances`;
const actualSched=`/projects/${project}/schedules`;
if(command==='inspect') {
  const detail=await request('GET',actualDef); const d=detail?.processDefinition??detail;
  const [instances,schedules]=await Promise.all([
    requestPages(actualInst,{processDefineCode:code,pageNo:1,pageSize:100}),
    requestPages(actualSched,{processDefinitionCode:code,processDefinitionId:d?.id,pageNo:1,pageSize:100})
  ]);
  const rows=instances?.totalList??instances?.totalList?.totalList??[];
  const terminal=new Set(['SUCCESS','FAILURE','FAILED','STOP','STOPPED','CANCEL','CANCELED']);
  const active=rows.filter(x=>!terminal.has(String(x.state).toUpperCase()));
  const tasks=(detail?.taskDefinitionList??[]).map(t=>{
    let p=t.taskParams??{}; if(typeof p==='string'){try{p=JSON.parse(p)}catch{p={}}}
    const sql=String(p.sql??p.rawScript??p.script??'');
    const refs=[...sql.matchAll(/\b(FROM|JOIN|INTO|UPDATE|DELETE\s+FROM)\s+`?([A-Za-z0-9_]+\.[A-Za-z0-9_]+)`?/gi)].map(m=>({operation:m[1].toUpperCase().replace(/\s+/g,' '),table:m[2]}));
    return {name:t.name,taskType:t.taskType,code:t.code,version:t.version,tableReferences:refs};
  });
  const relationStats=detail.processTaskRelationList.map(r=>({preTaskCode:r.preTaskCode,preTaskVersion:r.preTaskVersion,postTaskCode:r.postTaskCode,postTaskVersion:r.postTaskVersion}));
  if(opts.diagnose) { console.error(JSON.stringify({processKeys:Object.keys(d),locationsType:typeof d.locations,locationsLength:String(d.locations??'').length,taskParamTypes:detail.taskDefinitionList.map(t=>[t.code,typeof t.taskParams]),taskCount:tasks.length,relationStats},null,2)); if(opts['diagnose-only']==='true') process.exit(0); }
  console.log(JSON.stringify({definition:{code:d?.code,name:d?.name,releaseState:d?.releaseState,version:d?.version,id:d?.id,taskCount:tasks.length},tasks,activeInstances:active.map(x=>({id:x.id,state:x.state,startTime:x.startTime})),schedules:schedules?.totalList??[]},null,2));
} else if(command==='inspect-instance') {
  let id=opts.id;
  if(!id && opts.name) {
    assertOp('/projects/{projectCode}/process-instances','get','queryProcessInstanceList');
    const page=await requestPages(actualInst,{processDefineCode:code,searchVal:opts.name,pageNo:1,pageSize:100});
    const matches=(page?.totalList??[]).filter(x=>x.name===opts.name);
    if(matches.length!==1) throw new Error(`Expected one exact-name instance, found ${matches.length}`);
    id=String(matches[0].id);
  }
  if(!id) throw new Error('--id or exact --name required');
  assertOp('/projects/{projectCode}/process-instances/{id}','get','queryProcessInstanceById');
  assertOp('/projects/{projectCode}/process-instances/{id}/tasks','get','queryTaskListByProcessId');
  const detail=await request('GET',`/projects/${project}/process-instances/${id}`);
  const tasks=await request('GET',`/projects/${project}/process-instances/${id}/tasks`);
  const taskRows=Array.isArray(tasks)?tasks:tasks?.taskList??[];
  assertOp('/log/detail','get','queryLog_1');
  const failed=taskRows.filter(t=>/FAILURE|FAILED|KILL|STOP/i.test(String(t.state)));
  const logs=[];
  for(const t of failed) if(t.id){ const v=await request('GET','/log/detail',{taskInstanceId:t.id,skipLineNum:0,limit:2000}); const raw=typeof v==='string'?v:JSON.stringify(v); const categories=['ERROR','Exception','FAILED','syntax error','Access denied','SQLState'].filter(x=>raw.toLowerCase().includes(x.toLowerCase())); logs.push({task:t.name,categories,scope:'First 2000 lines only; raw text omitted'}); }
  console.log(JSON.stringify({instance:{id:detail?.id,name:detail?.name,state:detail?.state,startTime:detail?.startTime,endTime:detail?.endTime,processDefinitionCode:detail?.processDefinitionCode,processDefinitionVersion:detail?.processDefinitionVersion,parameterValuesOmitted:true},tasks:taskRows.map(t=>({id:t.id,name:t.name,state:t.state,taskType:t.taskType,taskCode:t.taskCode,submitTime:t.submitTime,startTime:t.startTime,endTime:t.endTime,})),errors:logs},null,2));
} else if(command==='show-sql') {
  const detail=await request('GET',actualDef);
  const rows=detail?.taskDefinitionList??[];
  const sqlTasks=rows.filter(t=>t.taskType==='SQL').map(t=>({name:t.name,code:t.code,version:t.version,sql:(typeof t.taskParams==='string'?JSON.parse(t.taskParams):t.taskParams)?.sql}));
  const payload=JSON.stringify(Object.fromEntries(sqlTasks.map(t=>[String(t.code),t.sql])),null,2);
  if(opts.out) await writeFile(opts.out,payload+'\n',{mode:0o600}); else console.log(JSON.stringify(sqlTasks,null,2));
} else if(command==='release') {
  const path='/projects/{projectCode}/process-definition/{code}/release'; assertOp(path,'post','releaseProcessDefinition');
  const state=opts.state??'ONLINE'; if(!['ONLINE','OFFLINE'].includes(state)) throw new Error('--state must be ONLINE or OFFLINE');
  const detail=await request('GET',actualDef); const before=detail?.processDefinition??detail; if(before?.releaseState===state) {console.log(`Already ${state}`);process.exit(0);}
  const name=opts.name??before.name; await request('POST',`/projects/${project}/process-definition/${code}/release`,{releaseState:state,name});
  const afterDetail=await request('GET',actualDef); const after=afterDetail?.processDefinition??afterDetail; if(after?.releaseState!==state) throw new Error(`Release readback is ${after?.releaseState}`); console.log(JSON.stringify({code:after.code,name:after.name,releaseState:after.releaseState,version:after.version}));
} else if(command==='create-schedule') {
  const path='/projects/{projectCode}/schedules'; assertOp(path,'post','createSchedule_1');
  const s=JSON.parse(opts.schedule); if(s.processDefinitionCode!==Number(code)||s.timezoneId!=='Asia/Shanghai'||s.crontab!=='0 0 16 * * ? *') throw new Error('Schedule must target this workflow at 16:00 Asia/Shanghai');
  const created=await request('POST',`/projects/${project}/schedules`,{processDefinitionCode:code,schedule:JSON.stringify(s),warningType:opts['warning-type']??'NONE',warningGroupId:opts['warning-group-id'],failureStrategy:opts['failure-strategy']??'END',workerGroup:opts['worker-group'],tenantCode:opts.tenant});
  console.log(JSON.stringify(created));
} else if(command==='online-schedule') {
  const path='/projects/{projectCode}/schedules/{id}/online'; assertOp(path,'post','publishScheduleOnline');
  const schedule=await request('POST',`/projects/${project}/schedules/${opts.id}/online`); console.log(JSON.stringify(schedule));
} else if(command==='offline-schedule') {
  const path='/projects/{projectCode}/schedules/{id}/offline'; assertOp(path,'post','offlineSchedule');
  const schedule=await request('POST',`/projects/${project}/schedules/${opts.id}/offline`); console.log(JSON.stringify(schedule));
} else if(command==='update-workflow-info') {
  const detail=await request('GET',actualDef); const p=detail?.processDefinition;
  if(!p||p.releaseState!=='OFFLINE') throw new Error('Target workflow must be OFFLINE');
  if(opts.description===undefined||typeof opts.description!=='string') throw new Error('--description string is required');
  const instances=await requestPages(actualInst,{processDefineCode:code,pageNo:1,pageSize:100});
  const terminal=new Set(['SUCCESS','FAILURE','FAILED','STOP','STOPPED','CANCEL','CANCELED']);
  if((instances?.totalList??[]).some(x=>!terminal.has(String(x.state).toUpperCase()))) throw new Error('Active instances exist; refusing update');
  const payload={name:p.name,description:opts.description,releaseState:'OFFLINE',globalParams:typeof p.globalParams==='string'?p.globalParams:JSON.stringify(p.globalParams??[]),warningGroupId:p.warningGroupId??undefined,timeout:p.timeout??0,executionType:p.executionType??'PARALLEL',location:typeof p.locations==='string'?p.locations:JSON.stringify(p.locations??[])};
  const diff={workflow:{code:p.code,version:p.version,state:p.releaseState,expectedNextVersion:p.version+1,descriptionFrom:p.description??'',descriptionTo:opts.description},taskCount:detail.taskDefinitionList.length,relationCount:detail.processTaskRelationList.length};
  if(opts['dry-run']==='true') { console.log(JSON.stringify({dryRun:true,diff},null,2)); process.exit(0); }
  assertOp('/v2/workflows/{code}','put','updateWorkflow');
  let result;
  try { result=await request('PUT',`/v2/workflows/${code}`,payload,false,true); }
  catch(e) {
    const read=await request('GET',actualDef),after=read?.processDefinition??read;
    throw new Error(`Workflow info update failed; no retry was sent. Readback: version=${after?.version}, state=${after?.releaseState}. ${e.message}`);
  }
  const afterDetail=await request('GET',actualDef),after=afterDetail?.processDefinition;
  if(after?.version!==p.version+1||after?.releaseState!=='OFFLINE'||after?.description!==opts.description) throw new Error('Workflow info readback mismatch');
  if(afterDetail.taskDefinitionList?.length!==detail.taskDefinitionList.length||afterDetail.processTaskRelationList?.length!==detail.processTaskRelationList.length) throw new Error('Workflow topology count changed');
  const expectedTasks=detail.taskDefinitionList.map(t=>String(t.code)).sort().join(',');
  const actualTasks=afterDetail.taskDefinitionList.map(t=>String(t.code)).sort().join(',');
  if(expectedTasks!==actualTasks) throw new Error('Workflow task code set changed');
  if(afterDetail.processTaskRelationList.some(r=>r.processDefinitionVersion!==after.version)) throw new Error('Workflow relation version readback mismatch');
  console.log(JSON.stringify({result,diff,definition:{code:after.code,version:after.version,releaseState:after.releaseState,taskCount:afterDetail.taskDefinitionList.length,relationCount:afterDetail.processTaskRelationList.length}},null,2));
} else if(command==='update-task') {
  // DS 3.2.0's task update API owns task versioning and synchronizes the
  // containing workflow/relation versions. Use it for one uniquely referenced
  // SQL or SHELL task when updateProcessDefinition cannot persist the full DAG.
  const taskCode=opts['task-code']; if(!/^\d+$/.test(String(taskCode??''))) throw new Error('--task-code is required');
  const detail=await request('GET',actualDef); const p=detail?.processDefinition;
  if(!p||p.releaseState!=='OFFLINE') throw new Error('Target workflow must be OFFLINE before task update');
  const inst=await requestPages(actualInst,{processDefineCode:code,pageNo:1,pageSize:100});
  const terminal=new Set(['SUCCESS','FAILURE','FAILED','STOP','STOPPED','CANCEL','CANCELED']);
  if((inst?.totalList??[]).some(x=>!terminal.has(String(x.state).toUpperCase()))) throw new Error('Active instances exist; refusing task update');
  const selected=detail.taskDefinitionList.find(t=>String(t.code)===String(taskCode));
  if(!selected||!['SQL','SHELL'].includes(selected.taskType)) throw new Error('Task must be an existing SQL or SHELL node in the target workflow');
  assertOp('/projects/{projectCode}/process-definition','get','queryProcessDefinitionListPaging');
  const allDefinitions=await requestPages(`/projects/${project}/process-definition`,{pageNo:1,pageSize:100});
  const usages=[];
  for(const workflow of allDefinitions.totalList) {
    const wdetail=await request('GET',`/projects/${project}/process-definition/${workflow.code}`);
    if((wdetail.taskDefinitionList??[]).some(t=>String(t.code)===String(taskCode))) usages.push(Number(workflow.code));
  }
  if(usages.length!==1||usages[0]!==Number(code)) throw new Error(`Task must be used only by the target workflow; usages=${JSON.stringify(usages)}`);
  const sqlUpdates=opts['sql-updates-file']?JSON.parse(await readFile(opts['sql-updates-file'],'utf8')):{};
  const paramUpdates=opts['task-params-updates-file']?JSON.parse(await readFile(opts['task-params-updates-file'],'utf8')):{};
  if(Object.keys(sqlUpdates).some(k=>k!==String(taskCode))||Object.keys(paramUpdates).some(k=>k!==String(taskCode))) throw new Error('Task update files must contain only the selected task code');
  const patch=paramUpdates[String(taskCode)]??{};
  const allowed=selected.taskType==='SHELL'?['localParams','rawScript','description']:['localParams','description'];
  if(Object.keys(patch).some(k=>!allowed.includes(k))) throw new Error(`Unsupported fields for ${selected.taskType} task`);
  if(Object.hasOwn(sqlUpdates,String(taskCode))&&selected.taskType!=='SQL') throw new Error('SQL text patch requires a SQL task');
  if(Object.hasOwn(sqlUpdates,String(taskCode))&&typeof sqlUpdates[String(taskCode)]!=='string') throw new Error('SQL patch value must be a string');
  if(patch.localParams!==undefined&&(!Array.isArray(patch.localParams)||patch.localParams.some(x=>!x||typeof x.prop!=='string'||!['IN','OUT'].includes(x.direct)||typeof x.type!=='string'))) throw new Error('Invalid localParams patch');
  if(patch.rawScript!==undefined&&typeof patch.rawScript!=='string') throw new Error('rawScript patch must be a string');
  if(patch.description!==undefined&&typeof patch.description!=='string') throw new Error('description patch must be a string');
  if(!Object.keys(patch).length&&!Object.hasOwn(sqlUpdates,String(taskCode))) throw new Error('No change requested for selected task');
  try { await request('GET',`/projects/${project}/task-definition/${taskCode}`); }
  catch(e) { throw new Error(`Task-detail API failed; current-row existence is unknown. Refusing to infer absence or create a replacement. ${e.message}`); }
  const raw=typeof selected.taskParams==='string'?JSON.parse(selected.taskParams):selected.taskParams;
  const params={...raw};
  if(Object.hasOwn(sqlUpdates,String(taskCode))) params.sql=sqlUpdates[String(taskCode)];
  if(patch.localParams!==undefined) params.localParams=patch.localParams;
  if(patch.rawScript!==undefined) params.rawScript=patch.rawScript;
  const nextDescription=patch.description??selected.description??'';
  const taskPayload={id:selected.id,code:selected.code,name:selected.name,version:selected.version,description:nextDescription,projectCode:selected.projectCode,userId:selected.userId,taskType:selected.taskType,taskParams:JSON.stringify(params),flag:selected.flag,isCache:selected.isCache,taskPriority:selected.taskPriority,workerGroup:selected.workerGroup,environmentCode:selected.environmentCode,failRetryTimes:selected.failRetryTimes,failRetryInterval:selected.failRetryInterval,timeoutFlag:selected.timeoutFlag,timeoutNotifyStrategy:selected.timeoutNotifyStrategy,timeout:selected.timeout,delayTime:selected.delayTime,resourceIds:selected.resourceIds,taskGroupId:selected.taskGroupId,taskGroupPriority:selected.taskGroupPriority,cpuQuota:selected.cpuQuota,memoryMax:selected.memoryMax,taskExecuteType:selected.taskExecuteType,dependence:selected.dependence??''};
  const diff={workflow:{code:p.code,name:p.name,version:p.version,state:p.releaseState,expectedNextVersion:p.version+1},task:{code:selected.code,name:selected.name,type:selected.taskType,fromVersion:selected.version,toVersion:selected.version+1,changedFields:[...(Object.hasOwn(sqlUpdates,String(taskCode))?['sql']:[]),...Object.keys(patch)]},uniqueWorkflowUsage:usages};
  if(opts['dry-run']==='true') { console.log(JSON.stringify({dryRun:true,diff},null,2)); process.exit(0); }
  let result;
  {
    assertOp('/projects/{projectCode}/task-definition/{code}','put','updateTaskDefinition_1');
    try { result=await request('PUT',`/projects/${project}/task-definition/${taskCode}`,{taskDefinitionJsonObj:JSON.stringify(taskPayload)},true); }
    catch(e) {
      const reads=await Promise.allSettled([request('GET',`/projects/${project}/task-definition/${taskCode}`),request('GET',actualDef)]);
      const tr=reads[0].status==='fulfilled'?(reads[0].value?.taskDefinition??reads[0].value):{};
      const wr=reads[1].status==='fulfilled'?(reads[1].value?.processDefinition??reads[1].value):{};
      throw new Error(`Task update failed; no retry was sent. Readback: taskVersion=${tr?.version}, workflowVersion=${wr?.version}, state=${wr?.releaseState}. ${e.message}`);
    }
  }
  const [taskRead,workflowRead]=await Promise.all([request('GET',`/projects/${project}/task-definition/${taskCode}`),request('GET',actualDef)]);
  const tr=taskRead?.taskDefinition??taskRead, wr=workflowRead?.processDefinition??workflowRead;
  const currentParams=typeof tr?.taskParams==='string'?JSON.parse(tr.taskParams):tr?.taskParams;
  if(tr?.version!==selected.version+1||wr?.version!==p.version+1||wr?.releaseState!=='OFFLINE') throw new Error(`Task/workflow version readback mismatch: task=${tr?.version}, workflow=${wr?.version}, state=${wr?.releaseState}`);
  if(JSON.stringify(params)!==JSON.stringify(currentParams)||tr?.description!==nextDescription) throw new Error('Task parameters readback mismatch');
  console.log(JSON.stringify({result,diff,task:{code:tr.code,version:tr.version,parametersVerified:true},workflow:{code:wr.code,version:wr.version,releaseState:wr.releaseState}},null,2));
} else if(command==='update-definition') {
  const path='/projects/{projectCode}/process-definition/{code}'; assertOp(path,'put','updateProcessDefinition');
  const detail=await request('GET',actualDef); const p=detail?.processDefinition;
  if(!p || !Array.isArray(detail.taskDefinitionList) || !Array.isArray(detail.processTaskRelationList)) throw new Error('Definition payload is incomplete; refusing update');
  if(p.releaseState!=='OFFLINE') throw new Error('Definition must be OFFLINE before update; offline it, retain the schedule baseline, then restore both states after readback.');
  const inst=await requestPages(actualInst,{processDefineCode:code,pageNo:1,pageSize:100});
  const rows=inst?.totalList??[]; const terminal=new Set(['SUCCESS','FAILURE','FAILED','STOP','STOPPED','CANCEL','CANCELED']);
  if(rows.some(x=>!terminal.has(String(x.state).toUpperCase()))) throw new Error('Active instances exist; refusing update');
  const globals=typeof p.globalParams==='string'?JSON.parse(p.globalParams):(p.globalParams??[]);
  if(opts.description!==undefined&&typeof opts.description!=='string') throw new Error('--description must be a string');
  const globalUpdate=opts['global-param'];
  if(globalUpdate && !globalUpdate.includes('=')) throw new Error('--global-param must be name=value');
  const [prop,value]=globalUpdate?[globalUpdate.slice(0,globalUpdate.indexOf('=')),globalUpdate.slice(globalUpdate.indexOf('=')+1)]:[undefined,undefined];
  const next=globalUpdate?(globals.some(x=>x.prop===prop)?globals.map(x=>x.prop===prop?{...x,value}:x):[...globals,{prop,direct:'IN',type:'VARCHAR',value}]):globals;
  const updates=opts['sql-updates-file']?JSON.parse(await readFile(opts['sql-updates-file'],'utf8')):{};
  const paramUpdates=opts['task-params-updates-file']?JSON.parse(await readFile(opts['task-params-updates-file'],'utf8')):{};
  if(!Object.keys(updates).length && !Object.keys(paramUpdates).length && !globalUpdate) throw new Error('No definition changes requested');
  const validLocalParams=v=>Array.isArray(v)&&v.every(x=>x&&typeof x.prop==='string'&&['IN','OUT'].includes(x.direct)&&typeof x.type==='string');
  for(const [taskCode,patch] of Object.entries(paramUpdates)) {
    if(!/^\d+$/.test(taskCode)||!patch||typeof patch!=='object'||Array.isArray(patch)) throw new Error('Invalid task patch');
    const target=detail.taskDefinitionList.find(t=>String(t.code)===taskCode);
    if(!target) throw new Error(`Task ${taskCode} is not part of this workflow`);
    const allowed=target.taskType==='SUB_PROCESS'?['localParams','processDefinitionVersion']:
      target.taskType==='SHELL'?['localParams','rawScript','description']:
      target.taskType==='SQL'?['localParams','description']:[];
    if(!allowed.length||Object.keys(patch).some(k=>!allowed.includes(k))) throw new Error(`Unsupported patch fields for ${target.taskType} task ${taskCode}`);
    if(patch.localParams!==undefined&&!validLocalParams(patch.localParams)) throw new Error(`Invalid localParams for task ${taskCode}`);
    if(target.taskType==='SHELL'&&patch.rawScript!==undefined&&typeof patch.rawScript!=='string') throw new Error(`rawScript must be a string for task ${taskCode}`);
    if(patch.description!==undefined&&typeof patch.description!=='string') throw new Error(`description must be a string for task ${taskCode}`);
    if(patch.processDefinitionVersion!==undefined&&(!Number.isInteger(patch.processDefinitionVersion)||patch.processDefinitionVersion<1)) throw new Error('Invalid subprocess version');
  }
  // DS owns task versioning; retain the returned code/version.
  // Omit relation IDs and changed-task log IDs from the update payload.
  // Generic API error codes do not identify the failing persistence stage.
  const taskKeys=['id','code','name','version','description','projectCode','userId','taskType','taskParams','flag','isCache','taskPriority','workerGroup','environmentCode','failRetryTimes','failRetryInterval','timeoutFlag','timeoutNotifyStrategy','timeout','delayTime','resourceIds','taskGroupId','taskGroupPriority','cpuQuota','memoryMax','taskExecuteType','dependence'];
  const relationKeys=['name','processDefinitionVersion','projectCode','processDefinitionCode','preTaskCode','preTaskVersion','postTaskCode','postTaskVersion','conditionType','conditionParams'];
  const tasks=detail.taskDefinitionList.map(t=>{
    const raw=typeof t.taskParams==='string'?JSON.parse(t.taskParams):t.taskParams;
    const sqlChanged=Object.hasOwn(updates,String(t.code));
    const paramsChanged=Object.hasOwn(paramUpdates,String(t.code));
    const changed=sqlChanged||paramsChanged;
    const patch=paramsChanged?paramUpdates[String(t.code)]:{};
    const nextParams={...raw};
    if(sqlChanged) nextParams.sql=updates[String(t.code)];
    if(patch.localParams!==undefined) nextParams.localParams=patch.localParams;
    if(patch.rawScript!==undefined) nextParams.rawScript=patch.rawScript;
    if(patch.processDefinitionVersion!==undefined) nextParams.processDefinitionVersion=patch.processDefinitionVersion;
    const mapped={...t,taskParams:JSON.stringify(changed?nextParams:raw)};
    if(patch.description!==undefined) mapped.description=patch.description;
    const payload=Object.fromEntries(taskKeys.map(k=>[k,mapped[k]]));
    if(changed) delete payload.id;
    return payload;
  });
  const relations=detail.processTaskRelationList.map(r=>Object.fromEntries(relationKeys.map(k=>[
    k,k==='conditionParams'&&r[k]!==null&&typeof r[k]==='object'?JSON.stringify(r[k]):r[k]
  ])));
  const changedCodeSet=new Set([...Object.keys(updates),...Object.keys(paramUpdates)]);
  const changedTasks=tasks.filter(t=>changedCodeSet.has(String(t.code)));
  const diff={workflow:{code:p.code,version:p.version,state:p.releaseState,descriptionChange:opts.description!==undefined?{from:p.description??'',to:opts.description}:null},changedTasks:changedTasks.map(t=>({code:t.code,name:t.name,type:t.taskType,fromVersion:t.version,toVersion:t.version+1,changedFields:[...(Object.hasOwn(updates,String(t.code))?['sql']:[]),...Object.keys(paramUpdates[String(t.code)]??{})]})),globalParameter:globalUpdate?{name:prop,from:globals.find(x=>x.prop===prop)?.value??null,to:value}:null,taskCount:tasks.length,relationCount:relations.length};
  if(opts['dry-run']==='true') { console.log(JSON.stringify({dryRun:true,diff},null,2)); process.exit(0); }
  const update={name:p.name,description:opts.description??p.description??'',globalParams:JSON.stringify(next),locations:typeof p.locations==='string'?p.locations:JSON.stringify(p.locations??[]),timeout:p.timeout??0,taskRelationJson:JSON.stringify(relations),taskDefinitionJson:JSON.stringify(tasks),executionType:p.executionType??'PARALLEL'};
  const updateOperation=spec.paths[path]?.put;
  const declaredQueryParams=new Set((updateOperation?.parameters??[]).filter(x=>x.in==='query').map(x=>x.name));
  const missingQueryParams=Object.keys(update).filter(k=>!declaredQueryParams.has(k));
  if(missingQueryParams.length) throw new Error(`OpenAPI update parameter mismatch: ${missingQueryParams.join(', ')}`);
  const {taskRelationJson,taskDefinitionJson,...metadataParams}=update;
  let result;
  try {
    // The OpenAPI contract declares every field as a query parameter, but the
    // two large JSON arrays exceed the gateway URI limit. Keep scalar workflow
    // fields in the contracted query string and send only the large arrays as
    // URL-encoded form fields; Spring @RequestParam binds both sources.
    result=await request('PUT',actualDef,{taskRelationJson,taskDefinitionJson},true,false,metadataParams);
  }
  catch(e) {
    const readback=await request('GET',actualDef); const current=readback?.processDefinition??readback;
    const versions=(readback?.taskDefinitionList??[]).map(t=>({code:t.code,version:t.version}));
    throw new Error(`Definition update failed; no retry was sent. Readback: version=${current?.version}, state=${current?.releaseState}, taskVersions=${JSON.stringify(versions)}. ${e.message}`);
  }
  const afterDetail=await request('GET',actualDef); const after=afterDetail?.processDefinition;
  if(opts.description!==undefined&&after?.description!==opts.description) throw new Error('Workflow description readback mismatch');
  const afterGlobals=typeof after?.globalParams==='string'?JSON.parse(after.globalParams):(after?.globalParams??[]);
  if(globalUpdate&&!afterGlobals.some(x=>x.prop===prop&&x.value===value)) throw new Error('Global parameter readback mismatch');
  if(afterDetail.taskDefinitionList?.length!==detail.taskDefinitionList.length || afterDetail.processTaskRelationList?.length!==detail.processTaskRelationList.length) throw new Error('Task or relation count changed during update');
  for(const expected of tasks) {
    const actual=afterDetail.taskDefinitionList.find(t=>t.code===expected.code);
    const expectedVersion=expected.version+(changedCodeSet.has(String(expected.code))?1:0);
    if(!actual||actual.version!==expectedVersion) throw new Error(`Task version readback mismatch for ${expected.code}: expected ${expectedVersion}, got ${actual?.version}`);
    const expectedParams=JSON.parse(expected.taskParams),actualParams=typeof actual.taskParams==='string'?JSON.parse(actual.taskParams):actual.taskParams;
    if(JSON.stringify(expectedParams)!==JSON.stringify(actualParams)) throw new Error(`Task params readback mismatch for ${expected.code}`);
    if(expected.description!==actual.description) throw new Error(`Task description readback mismatch for ${expected.code}`);
  }
  if(after.version!==p.version+1) throw new Error(`Workflow version readback mismatch: expected ${p.version+1}, got ${after.version}`);
  for(const expected of detail.processTaskRelationList) {
    const actual=afterDetail.processTaskRelationList.find(r=>r.preTaskCode===expected.preTaskCode&&r.postTaskCode===expected.postTaskCode);
    const pre=detail.taskDefinitionList.find(t=>t.code===expected.preTaskCode);
    const post=detail.taskDefinitionList.find(t=>t.code===expected.postTaskCode);
    const preVersion=pre?.version+(changedCodeSet.has(String(expected.preTaskCode))?1:0);
    const postVersion=post?.version+(changedCodeSet.has(String(expected.postTaskCode))?1:0);
    if(!actual||actual.processDefinitionVersion!==after.version||(pre&&actual.preTaskVersion!==preVersion)||(post&&actual.postTaskVersion!==postVersion)) throw new Error(`Relation version readback mismatch for ${expected.preTaskCode}->${expected.postTaskCode}`);
  }
  const schedules=await requestPages(actualSched,{processDefinitionCode:code,processDefinitionId:after.id,pageNo:1,pageSize:100});
  console.log(JSON.stringify({result,diff,definition:{code:after.code,name:after.name,releaseState:after.releaseState,version:after.version,globalParams:after.globalParams},taskCount:afterDetail.taskDefinitionList.length,relationCount:afterDetail.processTaskRelationList.length,schedules:schedules?.totalList??[]},null,2));
} else throw new Error('Command must be inspect, release, create-schedule, online-schedule, update-workflow-info, update-task, or update-definition');
