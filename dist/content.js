console.log("Lector AI Content Script loaded on:",window.location.hostname);let r=null,m=null,f=null,x=null;function S(){if(document.getElementById("lector-ai-styles"))return;const t=document.createElement("style");t.id="lector-ai-styles",t.textContent=`
    @keyframes lectorFadeIn { from { opacity: 0; transform: translateY(-5px); } to { opacity: 1; transform: translateY(0); } }
    @keyframes lectorSpin { to { transform: rotate(360deg); } }
    @keyframes lectorFabPulse { 0%,100%{ box-shadow: 0 6px 20px rgba(102,126,234,.35);} 50%{ box-shadow: 0 6px 28px rgba(118,75,162,.55);} }
    #lector-ai-fab { position: fixed; right: 20px; bottom: 24px; width: 48px; height: 48px; border-radius: 50%; background: linear-gradient(135deg,#667eea 0%,#764ba2 100%); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 800; font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif; cursor: pointer; z-index: 2147483646; box-shadow: 0 6px 20px rgba(102,126,234,.35); animation: lectorFabPulse 3s ease-in-out infinite; transition: transform .15s ease; user-select: none; }
    #lector-ai-fab:hover { transform: scale(1.08); }
    #lector-ai-toolbar button { padding: 6px 12px; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all .15s ease; display: flex; align-items: center; gap: 4px; }
    #lector-ai-toolbar .t-btn { background: #fff; color: #667eea; }
    #lector-ai-toolbar .t-btn:hover { background: #f8fafc; transform: scale(1.05); }
    #lector-ai-toolbar .summary-btn { background: rgba(255,255,255,.2); color: #fff; }
    #lector-ai-toolbar .summary-btn:hover { background: rgba(255,255,255,.3); transform: scale(1.05); }
    #lector-ai-toolbar .close-btn { background: rgba(255,255,255,.1); color: #fff; padding: 6px 8px; }
    #lector-ai-toolbar .close-btn:hover { background: rgba(255,255,255,.25); }
    #lector-ai-result .result-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; padding-bottom:10px; border-bottom:1px solid #e2e8f0; }
    #lector-ai-result .result-title { font-size:13px; font-weight:700; color:#667eea; display:flex; align-items:center; gap:6px; }
    #lector-ai-result .result-content { font-size:13px; line-height:1.7; color:#334155; white-space:pre-wrap; word-break:break-word; }
    #lector-ai-result .result-content p { margin: 0 0 8px; }
    #lector-ai-result .action-btn { flex:1; padding:8px 12px; border:none; border-radius:8px; font-size:12px; font-weight:600; cursor:pointer; transition:all .15s ease; }
    #lector-ai-result .action-btn.primary { background:linear-gradient(135deg,#667eea 0%,#764ba2 100%); color:#fff; }
    #lector-ai-result .action-btn.primary:hover { transform:scale(1.02); box-shadow:0 4px 12px rgba(102,126,234,.3); }
    #lector-ai-result .copy-btn { flex:1; padding:8px 12px; border:none; border-radius:8px; font-size:12px; font-weight:600; background:#f1f5f9; color:#64748b; cursor:pointer; transition:all .15s ease; }
    #lector-ai-result .copy-btn:hover { background:#e2e8f0; }
    .lector-bilingual { font-size:.9em; color:#475569; border-left:3px solid #c7d2fe; padding:2px 0 2px 10px; margin:6px 0 6px 4px; }
  `,document.head.appendChild(t)}S();const z=["header","footer","nav","aside","form","iframe",'[role="navigation"]','[role="banner"]','[role="contentinfo"]',".advertisement",".ads",".ad",".share",".social",".newsletter",".related",".comments",".comment",".sidebar",".cookie"];function B(t){const n=(t.textContent||"").trim();if(!n)return 0;const e=(n.match(/[,.，。、；:;?!]/g)||[]).length,o=t.querySelectorAll("a").length/Math.max(1,n.split(/\s+/).length);return n.length+e*8-o*200}function L(t){return/[\u4e00-\u9fff]/.test(t)?"zh":/[\u3040-\u30ff]/.test(t)?"ja":/[\uac00-\ud7af]/.test(t)?"ko":"en"}function v(){var p;const t=document.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div');let n=null,e=0;t.forEach(u=>{if(u===document.body)return;const d=B(u);d>e&&(e=d,n=u)});const o=(n||document.body).cloneNode(!0);z.forEach(u=>{o.querySelectorAll(u).forEach(d=>d.remove())});const a=[];o.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre").forEach(u=>{const d=(u.textContent||"").replace(/\s+/g," ").trim();d.length>0&&a.push(d)});let c=a.join(`

`);c.length<200&&(c=(o.textContent||"").replace(/\s+/g," ").trim()),c=c.slice(0,2e4);const l=(((p=document.querySelector("h1"))==null?void 0:p.textContent)||"").trim()||document.title||"",s=document.querySelector('meta[name="author"]')||document.querySelector('meta[property="article:author"]');return{title:l,url:location.href,byline:(s==null?void 0:s.getAttribute("content"))||null,text:c,lang:L(c)}}function M(){x||(x=document.createElement("div"),x.id="lector-ai-fab",x.title="Open Lector AI",x.textContent="L",x.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{})},document.body.appendChild(x))}M();function A(t,n,e){g(),r=document.createElement("div"),r.id="lector-ai-toolbar",r.style.cssText=`
    position: fixed;
    left: ${t}px;
    top: ${n+20}px;
    display: flex;
    gap: 6px;
    padding: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,.25);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .2s ease-out;
  `;const i=(a,c,l)=>{const s=document.createElement("button");return s.className=a,s.innerHTML=c,s.onclick=p=>{if(p.stopPropagation(),typeof chrome>"u"||!chrome.runtime){alert("扩展未正确加载，请刷新页面");return}l()},s};r.appendChild(i("t-btn","🌐 翻译",()=>k("translate",e))),r.appendChild(i("t-btn","💬 解释",()=>k("explain",e))),r.appendChild(i("summary-btn","📄 摘要",()=>k("summarize",e))),r.appendChild(i("t-btn","🤖 提问",()=>k("ask",e)));const o=document.createElement("button");o.className="close-btn",o.innerHTML="✕",o.onclick=()=>g(),r.appendChild(o),document.body.appendChild(r)}function g(){r&&(r.remove(),r=null)}function T(t,n){h(),b(),f=document.createElement("div"),f.id="lector-ai-loading",f.style.cssText=`
    position: fixed;
    left: ${t}px;
    top: ${n+20}px;
    padding: 12px 20px;
    background: #fff;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0,0,0,.15);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #667eea;
  `;const e=document.createElement("div");e.style.cssText=`
    width:16px;height:16px;border:2px solid #e2e8f0;border-top-color:#667eea;border-radius:50%;animation:lectorSpin .8s linear infinite;
  `;const i=document.createElement("span");i.textContent="AI 处理中...",f.appendChild(e),f.appendChild(i),document.body.appendChild(f)}function h(){f&&(f.remove(),f=null)}function w(t,n,e,i){h(),b(),m=document.createElement("div"),m.id="lector-ai-result";const o=window.innerHeight-n-100;m.style.cssText=`
    position: fixed;
    left: ${t}px;
    top: ${n+20}px;
    max-width: 420px;
    max-height: ${Math.min(o,500)}px;
    overflow-y: auto;
    padding: 16px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .25s ease-out;
  `;const a=document.createElement("div");a.className="result-header";const c=document.createElement("div");c.className="result-title";const l={translate:"🌐 翻译结果",summary:"📄 摘要结果",explain:"💡 解释"};c.innerHTML=l[i];const s=document.createElement("button");s.style.cssText="padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;",s.textContent="关闭",s.onclick=()=>b(),a.appendChild(c),a.appendChild(s);const p=document.createElement("div");p.className="result-content",p.textContent=e;const u=document.createElement("div");u.style.cssText="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;";const d=document.createElement("button");d.className="action-btn copy-btn",d.textContent="📋 复制",d.onclick=()=>{navigator.clipboard.writeText(e),d.textContent="✅ 已复制",setTimeout(()=>d.textContent="📋 复制",1500)};const y=document.createElement("button");y.className="action-btn primary",y.textContent="🤖 在侧栏继续",y.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:i,text:e}}).catch(()=>{}),b(),g()},u.appendChild(d),u.appendChild(y),m.appendChild(a),m.appendChild(p),m.appendChild(u),document.body.appendChild(m),setTimeout(()=>document.addEventListener("click",E),100)}function b(){m&&(m.remove(),m=null),document.removeEventListener("click",E)}function E(t){const n=t.target;if(m&&!m.contains(n)&&b(),r&&!r.contains(n)){const e=window.getSelection();(!e||e.isCollapsed||e.toString().trim().length<2)&&g()}}function k(t,n){if(typeof chrome>"u"||!chrome.runtime)return;const e=r==null?void 0:r.getBoundingClientRect();if(T((e==null?void 0:e.left)||100,(e==null?void 0:e.top)||100),t==="ask"){chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:"ask",text:n}}).catch(()=>{}),h(),g();return}const i=t==="translate"?{action:"translate",text:n}:t==="summarize"?{action:"summarize",text:n}:{action:"explain",text:n};chrome.runtime.sendMessage(i,o=>{try{if(h(),chrome.runtime.lastError){const l=r==null?void 0:r.getBoundingClientRect();w((l==null?void 0:l.left)||100,(l==null?void 0:l.top)||100,"扩展已更新，请刷新页面重试","translate");return}if(o&&o.error){const l=r==null?void 0:r.getBoundingClientRect();w((l==null?void 0:l.left)||100,(l==null?void 0:l.top)||100,`失败: ${o.error}`,"translate");return}const a=r==null?void 0:r.getBoundingClientRect(),c=t==="translate"?(o==null?void 0:o.translatedText)||"翻译结果":t==="summarize"?(o==null?void 0:o.summary)||"暂无摘要":(o==null?void 0:o.explanation)||"暂无解释";w((a==null?void 0:a.left)||100,(a==null?void 0:a.top)||100,c,t==="summarize"?"summary":t==="translate"?"translate":"explain")}catch(a){console.error("Lector callback error:",a),h()}})}const C=new WeakSet;async function I(){const n=v().lang==="zh"?"English":"中文",e=Array.from(document.querySelectorAll("p, li, blockquote")).filter(o=>{const a=(o.textContent||"").trim();return a.length>=20&&a.length<=600&&!C.has(o)&&!o.closest("#lector-ai-result")}).slice(0,30);if(e.length===0)return;const i=await N();for(const o of e){const a=(o.textContent||"").trim();try{const c=await fetch(`${i}/translate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:a,targetLang:n,bilingual:!0})});if(!c.ok)continue;const s=(await c.json()).translatedText,p=document.createElement("div");p.className="lector-bilingual",p.textContent=s,o.appendChild(p),C.add(o)}catch{}}}async function N(){return new Promise(t=>{typeof chrome<"u"&&chrome.storage?chrome.storage.local.get(["apiBase"],n=>t(n.apiBase||"https://lector-ai-two.vercel.app/api")):t("https://lector-ai-two.vercel.app/api")})}document.addEventListener("mouseup",t=>{const n=t.target;n.closest("#lector-ai-toolbar")||n.closest("#lector-ai-result")||n.closest("#lector-ai-loading")||n.closest("#lector-ai-fab")||setTimeout(()=>{const e=window.getSelection();if(!e||e.isCollapsed)return;const i=e.toString().trim();if(i.length<2||i.length>5e3){g();return}const a=e.getRangeAt(0).getBoundingClientRect(),c=Math.max(10,Math.min(a.left,window.innerWidth-280)),l=a.bottom+window.scrollY;A(c,l,i)},100)});document.addEventListener("keydown",t=>{t.key==="Escape"&&(g(),b())});document.addEventListener("mousedown",t=>{const n=t.target;if(!n.closest("#lector-ai-toolbar")&&!n.closest("#lector-ai-result")&&!n.closest("#lector-ai-loading")&&!n.closest("#lector-ai-fab")){const e=window.getSelection();(!e||e.isCollapsed)&&g()}});chrome.runtime.onMessage.addListener((t,n,e)=>{if((t==null?void 0:t.action)==="lector-get-page"){const i=v();return e({page:i}),!1}return(t==null?void 0:t.action)==="lector-toggle-bilingual"?(I().then(()=>e({ok:!0})),!0):!1});
