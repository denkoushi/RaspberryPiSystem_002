import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import {describe,it,expect,vi} from 'vitest';
import {env} from '../../../config/env.js';
import {ApiError} from '../../../lib/errors.js';
import {registerHermesSearchTrialRoutes} from '../hermes-search-trial.js';

describe('Hermes search trial authorization',()=>{
  it('uses the existing reader boundary, preserves original text and keeps failure separate from no match',async()=>{
    const app=Fastify();
    app.setErrorHandler((error,_request,reply)=>reply.code(error instanceof ApiError?error.statusCode:400).send({code:'REJECTED'}));
    const answer=vi.fn().mockResolvedValue({status:'completed',answer:'現象:\n左側の穴 0.5㎜。\n処置:\n再製作。',recordIds:['synthetic'],elapsedMs:2});
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
    expect((await app.inject({...request,payload:{question:'q',override:'unsafe'}})).statusCode).toBe(400);
    answer.mockRejectedValueOnce(new Error('検索に失敗しました。'));
    const failed=await app.inject(request);
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).not.toHaveProperty('answer');
    await app.close();
  });
});
