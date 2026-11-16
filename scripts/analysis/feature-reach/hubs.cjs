const fs=require('fs');const [,,adjF,resF]=process.argv;const adj=require(adjF);const res=require(resF);
const isTest=f=>/\.(test|spec)\.tsx?$/.test(f)||/__tests__/.test(f);
const ch={};const C=f=>ch[f]??=(fs.existsSync(f)?fs.readFileSync(f,'utf8').length:0);
const memo={};function reach(f){if(memo[f])return memo[f];const s=new Set();const st=[f];while(st.length){const x=st.pop();if(s.has(x))continue;s.add(x);for(const d of adj[x]||[])st.push(d);}let c=0;for(const x of s)c+=C(x);return memo[f]={n:s.size,c};}
// 大きい機能(上位)に共通して入り、かつ自分の先が大きいファイル = つながりを広げている所
const big=res.filter(r=>r.chars/3.5>150000);
const fan={};for(const r of big)for(const f of r.closure)fan[f]=(fan[f]||0)+1;
const rows=Object.keys(fan).filter(f=>!isTest(f)).map(f=>({f,fan:fan[f],reach:Math.round(reach(f).c/3.5/1000),own:Math.round(C(f)/3.5/1000)}))
 .filter(r=>r.fan>=Math.max(3,big.length*0.3)&&r.reach>=40).sort((a,b)=>b.reach-a.reach);
console.log('大きい機能',big.length);for(const r of rows.slice(0,25))console.log(r.reach+'k\t'+r.fan+'\t'+r.f);
