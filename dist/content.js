console.log("🎓 Lector AI Content Script loaded on:",window.location.hostname);let n=null,i=null,d=null;function k(r,t,e){m(),n=document.createElement("div"),n.id="lector-ai-toolbar",n.style.cssText=`
    position: fixed;
    left: ${r}px;
    top: ${t+20}px;
    display: flex;
    gap: 6px;
    padding: 6px;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    border-radius: 10px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.2s ease-out;
  `;const o=document.createElement("style");o.textContent=`
    @keyframes lectorFadeIn {
      from { opacity: 0; transform: translateY(-5px); }
      to { opacity: 1; transform: translateY(0); }
    }
    #lector-ai-toolbar button {
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    #lector-ai-toolbar .translate-btn {
      background: white;
      color: #667eea;
    }
    #lector-ai-toolbar .translate-btn:hover {
      background: #f8fafc;
      transform: scale(1.05);
    }
    #lector-ai-toolbar .summary-btn {
      background: rgba(255, 255, 255, 0.2);
      color: white;
    }
    #lector-ai-toolbar .summary-btn:hover {
      background: rgba(255, 255, 255, 0.3);
      transform: scale(1.05);
    }
    #lector-ai-toolbar .close-btn {
      background: rgba(255, 255, 255, 0.1);
      color: white;
      padding: 6px 8px;
    }
    #lector-ai-toolbar .close-btn:hover {
      background: rgba(255, 255, 255, 0.25);
    }
  `,document.head.appendChild(o);const a=document.createElement("button");a.className="translate-btn",a.innerHTML="🌐 翻译",a.onclick=s=>{s.stopPropagation(),typeof chrome<"u"&&chrome.runtime?E(e):alert("扩展未正确加载，请刷新页面")};const c=document.createElement("button");c.className="summary-btn",c.innerHTML="📄 摘要",c.onclick=s=>{s.stopPropagation(),typeof chrome<"u"&&chrome.runtime?v(e):alert("扩展未正确加载，请刷新页面")};const l=document.createElement("button");l.className="close-btn",l.innerHTML="✕",l.onclick=()=>m(),n.appendChild(a),n.appendChild(c),n.appendChild(l),document.body.appendChild(n)}function m(){n&&(n.remove(),n=null)}function y(r,t){f(),u(),d=document.createElement("div"),d.id="lector-ai-loading",d.style.cssText=`
    position: fixed;
    left: ${r}px;
    top: ${t+20}px;
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
  `;const o=document.createElement("style");o.textContent=`
    @keyframes lectorSpin {
      to { transform: rotate(360deg); }
    }
  `,document.head.appendChild(o);const a=document.createElement("span");a.textContent="AI 处理中...",d.appendChild(e),d.appendChild(a),document.body.appendChild(d)}function f(){d&&(d.remove(),d=null)}function w(r,t,e,o){f(),u(),i=document.createElement("div"),i.id="lector-ai-result";const a=window.innerHeight-t-100;i.style.cssText=`
    position: fixed;
    left: ${r}px;
    top: ${t+20}px;
    max-width: 420px;
    max-height: ${Math.min(a,500)}px;
    overflow-y: auto;
    padding: 16px;
    background: white;
    border-radius: 14px;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
    z-index: 2147483647;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: lectorFadeIn 0.25s ease-out;
  `;const c=document.createElement("style");c.textContent=`
    @keyframes lectorFadeIn {
      from { opacity: 0; transform: translateY(-10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    #lector-ai-result .result-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
      padding-bottom: 10px;
      border-bottom: 1px solid #e2e8f0;
    }
    #lector-ai-result .result-title {
      font-size: 13px;
      font-weight: 700;
      color: #667eea;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    #lector-ai-result .result-content {
      font-size: 13px;
      line-height: 1.7;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
    }
    #lector-ai-result .action-btn {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    #lector-ai-result .action-btn.primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }
    #lector-ai-result .action-btn.primary:hover {
      transform: scale(1.02);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
    }
    #lector-ai-result .copy-btn {
      flex: 1;
      padding: 8px 12px;
      border: none;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 600;
      background: #f1f5f9;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s ease;
    }
    #lector-ai-result .copy-btn:hover {
      background: #e2e8f0;
    }
  `,document.head.appendChild(c);const l=document.createElement("div");l.className="result-header";const s=document.createElement("div");s.className="result-title",s.innerHTML=o==="translate"?"🌐 翻译结果":"📄 摘要结果";const x=document.createElement("button");x.style.cssText="padding: 4px 8px; border: none; background: #f1f5f9; border-radius: 4px; cursor: pointer; font-size: 11px; color: #94a3b8;",x.textContent="关闭",x.onclick=()=>u(),l.appendChild(s),l.appendChild(x);const h=document.createElement("div");h.className="result-content",h.textContent=e;const g=document.createElement("div");g.style.cssText="margin-top: 12px; padding-top: 10px; border-top: 1px solid #e2e8f0; display: flex; gap: 8px;";const p=document.createElement("button");p.className="action-btn copy-btn",p.textContent="📋 复制",p.onclick=()=>{navigator.clipboard.writeText(e),p.textContent="✅ 已复制",setTimeout(()=>p.textContent="📋 复制",1500)};const b=document.createElement("button");b.className="action-btn primary",b.textContent="🌐 再翻译一段",b.onclick=()=>{u(),m()},g.appendChild(p),g.appendChild(b),i.appendChild(l),i.appendChild(h),i.appendChild(g),document.body.appendChild(i),setTimeout(()=>{document.addEventListener("click",C)},100)}function u(){i&&(i.remove(),i=null),document.removeEventListener("click",C)}function C(r){const t=r.target;if(i&&!i.contains(t)&&u(),n&&!n.contains(t)){const e=window.getSelection();(!e||e.isCollapsed||e.toString().trim().length<2)&&m()}}function E(r){if(typeof chrome>"u"||!chrome.runtime){console.error("Chrome runtime not available"),alert("扩展未正确加载，请刷新页面");return}const t=n==null?void 0:n.getBoundingClientRect();y((t==null?void 0:t.left)||100,(t==null?void 0:t.top)||100),chrome.runtime.sendMessage({action:"translate",text:r,targetLang:"中文"},e=>{try{if(f(),chrome.runtime.lastError){console.error("❌ Runtime error:",chrome.runtime.lastError),alert("扩展已更新，请刷新页面重试");return}if(e&&e.error){console.error("❌ Translate error:",e.error),alert(`翻译失败: ${e.error}`);return}const o=n==null?void 0:n.getBoundingClientRect();w((o==null?void 0:o.left)||100,(o==null?void 0:o.top)||100,(e==null?void 0:e.translatedText)||"翻译结果","translate")}catch(o){console.error("❌ Error in translate callback:",o),f()}})}function v(r){if(typeof chrome>"u"||!chrome.runtime){console.error("Chrome runtime not available"),alert("扩展未正确加载，请刷新页面");return}const t=n==null?void 0:n.getBoundingClientRect();y((t==null?void 0:t.left)||100,(t==null?void 0:t.top)||100),chrome.runtime.sendMessage({action:"summarize",text:r},e=>{try{if(f(),chrome.runtime.lastError){console.error("❌ Runtime error:",chrome.runtime.lastError),alert("扩展已更新，请刷新页面重试");return}if(e&&e.error){console.error("❌ Summary error:",e.error),alert(`摘要失败: ${e.error}`);return}const o=(e==null?void 0:e.summary)||"暂无摘要",a=n==null?void 0:n.getBoundingClientRect();w((a==null?void 0:a.left)||100,(a==null?void 0:a.top)||100,o,"summary")}catch(o){console.error("❌ Error in summary callback:",o),f()}})}document.addEventListener("mouseup",r=>{const t=r.target;t.closest("#lector-ai-toolbar")||t.closest("#lector-ai-result")||t.closest("#lector-ai-loading")||setTimeout(()=>{const e=window.getSelection();if(!e||e.isCollapsed)return;const o=e.toString().trim();if(o.length<2||o.length>5e3){m();return}const c=e.getRangeAt(0).getBoundingClientRect(),l=Math.max(10,Math.min(c.left,window.innerWidth-200)),s=c.bottom+window.scrollY;k(l,s,o)},100)});document.addEventListener("keydown",r=>{r.key==="Escape"&&(m(),u())});document.addEventListener("mousedown",r=>{const t=r.target;if(!t.closest("#lector-ai-toolbar")&&!t.closest("#lector-ai-result")&&!t.closest("#lector-ai-loading")){const e=window.getSelection();(!e||e.isCollapsed)&&m()}});
