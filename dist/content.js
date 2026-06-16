console.log("Lector AI Content Script loaded on:",window.location.hostname);let i=null,u=null,g=null,x=null;function A(){if(document.getElementById("lector-ai-styles"))return;const t=document.createElement("style");t.id="lector-ai-styles",t.textContent=`
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
  `,document.head.appendChild(t)}A();const M=["header","footer","nav","aside","form","iframe",'[role="navigation"]','[role="banner"]','[role="contentinfo"]',".advertisement",".ads",".ad",".share",".social",".newsletter",".related",".comments",".comment",".sidebar",".cookie"];function I(t){const n=(t.textContent||"").trim();if(!n)return 0;const e=(n.match(/[,.，。、；:;?!]/g)||[]).length,a=t.querySelectorAll("a").length/Math.max(1,n.split(/\s+/).length);return n.length+e*8-a*200}function N(t){return/[\u4e00-\u9fff]/.test(t)?"zh":/[\u3040-\u30ff]/.test(t)?"ja":/[\uac00-\ud7af]/.test(t)?"ko":"en"}function E(){var f;const t=document.querySelectorAll('article, main, [role="main"], .post, .article, .content, .entry-content, div');let n=null,e=0;t.forEach(d=>{if(d===document.body)return;const b=I(d);b>e&&(e=b,n=d)});const o=n||document.body,a=o.cloneNode(!0);M.forEach(d=>{a.querySelectorAll(d).forEach(b=>b.remove())});const r=[],s=[];o.querySelectorAll("h1,h2,h3,h4,p,li,blockquote,pre").forEach(d=>{const b=(d.textContent||"").replace(/\s+/g," ").trim();if(b.length===0)return;const v=`b${r.length}`;try{d.setAttribute("data-lector-id",v)}catch{}r.push({id:v,text:b,domSelector:""}),s.push(b)});let c=s.join(`

`);c.length<200&&(c=(a.textContent||"").replace(/\s+/g," ").trim()),c=c.slice(0,2e4);const p=(((f=document.querySelector("h1"))==null?void 0:f.textContent)||"").trim()||document.title||"",h=document.querySelector('meta[name="author"]')||document.querySelector('meta[property="article:author"]');return{title:p,url:location.href,byline:(h==null?void 0:h.getAttribute("content"))||null,text:c,lang:N(c),blocks:r}}function T(){x||(x=document.createElement("div"),x.id="lector-ai-fab",x.title="Open Lector AI",x.textContent="L",x.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel"}).catch(()=>{})},document.body.appendChild(x))}T();function q(t,n,e){m(),i=document.createElement("div"),i.id="lector-ai-toolbar",i.style.cssText=`
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
  `;const o=(r,s,l)=>{const c=document.createElement("button");return c.className=r,c.innerHTML=s,c.onclick=p=>{if(p.stopPropagation(),typeof chrome>"u"||!chrome.runtime){alert("扩展未正确加载，请刷新页面");return}l()},c};i.appendChild(o("t-btn","🌐 翻译",()=>k("translate",e))),i.appendChild(o("t-btn","💬 解释",()=>k("explain",e))),i.appendChild(o("summary-btn","📄 摘要",()=>k("summarize",e))),i.appendChild(o("t-btn","🤖 提问",()=>k("ask",e))),i.appendChild(o("t-btn","🔖 高亮",()=>B(e))),i.appendChild(o("t-btn","★ 存词",()=>z(e)));const a=document.createElement("button");a.className="close-btn",a.innerHTML="✕",a.onclick=()=>m(),i.appendChild(a),document.body.appendChild(i)}function m(){i&&(i.remove(),i=null)}function R(t,n){w(),y(),g=document.createElement("div"),g.id="lector-ai-loading",g.style.cssText=`
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
  `;const o=document.createElement("span");o.textContent="AI 处理中...",g.appendChild(e),g.appendChild(o),document.body.appendChild(g)}function w(){g&&(g.remove(),g=null)}function C(t,n,e,o){w(),y(),u=document.createElement("div"),u.id="lector-ai-result";const a=window.innerHeight-n-100;u.style.cssText=`
    position: fixed;
    left: ${t}px;
    top: ${n+20}px;
    max-width: 420px;
    max-height: ${Math.min(a,500)}px;
    overflow-y: auto;
    padding: 16px;
    background: #fff;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0,0,0,.2);
    z-index: 2147483647;
    font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
    animation: lectorFadeIn .25s ease-out;
  `;const r=document.createElement("div");r.className="result-header";const s=document.createElement("div");s.className="result-title";const l={translate:"🌐 翻译结果",summary:"📄 摘要结果",explain:"💡 解释"};s.innerHTML=l[o];const c=document.createElement("button");c.style.cssText="padding:4px 8px;border:none;background:#f1f5f9;border-radius:4px;cursor:pointer;font-size:11px;color:#94a3b8;",c.textContent="关闭",c.onclick=()=>y(),r.appendChild(s),r.appendChild(c);const p=document.createElement("div");p.className="result-content",p.textContent=e;const h=document.createElement("div");h.style.cssText="margin-top:12px;padding-top:10px;border-top:1px solid #e2e8f0;display:flex;gap:8px;";const f=document.createElement("button");f.className="action-btn copy-btn",f.textContent="📋 复制",f.onclick=()=>{navigator.clipboard.writeText(e),f.textContent="✅ 已复制",setTimeout(()=>f.textContent="📋 复制",1500)};const d=document.createElement("button");d.className="action-btn primary",d.textContent="🤖 在侧栏继续",d.onclick=()=>{chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:o,text:e}}).catch(()=>{}),y(),m()},h.appendChild(f),h.appendChild(d),u.appendChild(r),u.appendChild(p),u.appendChild(h),document.body.appendChild(u),setTimeout(()=>document.addEventListener("click",L),100)}function y(){u&&(u.remove(),u=null),document.removeEventListener("click",L)}function L(t){const n=t.target;if(u&&!u.contains(n)&&y(),i&&!i.contains(n)){const e=window.getSelection();(!e||e.isCollapsed||e.toString().trim().length<2)&&m()}}function k(t,n){if(typeof chrome>"u"||!chrome.runtime)return;const e=i==null?void 0:i.getBoundingClientRect();if(R((e==null?void 0:e.left)||100,(e==null?void 0:e.top)||100),t==="ask"){chrome.runtime.sendMessage({action:"open-side-panel",seed:{kind:"ask",text:n}}).catch(()=>{}),w(),m();return}const o=t==="translate"?{action:"translate",text:n}:t==="summarize"?{action:"summarize",text:n}:{action:"explain",text:n};chrome.runtime.sendMessage(o,a=>{try{if(w(),chrome.runtime.lastError){const l=i==null?void 0:i.getBoundingClientRect();C((l==null?void 0:l.left)||100,(l==null?void 0:l.top)||100,"扩展已更新，请刷新页面重试","translate");return}if(a&&a.error){const l=i==null?void 0:i.getBoundingClientRect();C((l==null?void 0:l.left)||100,(l==null?void 0:l.top)||100,`失败: ${a.error}`,"translate");return}const r=i==null?void 0:i.getBoundingClientRect(),s=t==="translate"?(a==null?void 0:a.translatedText)||"翻译结果":t==="summarize"?(a==null?void 0:a.summary)||"暂无摘要":(a==null?void 0:a.explanation)||"暂无解释";C((r==null?void 0:r.left)||100,(r==null?void 0:r.top)||100,s,t==="summarize"?"summary":t==="translate"?"translate":"explain")}catch(r){console.error("Lector callback error:",r),w()}})}function B(t){var s;const n=window.getSelection();if(!n||n.isCollapsed){m();return}const e=n.getRangeAt(0);let o,a=t.slice(0,200),r=!1;try{const l=document.createElement("mark");l.className="lector-hl",l.title="Lector highlight",e.surroundContents(l),r=!0;const c=l.closest("[data-lector-id]");o=(c==null?void 0:c.getAttribute("data-lector-id"))||void 0,a=(((s=l.parentElement)==null?void 0:s.textContent)||t).slice(0,200)}catch{}chrome.runtime.sendMessage({action:"lector-highlight",highlight:{id:"h"+Date.now().toString(36),text:t,note:"",quote:a,url:location.href,title:document.title,blockId:o,createdAt:Date.now(),color:"yellow",marked:r}}).catch(()=>{}),m()}function z(t){var s;const n=window.getSelection(),e=(s=n==null?void 0:n.anchorNode)==null?void 0:s.parentElement,o=e==null?void 0:e.closest("[data-lector-id]"),a=(o==null?void 0:o.getAttribute("data-lector-id"))||void 0,r=((e==null?void 0:e.textContent)||t).slice(0,160);chrome.runtime.sendMessage({action:"lector-save-word",word:t,context:r,url:location.href,title:document.title,blockId:a}).catch(()=>{}),m()}const S=new WeakSet;async function $(){const n=E().lang==="zh"?"English":"中文",e=Array.from(document.querySelectorAll("p, li, blockquote")).filter(a=>{const r=(a.textContent||"").trim();return r.length>=20&&r.length<=600&&!S.has(a)&&!a.closest("#lector-ai-result")}).slice(0,30);if(e.length===0)return;const o=await F();for(const a of e){const r=(a.textContent||"").trim();try{const s=await fetch(`${o}/translate`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:r,targetLang:n,bilingual:!0})});if(!s.ok)continue;const c=(await s.json()).translatedText,p=document.createElement("div");p.className="lector-bilingual",p.textContent=c,a.appendChild(p),S.add(a)}catch{}}}async function F(){return new Promise(t=>{typeof chrome<"u"&&chrome.storage?chrome.storage.local.get(["apiBase"],n=>t(n.apiBase||"https://lector-ai-two.vercel.app/api")):t("https://lector-ai-two.vercel.app/api")})}document.addEventListener("mouseup",t=>{const n=t.target;n.closest("#lector-ai-toolbar")||n.closest("#lector-ai-result")||n.closest("#lector-ai-loading")||n.closest("#lector-ai-fab")||setTimeout(()=>{const e=window.getSelection();if(!e||e.isCollapsed)return;const o=e.toString().trim();if(o.length<2||o.length>5e3){m();return}const r=e.getRangeAt(0).getBoundingClientRect(),s=Math.max(10,Math.min(r.left,window.innerWidth-280)),l=r.bottom+window.scrollY;q(s,l,o)},100)});document.addEventListener("keydown",t=>{t.key==="Escape"&&(m(),y())});document.addEventListener("mousedown",t=>{const n=t.target;if(!n.closest("#lector-ai-toolbar")&&!n.closest("#lector-ai-result")&&!n.closest("#lector-ai-loading")&&!n.closest("#lector-ai-fab")){const e=window.getSelection();(!e||e.isCollapsed)&&m()}});chrome.runtime.onMessage.addListener((t,n,e)=>{if((t==null?void 0:t.action)==="lector-get-page"){const o=E();return e({page:o}),!1}if((t==null?void 0:t.action)==="lector-toggle-bilingual")return $().then(()=>e({ok:!0})),!0;if((t==null?void 0:t.action)==="lector-jump-to"){const o=document.querySelector(`[data-lector-id="${t.blockId}"]`);return o?(o.scrollIntoView({behavior:"smooth",block:"center"}),o.classList.add("lector-pulse"),setTimeout(()=>o.classList.remove("lector-pulse"),2e3),e({ok:!0})):e({ok:!1,reason:"node-unavailable"}),!1}if((t==null?void 0:t.action)==="lector-command"){const o=window.getSelection(),a=(o==null?void 0:o.toString().trim())||"";return a.length>0&&(t.command==="highlight-selection"?B(a):t.command==="save-word"&&z(a)),!1}return!1});
