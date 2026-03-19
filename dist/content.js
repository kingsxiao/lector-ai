chrome.runtime.onMessage.addListener((e,n,o)=>{e.action==="showTranslation"&&u(e.text,e.translatedText,e.x,e.y),e.action==="showSummary"&&s(e.summary,e.x,e.y)});function d(e,n,o){const i=document.getElementById("lector-ai-popup");i&&i.remove();const t=document.createElement("div");t.id="lector-ai-popup",t.className="lector-ai-popup",t.textContent=e,t.style.cssText=`
    position: fixed;
    left: ${n}px;
    top: ${o}px;
    max-width: 400px;
    max-height: 300px;
    overflow-y: auto;
    padding: 16px;
    background: white;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15);
    z-index: 999999;
    font-size: 14px;
    line-height: 1.5;
    color: #333;
  `,setTimeout(()=>{document.addEventListener("click",function c(p){t.contains(p.target)||(t.remove(),document.removeEventListener("click",c))})},100);const r=c=>{c.key==="Escape"&&(t.remove(),document.removeEventListener("keydown",r))};return document.addEventListener("keydown",r),document.body.appendChild(t),t}function u(e,n,o,i){const t=`${n}

---
原文: ${e}`;d(t,o,i)}function s(e,n,o){d(e,n,o)}document.addEventListener("mouseup",e=>{const n=window.getSelection();if(!n||n.isCollapsed)return;const o=n.toString().trim();o.length<2||o.length>5e3});
