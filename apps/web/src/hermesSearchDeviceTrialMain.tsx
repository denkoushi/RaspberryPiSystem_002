import { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';

import '@digital-go-jp/design-tokens/dist/tokens.css';
import { api } from './api/client';
import { getApiErrorMessage } from './api/errors';
import HermesChatPanel, { type HermesPanelMessage } from './components/hermes/HermesChatPanel';
import { AuthProvider } from './contexts/AuthContext';
import './components/hermes/hermes-floating-chat.css';
import './index.css';

function SearchTrial() {
  const [draft,setDraft]=useState('');
  const [messages,setMessages]=useState<HermesPanelMessage[]>([]);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const [scope,setScope]=useState<{enabled:boolean;snapshotCount?:number;organizedCount?:number}>({enabled:false});
  const [elapsed,setElapsed]=useState<number|null>(null);
  const completion=useRef<{started:number;messageId:string}|null>(null);
  const submitting=useRef(false);

  useEffect(()=>{
    const controller=new AbortController();
    api.get('/assembly/hermes-search-trial/scope',{signal:controller.signal})
      .then(({data})=>{setScope(data);if(!data.enabled)setError('試用検索は現在無効です。');})
      .catch(err=>{if(!controller.signal.aborted)setError(getApiErrorMessage(err,'試用検索に接続できません。既存画面でログインしてから開いてください。'));});
    return ()=>controller.abort();
  },[]);

  useEffect(()=>{
    const pending=completion.current;
    if(!pending || !messages.some(m=>m.id===pending.messageId)) return;
    // Two frames include the rendered answer's first paint, not just HTTP completion.
    let second=0;
    const first=requestAnimationFrame(()=>{
      second=requestAnimationFrame(()=>{
        setElapsed(Math.round((performance.now()-pending.started)*10)/10);
        completion.current=null;
      });
    });
    return ()=>{cancelAnimationFrame(first);cancelAnimationFrame(second);};
  },[messages]);

  const send=async()=>{
    const question=draft.trim();
    if(!question || submitting.current || !scope.enabled)return;
    submitting.current=true;setBusy(true);setError(null);setElapsed(null);
    const started=performance.now();
    const userId=crypto.randomUUID();
    setMessages(previous=>[...previous,{id:userId,role:'user',content:question}]);
    setDraft('');
    try {
      const {data}=await api.post<{answer:string;status:string}>('/assembly/hermes-search-trial/answer',{question},{timeout:35000});
      const id=crypto.randomUUID();
      completion.current={started,messageId:id};
      setMessages(previous=>[...previous,{id,role:'assistant',content:data.answer}]);
    } catch(err) {
      completion.current=null;
      setError(getApiErrorMessage(err,'検索に失敗しました。該当なしとは判断していません。'));
    } finally {submitting.current=false;setBusy(false);}
  };

  return <>
    <p role="status" data-hermes-trial-banner="true" data-hermes-answer-elapsed-ms={elapsed??''}
      style={{padding:'12px 16px',margin:0,background:'#fff4ce',color:'#16324f'}}>
      記録検索の試用
      {scope.enabled && <>{'　'}検索・番号照会 {scope.snapshotCount}件／整理済み回答 {scope.organizedCount}件</>}
      {elapsed!==null && <>{'　'}表示完了 {(elapsed/1000).toFixed(2)}秒</>}
    </p>
    <HermesChatPanel messages={messages} draft={draft} isBusy={busy} error={error}
      authRequired={null} onDraftChange={setDraft} onSend={()=>void send()}
      onReset={()=>{if(!busy){setMessages([]);setError(null);setElapsed(null);}}}
      onClose={()=>window.history.back()} isExpanded
      style={{position:'fixed',top:64,left:16,right:16,bottom:16,width:'auto',height:'auto',maxWidth:'none',maxHeight:'none'}} />
  </>;
}

const root=document.getElementById('root');
if(root)ReactDOM.createRoot(root).render(<AuthProvider><SearchTrial /></AuthProvider>);
