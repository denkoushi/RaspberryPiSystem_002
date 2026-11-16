const adj=require(process.argv[2]);const fs=require('fs');
let idx=0;const I={},L={},on={},st=[],out=[];
function sc(v){I[v]=L[v]=idx++;st.push(v);on[v]=1;for(const w of adj[v]||[]){if(!(w in I)){sc(w);L[v]=Math.min(L[v],L[w]);}else if(on[w])L[v]=Math.min(L[v],I[w]);}
 if(L[v]===I[v]){const c=[];let w;do{w=st.pop();on[w]=0;c.push(w);}while(w!==v);if(c.length>1)out.push(c);}}
for(const v of Object.keys(adj))if(!(v in I))sc(v);
out.sort((a,b)=>b.length-a.length);
for(const c of out.slice(0,+(process.env.TOP||6))){let ch=0;for(const f of c)ch+=fs.existsSync(f)?fs.readFileSync(f,'utf8').length:0;console.log('輪',c.length,'files',Math.round(ch/3.5/1000)+'k');console.log('  '+c.slice(0,12).join('\n  '));}
console.log('輪の数',out.length);
