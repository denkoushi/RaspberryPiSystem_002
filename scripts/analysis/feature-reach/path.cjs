const adj=require(process.argv[2]);const [,,,from,toPat]=process.argv;
const prev={[from]:null};const q=[from];let hit=null;
while(q.length){const x=q.shift();if(x!==from&&x.includes(toPat)){hit=x;break;}for(const d of adj[x]||[])if(!(d in prev)){prev[d]=x;q.push(d);}}
const p=[];for(let x=hit;x;x=prev[x])p.unshift(x);console.log(p.join('\n  -> '));
