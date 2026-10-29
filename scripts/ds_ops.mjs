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
async function request(method,path,params={},useFormBody=false) {
  const u = new URL(base.replace(/\/$/, '') + path);
  const form=new URLSearchParams(); for (const [k,v] of Object.entries(params)) if(v!==undefined&&v!==null) form.set(k,String(v));
  if(!useFormBody) for (const [k,v] of form) u.searchParams.set(k,v);
  const headers={}; if(cookie.size) headers.Cookie=[...cookie].map(([k,v])=>`${k}=${v}`).join('; ');
  if(useFormBody){headers['Content-Type']='application/x-www-form-urlencoded';}
  const res=await fetch(u,{method,headers,body:useFormBody?form.toString():undefined});
  for(const c of res.headers.getSetCookie?.() ?? []) { const [pair]=c.split(';'); const i=pair.indexOf('='); if(i>0) cookie.set(pair.slice(0,i),pair.slice(i+1)); }
  const data=await res.json(); if(!res.ok || data.code!==0) throw new Error(`${method} ${path} failed: HTTP ${res.status}, DS code ${data.code}, [server message omitted]`);
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
} else if(command==='update-definition') {
  const path='/projects/{projectCode}/process-definition/{code}'; assertOp(path,'put','updateProcessDefinition');
  const detail=await request('GET',actualDef); const p=detail?.processDefinition;
  if(!p || !Array.isArray(detail.taskDefinitionList) || !Array.isArray(detail.processTaskRelationList)) throw new Error('Definition payload is incomplete; refusing update');
  const inst=await requestPages(actualInst,{processDefineCode:code,pageNo:1,pageSize:100});
  const rows=inst?.totalList??[]; const terminal=new Set(['SUCCESS','FAILURE','FAILED','STOP','STOPPED','CANCEL','CANCELED']);
  if(rows.some(x=>!terminal.has(String(x.state).toUpperCase()))) throw new Error('Active instances exist; refusing update');
  const globals=typeof p.globalParams==='string'?JSON.parse(p.globalParams):(p.globalParams??[]);
  const arg=opts['global-param']; if(!arg||!arg.includes('=')) throw new Error('--global-param name=value required');
  const prop=arg.slice(0,arg.indexOf('=')), value=arg.slice(arg.indexOf('=')+1); const previous=globals.find(x=>x.prop===prop);
  const next=previous?globals.map(x=>x.prop===prop?{...x,value}:x):[...globals,{prop,direct:'IN',type:'VARCHAR',value}];
  const updates=opts['sql-updates-file']?JSON.parse(await readFile(opts['sql-updates-file'],'utf8')):{};
  const taskKeys=['code','name','version','description','taskType','taskParams','flag','isCache','taskPriority','workerGroup','environmentCode','failRetryTimes','failRetryInterval','timeoutFlag','timeoutNotifyStrategy','timeout','delayTime','resourceIds','taskGroupId','taskGroupPriority','cpuQuota','memoryMax','taskExecuteType','dependence'];
  const relationKeys=['name','preTaskCode','preTaskVersion','postTaskCode','postTaskVersion','conditionType','conditionParams'];
  const tasks=detail.taskDefinitionList.map(t=>{
    const raw=typeof t.taskParams==='string'?JSON.parse(t.taskParams):t.taskParams;
    const changed=Object.hasOwn(updates,String(t.code));
    const mapped={...t,version:changed?t.version+1:t.version,taskParams:changed?{...raw,sql:updates[String(t.code)]}:raw};
    return Object.fromEntries(taskKeys.map(k=>[k,mapped[k]]));
  });
  const bumped=new Map(tasks.map(t=>[t.code,t.version]));
  const relations=detail.processTaskRelationList.map(r=>Object.fromEntries(relationKeys.map(k=>[k,k==='preTaskVersion'&&bumped.has(r.preTaskCode)?bumped.get(r.preTaskCode):k==='postTaskVersion'&&bumped.has(r.postTaskCode)?bumped.get(r.postTaskCode):r[k]])));
  const update={name:p.name,description:p.description??'',globalParams:JSON.stringify(next),locations:typeof p.locations==='string'?p.locations:JSON.stringify(p.locations??[]),timeout:p.timeout??0,taskRelationJson:JSON.stringify(relations),taskDefinitionJson:JSON.stringify(tasks)};
  let result;
  try { result=await request('PUT',actualDef,update,true); }
  catch(e) { throw new Error(`Definition update failed; re-read before retry: ${e.message}`); }
  const afterDetail=await request('GET',actualDef); const after=afterDetail?.processDefinition;
  const afterGlobals=typeof after?.globalParams==='string'?JSON.parse(after.globalParams):(after?.globalParams??[]);
  if(!afterGlobals.some(x=>x.prop===prop&&x.value===value)) throw new Error('Global parameter readback mismatch');
  if(afterDetail.taskDefinitionList?.length!==detail.taskDefinitionList.length || afterDetail.processTaskRelationList?.length!==detail.processTaskRelationList.length) throw new Error('Task or relation count changed during update');
  const schedules=await requestPages(actualSched,{processDefinitionCode:code,processDefinitionId:after.id,pageNo:1,pageSize:100});
  console.log(JSON.stringify({result,definition:{code:after.code,name:after.name,releaseState:after.releaseState,version:after.version,globalParams:after.globalParams},taskCount:afterDetail.taskDefinitionList.length,relationCount:afterDetail.processTaskRelationList.length,schedules:schedules?.totalList??[]},null,2));
} else throw new Error('Command must be inspect, release, create-schedule, or online-schedule');
