console.log("Lector AI Content Script loaded on:",window.location.hostname);let t=null,l=null,s=null;function C(){if(document.getElementById("lector-ai-styles"))return;const i=document.createElement("style");i.id="lector-ai-styles",i.textContent=`
    @keyframes lectorFadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes lectorSpin {
      to { transform: rotate(360deg); }
    }
    #lector-ai-toolbar button {
      padding: 6px 12px; border: none; border-radius: 6px;
      font-size: 12px; font-weight: 600; cursor: pointer;
      transition: all 0.15s ease; display: flex; align-items: center; gap: 4px;
    }
    #lector-ai-toolbar .translate-btn { background: white; color: #667eea; }
    #lector-ai-toolbar .translate-btn:hover { background: #f8fafc; transform: scale(1.05); }
    #lector-ai-toolbar .summary-btn { background: rgba(255,255,255,0.2); color: white; }
    #lector-ai-toolbar .summary-btn:hover { background: rgba(255,255,255,0.3); transform: scale(1.05); }
    #lector-ai-toolbar .close-btn { background: rgba(255,255,255,0.1); color: white; padding: 6px 8px; }
    #lector-ai-toolbar .close-btn:hover { background: rgba(255,255,255,0.25); }
    #lector-ai-result .result-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; padding-bottom: 10px; border-bottom: 1px solid #e2e8f0; }
    #lector-ai-result .result-title { font-size: 13px; font-weight: 700; color: #667eea; display: flex; align-items: center; gap: 6px; }
    #lector-ai-result .result-content { font-size: 13px; line-height: 1.7; color: #334155; white-space: pre-wrap; word-break: break-word; }
    #lector-ai-result .action-btn { flex: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.15s ease; }
    #lector-ai-result .action-btn.primary { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; }
    #lector-ai-result .action-btn.primary:hover { transform: scale(1.02); box-shadow: 0 4px 12px rgba(102,126,234,0.3); }
    #lector-ai-result .copy-btn { flex: 1; padding: 8px 12px; border: none; border-radius: 8px; font-size: 12px; font-weight: 600; background: #f1f5f9; color: #64748b; cursor: pointer; transition: all 0.15s ease; }
    #lector-ai-result .copy-btn:hover { background: #e2e8f0; }
  `,document.head.appendChild(i)}C();function k(i,n,e){d(),t=document.createElement("div"),t.id="lector-ai-toolbar",t.style.cssText=`
    position: fixed;
    left: ${i}px;
    top: ${n+20}px;
    display: flex;
    gap: 6px;
    padding: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.2s ease-out;
  `;const r=document.createElement("button");r.className="translate-btn",r.innerHTML="🌐 翻译",r.onclick=c=>{c.stopPropagation(),typeof chrome<"u"&&chrome.runtime?v(e):alert("扩展未正确加载，请刷新页面")};const o=document.createElement("button");o.className="summary-btn",o.innerHTML="📄 摘要",o.onclick=c=>{c.stopPropagation(),typeof chrome<"u"&&chrome.runtime?E(e):alert("扩展未正确加载，请刷新页面")};const a=document.createElement("button");a.className="close-btn",a.innerHTML="✕",a.onclick=()=>d(),t.appendChild(r),t.appendChild(o),t.appendChild(a),document.body.appendChild(t)}function d(){t&&(t.remove(),t=null)}function y(i,n){f(),g(),s=document.createElement("div"),s.id="lector-ai-loading",s.style.cssText=`
    position: fixed;
    left: ${i}px;
    top: ${n+20}px;
    padding: 12px 20px;
    background: white;
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    color: #667eea;
  `;const e=document.createElement("div");e.style.cssText=`
    width: 16px;
    height: 16px;
    border: 2px solid #e2e8f0;
    border-top-color: #667eea;
    border-radius: 50%;
    animation: lectorSpin 0.8s linear infinite;
  `;const r=document.createElement("span");r.textContent="AI 处理中...",s.appendChild(e),s.appendChild(r),document.body.appendChild(s)}function f(){s&&(s.remove(),s=null)}function u(i,n,e,r){f(),g(),l=document.createElement("div"),l.id="lector-ai-result";const o=window.innerHeight-n-100;l.style.cssText=`
    position: fixed;
    left: ${i}px;
    top: ${n+20}px;
    max-width: 420px;
    max-height: ${Math.min(o,500)}px;
    overflow-y: auto;
    padding: 16px;
    background: white;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.25s ease-out;
  `;const a=document.createElement("div");a.className="result-header";const c=document.createElement("div");c.className="result-title",c.innerHTML=r==="translate"?"🌐 翻译结果":"📄 摘要结果";const m=document.createElement("button");m.style.cssText="padding: 4px 8px; border: none; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 11px; color: #94a3b8;",m.textContent="关闭",m.onclick=()=>g(),a.appendChild(c),a.appendChild(m);const h=document.createElement("div");h.className="result-content",h.textContent=e;const x=document.createElement("div");x.style.cssText="margin-top: 12px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px;";const p=document.createElement("button");p.className="action-btn copy-btn",p.textContent="📋 复制",p.onclick=()=>{navigator.clipboard.writeText(e),p.textContent="✅ 已复制",setTimeout(()=>p.textContent="📋 复制",1500)};const b=document.createElement("button");b.className="action-btn primary",b.textContent="🌐 再翻译一段",b.onclick=()=>{g(),d()},x.appendChild(p),x.appendChild(b),l.appendChild(a),l.appendChild(h),l.appendChild(x),document.body.appendChild(l),setTimeout(()=>{document.addEventListener("click",w)},100)}function g(){l&&(l.remove(),l=null),document.removeEventListener("click",w)}function w(i){const n=i.target;if(l&&!l.contains(n)&&g(),t&&!t.contains(n)){const e=window.getSelection();(!e||e.isCollapsed||e.toString().trim().length<2)&&d()}}function v(i){if(typeof chrome>"u"||!chrome.runtime){console.error("Chrome runtime not available");return}const n=t==null?void 0:t.getBoundingClientRect();y((n==null?void 0:n.left)||100,(n==null?void 0:n.top)||100),chrome.runtime.sendMessage({action:"translate",text:i,targetLang:"中文"},e=>{try{if(f(),chrome.runtime.lastError){console.error("Runtime error:",chrome.runtime.lastError);const o=t==null?void 0:t.getBoundingClientRect();u((o==null?void 0:o.left)||100,(o==null?void 0:o.top)||100,"扩展已更新，请刷新页面重试","translate");return}if(e&&e.error){console.error("Translate error:",e.error);const o=t==null?void 0:t.getBoundingClientRect();u((o==null?void 0:o.left)||100,(o==null?void 0:o.top)||100,`翻译失败: ${e.error}`,"translate");return}const r=t==null?void 0:t.getBoundingClientRect();u((r==null?void 0:r.left)||100,(r==null?void 0:r.top)||100,(e==null?void 0:e.translatedText)||"翻译结果","translate")}catch(r){console.error("Error in translate callback:",r),f()}})}function E(i){if(typeof chrome>"u"||!chrome.runtime){console.error("Chrome runtime not available");return}const n=t==null?void 0:t.getBoundingClientRect();y((n==null?void 0:n.left)||100,(n==null?void 0:n.top)||100),chrome.runtime.sendMessage({action:"summarize",text:i},e=>{try{if(f(),chrome.runtime.lastError){console.error("Runtime error:",chrome.runtime.lastError);const a=t==null?void 0:t.getBoundingClientRect();u((a==null?void 0:a.left)||100,(a==null?void 0:a.top)||100,"扩展已更新，请刷新页面重试","summary");return}if(e&&e.error){console.error("Summary error:",e.error);const a=t==null?void 0:t.getBoundingClientRect();u((a==null?void 0:a.left)||100,(a==null?void 0:a.top)||100,`摘要失败: ${e.error}`,"summary");return}const r=(e==null?void 0:e.summary)||"暂无摘要",o=t==null?void 0:t.getBoundingClientRect();u((o==null?void 0:o.left)||100,(o==null?void 0:o.top)||100,r,"summary")}catch(r){console.error("Error in summary callback:",r),f()}})}document.addEventListener("mouseup",i=>{const n=i.target;n.closest("#lector-ai-toolbar")||n.closest("#lector-ai-result")||n.closest("#lector-ai-loading")||setTimeout(()=>{const e=window.getSelection();if(!e||e.isCollapsed)return;const r=e.toString().trim();if(r.length<2||r.length>5e3){d();return}const a=e.getRangeAt(0).getBoundingClientRect(),c=Math.max(10,Math.min(a.left,window.innerWidth-200)),m=a.bottom+window.scrollY;k(c,m,r)},100)});document.addEventListener("keydown",i=>{i.key==="Escape"&&(d(),g())});document.addEventListener("mousedown",i=>{const n=i.target;if(!n.closest("#lector-ai-toolbar")&&!n.closest("#lector-ai-result")&&!n.closest("#lector-ai-loading")){const e=window.getSelection();(!e||e.isCollapsed)&&d()}});
