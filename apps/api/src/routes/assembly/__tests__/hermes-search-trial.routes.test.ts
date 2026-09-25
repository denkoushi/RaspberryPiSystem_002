import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import pino from 'pino';
import {describe,it,expect,vi} from 'vitest';
import {env} from '../../../config/env.js';
import {ApiError} from '../../../lib/errors.js';
import {registerHermesSearchTrialRoutes} from '../hermes-search-trial.js';

describe('Hermes search trial authorization',()=>{
  it('uses the existing reader boundary, preserves original text and keeps failure separate from no match',async()=>{
    const app=Fastify();
    app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ApiError?error.statusCode:400).send({code:'REJECTED'}));
    const conditionChange={operationJudgment:{type:'choice',choice:'remove_condition'},targetJudgment:{type:'choice',choice:'organization_facility'},selectedTarget:'organization_facility',remove:{organizationFacility:true},rejectionReason:null};
    const operationDecision={changeActionJudgment:{type:'choice',choice:'replace_condition',probabilities:{replace_condition:1},confidence:0.94},code:{lexicalAction:'new_search',judgedAction:'replace_condition',action:null,rejectionReason:'lexical_action_mismatch'}};
    const answer=vi.fn().mockResolvedValue({status:'completed',answer:'現象:\n左側の穴 0.5㎜。\n処置:\n再製作。',recordIds:['synthetic'],elapsedMs:2,searchDiagnostics:{conditionChange,operationDecision}});
    const service={isEnabled:()=>true,scope:async()=>({enabled:true}),answer,close:vi.fn()};
    await registerHermesSearchTrialRoutes(app,service as never);
    const url='/assembly/hermes-search-trial/answer';
    expect((await app.inject({method:'POST',url,payload:{question:'処置は？'}})).statusCode).toBe(401);
    expect(answer).not.toHaveBeenCalled();
    const token=jwt.sign({sub:'reader',username:'reader',role:'VIEWER'},env.JWT_ACCESS_SECRET);
    const request={method:'POST' as const,url,headers:{authorization:`Bearer ${token}`},payload:{question:'処置は？'}};
    const response=await app.inject(request);
    expect(response.statusCode).toBe(200);
    expect(response.json().answer).toBe('現象:\n左側の穴 0.5㎜。\n処置:\n再製作。');
    expect(response.json().searchDiagnostics.conditionChange).toEqual(conditionChange);
    expect(response.json().searchDiagnostics.operationDecision).toEqual(operationDecision);
    const sessionId='00000000-0000-4000-8000-000000000001';
    const sessionResponse=await app.inject({...request,payload:{question:'処置は？',sessionId}});
    expect(sessionResponse.statusCode).toBe(200);
    expect(answer).toHaveBeenLastCalledWith('処置は？',sessionId);
    expect((await app.inject({...request,payload:{question:'q',override:'unsafe'}})).statusCode).toBe(400);
    answer.mockRejectedValueOnce(new Error('検索に失敗しました。'));
    const failed=await app.inject(request);
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).not.toHaveProperty('answer');
    await app.close();
  });

  it('returns bounded confirmation state for the trial round trip',async()=>{
    const app=Fastify();
    const confirmationPending={
      request:'synthetic-confirmation-v1',
      question:'検索対象を指定してください。架空対象Aまたは架空対象Bを入力してください。',
      purpose:'collect_missing_values',
      requiredItems:[{id:'target',label:'検索対象',type:'string',candidates:['架空対象A','架空対象B']}],
      confirmedInfo:{},
      unresolvedItems:['target']
    };
    const answer=vi.fn().mockResolvedValue({status:'clarification',answer:confirmationPending.question,recordIds:[],elapsedMs:1,confirmationPending});
    const service={isEnabled:()=>true,scope:async()=>({enabled:true}),answer,close:vi.fn()};
    await registerHermesSearchTrialRoutes(app,service as never);
    const token=jwt.sign({sub:'reader',username:'reader',role:'VIEWER'},env.JWT_ACCESS_SECRET);
    const sessionId='00000000-0000-4000-8000-000000000002';
    const response=await app.inject({method:'POST',url:'/assembly/hermes-search-trial/answer',headers:{authorization:`Bearer ${token}`},payload:{question:'架空対象の記録を確認したい',sessionId}});
    expect(response.statusCode).toBe(200);
    expect(response.json().confirmationPending).toEqual(confirmationPending);
    expect(answer).toHaveBeenCalledWith('架空対象の記録を確認したい',sessionId);
    await app.close();
  });

  it('logs only an allowlisted worker failure diagnostic and keeps it out of the response',async()=>{
    const output: Array<Record<string, unknown>> = [];
    const logger = pino({level:'warn'}, {write:line=>output.push(JSON.parse(line) as Record<string, unknown>)});
    const app=Fastify({loggerInstance:logger});
    const answer=vi.fn().mockRejectedValue(Object.assign(
      new Error('検索に失敗しました。該当なしとは判断していません。'),
      {workerFailureDiagnostic:{stage:'jev_query',exceptionType:'TypeSafeDirectError',provider:'typesafe-direct',failureCode:'upstream_http',httpStatus:503,message:'private detail'}},
    ));
    const service={isEnabled:()=>true,scope:async()=>({enabled:true}),answer,close:vi.fn()};
    await registerHermesSearchTrialRoutes(app,service as never);
    const token=jwt.sign({sub:'reader',username:'reader',role:'VIEWER'},env.JWT_ACCESS_SECRET);
    const response=await app.inject({method:'POST',url:'/assembly/hermes-search-trial/answer',headers:{authorization:`Bearer ${token}`},payload:{question:'質問の原文'}});
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({code:'HERMES_SEARCH_UNAVAILABLE',message:'検索に失敗しました。該当なしとは判断していません。'});
    const diagnostic=output.find(entry=>entry.msg==='Hermes search worker request failed');
    expect(diagnostic).toMatchObject({stage:'jev_query',exceptionType:'TypeSafeDirectError',provider:'typesafe-direct',failureCode:'upstream_http',httpStatus:503});
    expect(JSON.stringify(diagnostic)).not.toContain('private detail');
    expect(JSON.stringify(diagnostic)).not.toContain('質問の原文');
    await app.close();
  });

  it('logs one receipt with the question and keeps it out of the kiosk response',async()=>{
    const output:Array<Record<string, unknown>>=[];
    const logger=pino({level:'info'},{write:line=>output.push(JSON.parse(line) as Record<string, unknown>)});
    const app=Fastify({loggerInstance:logger});
    const receipt={schema:'hermes-search-receipt/v1',outcome:'answer',plan:{filters:[],semanticQuery:'q',sort:'relevance',limit:5},jev:{model:'jev-1.13.0',turn:'first',answers:{content:{noul:0.9}}},resultCount:1};
    const answer=vi.fn().mockResolvedValue({status:'completed',answer:'処置:\n再製作。',recordIds:['synthetic'],elapsedMs:2,receipt});
    await registerHermesSearchTrialRoutes(app,{isEnabled:()=>true,scope:async()=>({enabled:true}),answer,close:vi.fn()} as never);
    const token=jwt.sign({sub:'reader',username:'reader',role:'VIEWER'},env.JWT_ACCESS_SECRET);
    const response=await app.inject({method:'POST',url:'/assembly/hermes-search-trial/answer',headers:{authorization:`Bearer ${token}`},payload:{question:'溶接の不適合'}});
    expect(response.statusCode).toBe(200);
    expect(response.json()).not.toHaveProperty('receipt');
    const line=output.find((entry)=>entry.msg==='Hermes search receipt');
    expect(line?.hermesReceipt).toMatchObject({...receipt,question:'溶接の不適合'});
    expect(JSON.stringify(line)).not.toContain('再製作');
    await app.close();
  });
});
