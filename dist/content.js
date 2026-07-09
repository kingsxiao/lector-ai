import{g as v,c as E}from"./chunks/byok-B_AzYE6T.js";console.log("Lector AI Content Script loaded on:",window.location.hostname);let s=null,u=null,g=null,b=null;function z(){if(document.getElementById("lector-ai-styles"))return;const e=document.createElement("style");e.id="lector-ai-styles",e.textContent=`
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
  `,document.head.appendChild(e)}z();const T=["header","footer","nav","aside","form","iframe",'[role="navigation"]','[role="banner"]','[role="contentinfo"]',".advertisement",".ads",".ad",".share",".social",".newsletter",".related",".comments",".comment",".sidebar",".cookie"];function A(e){const n=(e.textContent||"").trim();if(!n)return 0;const t=(n.match(/[,.，。、；:;?!]/g)||[]).length,i=e.querySelectorAll("a").length/Math.max(1,n.split(/\s+/).length);return n.length+t*8-i*200}function I(e){return/[\u4e00-\u9fff]/.test(e)?"zh":/[\u3040-\u30ff]/.test(e)?"ja":/[\uac00-\ud7af]/.test(e)?"ko":"en"}function S(){var m;const e=document.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div');let n=null,t=0;e.forEach(d=>{if(d===document.body)return;const c=A(d);c>t&&(t=c,n=d)});const i=(n||document.body).cloneNode(!0);T.forEach(d=>{i.querySelectorAll(d).forEach(c=>c.remove())});const a=[];i.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre").forEach(d=>{const c=(d.textContent||"").replace(/\s+/g," ").trim();c.length>0&&a.push(c)});let r=a.join(`

`);r.length<200&&(r=(i.textContent||"").replace(/\s+/g," ").trim()),r=r.slice(0,2e4);const p=(((m=document.querySelector("h1"))==null?void 0:m.textContent)||"").trim()||document.title||"",l=document.querySelector('meta[name="author"]')||document.querySelector('meta[property="article:author"]');return{title:p,url:location.href,byline:(l==null?void 0:l.getAttribute("content"))||null,text:r,lang:I(r)}}function B(){b||(b=document.createElement("div"),b.id="lector-ai-fab",b.title="Open Lector AI",b.textContent="L",b.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{})},document.body.appendChild(b))}B();function N(e,n,t){x(),s=document.createElement("div"),s.id="lector-ai-toolbar",s.style.cssText=`
    position: fixed;
    left: ${e}px;
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
  `;const o=(a,r,p)=>{const l=document.createElement("button");return l.className=a,l.innerHTML=r,l.onclick=m=>{if(m.stopPropagation(),typeof chrome>"u"||!chrome.runtime){alert("扩展未正确加载，请刷新页面");return}p()},l};s.appendChild(o("t-btn","🌐 翻译",()=>k("translate",t))),s.appendChild(o("t-btn","💬 解释",()=>k("explain",t))),s.appendChild(o("summary-btn","📄 摘要",()=>k("summarize",t))),s.appendChild(o("t-btn","🤖 提问",()=>k("ask",t)));const i=document.createElement("button");i.className="close-btn",i.innerHTML="✕",i.onclick=()=>x(),s.appendChild(i),document.body.appendChild(s)}function x(){s&&(s.remove(),s=null)}function P(e,n){h(),y(),g=document.createElement("div"),g.id="lector-ai-loading",g.style.cssText=`
    position: fixed;
    left: ${e}px;
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
  `;const t=document.createElement("div");t.style.cssText=`
    width:16px;height:16px;border:2px solid #e2e8f0;border-top-color:#667eea;border-radius:50%;animation:lectorSpin .8s linear infinite;
  `;const o=document.createElement("span");o.textContent="AI 处理中...",g.appendChild(t),g.appendChild(o),document.body.appendChild(g)}function h(){g&&(g.remove(),g=null)}function w(e,n,t,o){h(),y(),u=document.createElement("div"),u.id="lector-ai-result";const i=window.innerHeight-n-100;u.style.cssText=`
    position: fixed;
    left: ${e}px;
    top: ${n+20}px;
    max-width: 420px;
    max-height: ${Math.min(i,500)}px;
    overflow-y: auto;
    padding: 16px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .25s ease-out;
  `;const a=document.createElement("div");a.className="result-header";const r=document.createElement("div");r.className="result-title";const p={translate:"🌐 翻译结果",summary:"📄 摘要结果",explain:"💡 解释"};r.innerHTML=p[o];const l=document.createElement("button");l.style.cssText="padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;",l.textContent="关闭",l.onclick=()=>y(),a.appendChild(r),a.appendChild(l);const m=document.createElement("div");m.className="result-content",m.textContent=t;const d=document.createElement("div");d.style.cssText="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;";const c=document.createElement("button");c.className="action-btn copy-btn",c.textContent="📋 复制",c.onclick=()=>{navigator.clipboard.writeText(t),c.textContent="✅ 已复制",setTimeout(()=>c.textContent="📋 复制",1500)};const f=document.createElement("button");f.className="action-btn primary",f.textContent="🤖 在侧栏继续",f.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:o,text:t}}).catch(()=>{}),y(),x()},d.appendChild(c),d.appendChild(f),u.appendChild(a),u.appendChild(m),u.appendChild(d),document.body.appendChild(u),setTimeout(()=>document.addEventListener("click",M),100)}function y(){u&&(u.remove(),u=null),document.removeEventListener("click",M)}function M(e){const n=e.target;if(u&&!u.contains(n)&&y(),s&&!s.contains(n)){const t=window.getSelection();(!t||t.isCollapsed||t.toString().trim().length<2)&&x()}}function k(e,n){const t=s==null?void 0:s.getBoundingClientRect();if(P((t==null?void 0:t.left)||100,(t==null?void 0:t.top)||100),e==="ask"){chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:"ask",text:n}}).catch(()=>{}),h(),x();return}q(e,n)}async function q(e,n){var r,p,l,m,d,c;const t=await v(),o=()=>s==null?void 0:s.getBoundingClientRect();if(!t.apiKey){h(),w(((r=o())==null?void 0:r.left)||100,((p=o())==null?void 0:p.top)||100,"请在侧栏设置中添加 API Key 后使用。","translate"),chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{});return}let i="",a=1e3;e==="translate"?(i=`You are a professional translator. Translate the user text to ${/[\u4e00-\u9fff]/.test(n)?"English":"中文"}. Preserve meaning, tone, and formatting. Output ONLY the translation.`,a=Math.min(3e3,Math.max(500,n.length*2))):e==="summarize"?(i="You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.",a=900):(i="You are Lector AI. Explain the user content clearly in a few sentences, then give one concrete example. Clean Markdown.",a=900);try{const f=await E(t,i,n.slice(0,8e3),{maxTokens:a,temperature:e==="translate"?.2:.5});h(),w(((l=o())==null?void 0:l.left)||100,((m=o())==null?void 0:m.top)||100,f||"(空响应)",e==="summarize"?"summary":e==="translate"?"translate":"explain")}catch(f){h();const L=f instanceof Error?f.message:"请求失败";w(((d=o())==null?void 0:d.left)||100,((c=o())==null?void 0:c.top)||100,`失败: ${L}`,"translate")}}const C=new WeakSet;async function F(){const e=await v();if(!e.apiKey){chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{});return}const t=S().lang==="zh"?"English":"中文",o=Array.from(document.querySelectorAll("p, li, blockquote")).filter(a=>{const r=(a.textContent||"").trim();return r.length>=20&&r.length<=600&&!C.has(a)&&!a.closest("#lector-ai-result")}).slice(0,30);if(o.length===0)return;const i=`You are a professional translator. Translate the user text to ${t}. Preserve meaning, tone, and formatting. Output ONLY the translation.`;for(const a of o){const r=(a.textContent||"").trim();try{const p=await E(e,i,r,{maxTokens:Math.min(1e3,Math.max(200,r.length*2)),temperature:.2});if(!p)continue;const l=document.createElement("div");l.className="lector-bilingual",l.textContent=p,a.appendChild(l),C.add(a)}catch{}}}document.addEventListener("mouseup",e=>{const n=e.target;n.closest("#lector-ai-toolbar")||n.closest("#lector-ai-result")||n.closest("#lector-ai-loading")||n.closest("#lector-ai-fab")||setTimeout(()=>{const t=window.getSelection();if(!t||t.isCollapsed)return;const o=t.toString().trim();if(o.length<2||o.length>5e3){x();return}const a=t.getRangeAt(0).getBoundingClientRect(),r=Math.max(10,Math.min(a.left,window.innerWidth-280)),p=a.bottom+window.scrollY;N(r,p,o)},100)});document.addEventListener("keydown",e=>{e.key==="Escape"&&(x(),y())});document.addEventListener("mousedown",e=>{const n=e.target;if(!n.closest("#lector-ai-toolbar")&&!n.closest("#lector-ai-result")&&!n.closest("#lector-ai-loading")&&!n.closest("#lector-ai-fab")){const t=window.getSelection();(!t||t.isCollapsed)&&x()}});chrome.runtime.onMessage.addListener((e,n,t)=>{if((e==null?void 0:e.action)==="lector-get-page"){const o=S();return t({page:o}),!1}return(e==null?void 0:e.action)==="lector-toggle-bilingual"?(F().then(()=>t({ok:!0})),!0):!1});
