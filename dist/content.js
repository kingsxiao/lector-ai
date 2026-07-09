import{t as M,g as E,c as L}from"./chunks/byok-4ilMGWLV.js";console.log("Lector AI Content Script loaded on:",window.location.hostname);let s=null,m=null,x=null,h=null;function N(){if(document.getElementById("lector-ai-styles"))return;const e=document.createElement("style");e.id="lector-ai-styles",e.textContent=`
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
  `,document.head.appendChild(e)}N();const P=["header","footer","nav","aside","form","iframe",'[role="navigation"]','[role="banner"]','[role="contentinfo"]',".advertisement",".ads",".ad",".share",".social",".newsletter",".related",".comments",".comment",".sidebar",".cookie"];function A(e){const n=(e.textContent||"").trim();if(!n)return 0;const t=(n.match(/[,.，。、；:;?!]/g)||[]).length,i=e.querySelectorAll("a").length/Math.max(1,n.split(/\s+/).length);return n.length+t*8-i*200}function I(e){return/[\u4e00-\u9fff]/.test(e)?"zh":/[\u3040-\u30ff]/.test(e)?"ja":/[\uac00-\ud7af]/.test(e)?"ko":"en"}function z(){var f;const e=document.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div');let n=null,t=0;e.forEach(p=>{if(p===document.body)return;const d=A(p);d>t&&(t=d,n=p)});const i=(n||document.body).cloneNode(!0);P.forEach(p=>{i.querySelectorAll(p).forEach(d=>d.remove())});const a=[];i.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre").forEach(p=>{const d=(p.textContent||"").replace(/\s+/g," ").trim();d.length>0&&a.push(d)});let r=a.join(`

`);r.length<200&&(r=(i.textContent||"").replace(/\s+/g," ").trim()),r=r.slice(0,2e4);const u=(((f=document.querySelector("h1"))==null?void 0:f.textContent)||"").trim()||document.title||"",l=document.querySelector('meta[name="author"]')||document.querySelector('meta[property="article:author"]');return{title:u,url:location.href,byline:(l==null?void 0:l.getAttribute("content"))||null,text:r,lang:I(r)}}function q(){h||(h=document.createElement("div"),h.id="lector-ai-fab",h.title=M("fab.title","auto"),h.textContent="L",h.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{})},document.body.appendChild(h))}q();function F(e,n,t){b(),s=document.createElement("div"),s.id="lector-ai-toolbar",s.style.cssText=`
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
  `;const o=(a,r,u)=>{const l=document.createElement("button");return l.className=a,l.innerHTML=r,l.onclick=f=>{if(f.stopPropagation(),typeof chrome>"u"||!chrome.runtime){alert(c("err.extensionNotLoaded"));return}u()},l};s.appendChild(o("t-btn",c("toolbar.translate"),()=>C("translate",t))),s.appendChild(o("t-btn",c("toolbar.explain"),()=>C("explain",t))),s.appendChild(o("summary-btn",c("toolbar.summarize"),()=>C("summarize",t))),s.appendChild(o("t-btn",c("toolbar.ask"),()=>C("ask",t)));const i=document.createElement("button");i.className="close-btn",i.innerHTML="✕",i.onclick=()=>b(),s.appendChild(i),document.body.appendChild(s)}function b(){s&&(s.remove(),s=null)}function R(e,n){y(),k(),x=document.createElement("div"),x.id="lector-ai-loading",x.style.cssText=`
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
  `;const o=document.createElement("span");o.textContent=c("popup.loading"),x.appendChild(t),x.appendChild(o),document.body.appendChild(x)}function y(){x&&(x.remove(),x=null)}function v(e,n,t,o){y(),k(),m=document.createElement("div"),m.id="lector-ai-result";const i=window.innerHeight-n-100;m.style.cssText=`
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
  `;const a=document.createElement("div");a.className="result-header";const r=document.createElement("div");r.className="result-title";const u={translate:c("popup.result.translate"),summary:c("popup.result.summary"),explain:c("popup.result.explain")};r.innerHTML=u[o];const l=document.createElement("button");l.style.cssText="padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;",l.textContent=c("popup.close"),l.onclick=()=>k(),a.appendChild(r),a.appendChild(l);const f=document.createElement("div");f.className="result-content",f.textContent=t;const p=document.createElement("div");p.style.cssText="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;";const d=document.createElement("button");d.className="action-btn copy-btn",d.textContent=c("popup.copy"),d.onclick=()=>{navigator.clipboard.writeText(t),d.textContent=c("popup.copied"),setTimeout(()=>d.textContent=c("popup.copy"),1500)};const g=document.createElement("button");g.className="action-btn primary",g.textContent=c("popup.continueInPanel"),g.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:o,text:t}}).catch(()=>{}),k(),b()},p.appendChild(d),p.appendChild(g),m.appendChild(a),m.appendChild(f),m.appendChild(p),document.body.appendChild(m),setTimeout(()=>document.addEventListener("click",T),100)}function k(){m&&(m.remove(),m=null),document.removeEventListener("click",T)}function T(e){const n=e.target;if(m&&!m.contains(n)&&k(),s&&!s.contains(n)){const t=window.getSelection();(!t||t.isCollapsed||t.toString().trim().length<2)&&b()}}let w="auto";async function Y(){try{w=(await E()).locale??"auto"}catch{w="auto"}return w}const c=e=>M(e,w);function C(e,n){const t=s==null?void 0:s.getBoundingClientRect();if(R((t==null?void 0:t.left)||100,(t==null?void 0:t.top)||100),e==="ask"){chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:"ask",text:n}}).catch(()=>{}),y(),b();return}$(e,n)}async function $(e,n){var r,u,l,f,p,d;const t=await E();w=t.locale??"auto";const o=()=>s==null?void 0:s.getBoundingClientRect();if(!t.apiKey){y(),v(((r=o())==null?void 0:r.left)||100,((u=o())==null?void 0:u.top)||100,c("err.addKey"),"translate"),chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{});return}let i="",a=1e3;e==="translate"?(i=`You are a professional translator. Translate the user text to ${/[\u4e00-\u9fff]/.test(n)?"English":"中文"}. Preserve meaning, tone, and formatting. Output ONLY the translation.`,a=Math.min(3e3,Math.max(500,n.length*2))):e==="summarize"?(i="You are Lector AI. Summarize the user content in 3-5 short bullets plus a one-line takeaway. Clean Markdown, no leading heading.",a=900):(i="You are Lector AI. Explain the user content clearly in a few sentences, then give one concrete example. Clean Markdown.",a=900);try{const g=await L(t,i,n.slice(0,8e3),{maxTokens:a,temperature:e==="translate"?.2:.5});y(),v(((l=o())==null?void 0:l.left)||100,((f=o())==null?void 0:f.top)||100,g||c("err.emptyResponse"),e==="summarize"?"summary":e==="translate"?"translate":"explain")}catch(g){y();const B=g instanceof Error?g.message:c("err.requestFailed");v(((p=o())==null?void 0:p.left)||100,((d=o())==null?void 0:d.top)||100,c("err.failedPrefix").replace("{msg}",B),"translate")}}const S=new WeakSet;async function O(){const e=await E();if(!e.apiKey){chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{});return}const t=z().lang==="zh"?"English":"中文",o=Array.from(document.querySelectorAll("p, li, blockquote")).filter(a=>{const r=(a.textContent||"").trim();return r.length>=20&&r.length<=600&&!S.has(a)&&!a.closest("#lector-ai-result")}).slice(0,30);if(o.length===0)return;const i=`You are a professional translator. Translate the user text to ${t}. Preserve meaning, tone, and formatting. Output ONLY the translation.`;for(const a of o){const r=(a.textContent||"").trim();try{const u=await L(e,i,r,{maxTokens:Math.min(1e3,Math.max(200,r.length*2)),temperature:.2});if(!u)continue;const l=document.createElement("div");l.className="lector-bilingual",l.textContent=u,a.appendChild(l),S.add(a)}catch{}}}document.addEventListener("mouseup",e=>{const n=e.target;n.closest("#lector-ai-toolbar")||n.closest("#lector-ai-result")||n.closest("#lector-ai-loading")||n.closest("#lector-ai-fab")||setTimeout(()=>{const t=window.getSelection();if(!t||t.isCollapsed)return;const o=t.toString().trim();if(o.length<2||o.length>5e3){b();return}const a=t.getRangeAt(0).getBoundingClientRect(),r=Math.max(10,Math.min(a.left,window.innerWidth-280)),u=a.bottom+window.scrollY;Y().then(()=>F(r,u,o))},100)});document.addEventListener("keydown",e=>{e.key==="Escape"&&(b(),k())});document.addEventListener("mousedown",e=>{const n=e.target;if(!n.closest("#lector-ai-toolbar")&&!n.closest("#lector-ai-result")&&!n.closest("#lector-ai-loading")&&!n.closest("#lector-ai-fab")){const t=window.getSelection();(!t||t.isCollapsed)&&b()}});chrome.runtime.onMessage.addListener((e,n,t)=>{if((e==null?void 0:e.action)==="lector-get-page"){const o=z();return t({page:o}),!1}return(e==null?void 0:e.action)==="lector-toggle-bilingual"?(O().then(()=>t({ok:!0})),!0):!1});
