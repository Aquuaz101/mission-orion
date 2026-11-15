import{t as e}from"./peerSocket-Ca0HJBat.js";var t=document.getElementById(`app`),n=new URLSearchParams(location.search).get(`pin`)??localStorage.getItem(`orion.ctrl.pin`)??``,r=null,i=0,a=!1,o=null,s={},c=e=>{let t=document.createElement(`template`);return t.innerHTML=e.trim(),t.content.firstElementChild};t.innerHTML=`
  <header class="c-head">
    <div class="c-brand"><span class="mono">MISSION<b>:</b></span> ORION</div>
    <div class="c-status" data-s="connecting"><i></i><span>Connecting…</span></div>
  </header>
  <main class="c-main"></main>
  <div class="c-overlay" hidden><div class="c-overlay-box"><div class="spinner"></div><p class="c-overlay-text">Waiting for mission computer…</p></div></div>`;var l=t.querySelector(`.c-main`),u=t.querySelector(`.c-status`),d=t.querySelector(`.c-overlay`);function f(e){r?.readyState===WebSocket.OPEN&&r.send(JSON.stringify(e))}function p(e,t){u.dataset.s=e,u.querySelector(`span`).textContent=t,d.hidden=e===`linked`||!o,d.querySelector(`.c-overlay-text`).textContent=e===`offline`?`Connection lost: reconnecting…`:e===`waiting`?`Waiting for mission computer…`:`Connecting…`}function m(){if(!/^\d{4}$/.test(n))return _();localStorage.setItem(`orion.ctrl.pin`,n),location.protocol;let t=new e(n);r=t,p(`connecting`,`Connecting…`),t.onmessage=e=>{let t=JSON.parse(e.data);switch(t.t){case`joined`:i=0,o||O(`lobby`,`Controller linked`,`Follow the main screen`);return;case`peer`:a=t.connected,p(a?`linked`:`waiting`,a?`Linked · ${n}`:`PC offline`),a&&g([20,40,20]);return;case`error`:t.code===`bad-pin`&&(localStorage.removeItem(`orion.ctrl.pin`),_(`Session not found. Check the PIN on the main screen.`));return;case`layout`:O(t.layout,t.title,t.subtitle,t.missions,t.cta);return;case`hud`:s={...s,...t.hud},A();return;case`buzz`:g(t.pattern);return}},t.onclose=e=>{r===t&&e.code!==4004&&(e.code===4001?p(`offline`,`Replaced by another phone`):(p(`offline`,`Reconnecting…`),setTimeout(m,Math.min(4e3,400*2**i++))))}}document.addEventListener(`visibilitychange`,()=>{document.visibilityState===`visible`&&(!r||r.readyState>1)&&m()});var h=!1;window.addEventListener(`pointerdown`,()=>h=!0,{capture:!0,once:!0});function g(e){if(h)try{navigator.vibrate?.(e)}catch{}}function _(e=``){o=null,d.hidden=!0,v(`Not connected`),l.innerHTML=``;let t=c(`
    <section class="pin-entry">
      <div class="eyebrow">Controller link</div>
      <h1>Enter session PIN</h1>
      <p>The 4-digit PIN is shown on the main screen's pairing page.</p>
      <input class="pin-input mono" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" value="${n.replace(/\D/g,``).slice(0,4)}" />
      <p class="pin-error">${e}</p>
      <button class="btn primary join">Link controller</button>
    </section>`);l.appendChild(t);let r=t.querySelector(`.pin-input`),i=()=>{n=r.value.trim(),/^\d{4}$/.test(n)?m():t.querySelector(`.pin-error`).textContent=`Please enter 4 digits.`};t.querySelector(`.join`).addEventListener(`click`,i),r.addEventListener(`keydown`,e=>e.key===`Enter`&&i())}function v(e){u.dataset.s=`offline`,u.querySelector(`span`).textContent=e}var y={l:[0,0],r:[0,0]},b=!1,x=0;function S(e,t,n){y[e]=[C(t),C(n)],b=!0}var C=e=>Math.round(e*100)/100;function w(){let e=performance.now(),t=!y.l[0]&&!y.l[1]&&!y.r[0]&&!y.r[1];b&&(t||e-x>33)?(f({t:`axes`,l:y.l,r:y.r}),b=!1,x=e):!t&&e-x>250&&(f({t:`axes`,l:y.l,r:y.r}),x=e),requestAnimationFrame(w)}requestAnimationFrame(w);function T(e,t,n=!1){let r=e.querySelector(`.knob`),i=null,a=0,o=0,s=1,c=t=>{if(i!==null)return;i=t.pointerId,e.setPointerCapture(i);let c=e.getBoundingClientRect();s=(n?Math.min(c.width,c.height)*.28:c.width/2)||1,n?(a=t.clientX,o=t.clientY,r.style.left=`${a-c.left}px`,r.style.top=`${o-c.top}px`):(a=c.left+c.width/2,o=c.top+c.height/2),e.classList.add(`active`),l(t),g(8)},l=e=>{if(e.pointerId!==i)return;let c=(e.clientX-a)/s,l=(e.clientY-o)/s,u=Math.hypot(c,l);u>1&&(c/=u,l/=u);let d=.08,f=Math.hypot(c,l),p=f<d?0:(f-d)/.92/(f||1);S(t,c*p,-l*p),r.style.transform=`translate(calc(-50% + ${c*s*(n?1:.62)}px), calc(-50% + ${l*s*(n?1:.62)}px))`},u=n=>{n.pointerId===i&&(i=null,e.classList.remove(`active`),S(t,0,0),r.style.transform=`translate(-50%, -50%)`)};e.addEventListener(`pointerdown`,c),e.addEventListener(`pointermove`,l),e.addEventListener(`pointerup`,u),e.addEventListener(`pointercancel`,u)}function E(e,t){let n=!1,r=r=>{r.preventDefault(),e.classList.contains(`disabled`)||(n=!0,e.setPointerCapture(r.pointerId),e.classList.add(`pressed`),f({t:`btn`,id:t,down:!0}),g(15))},i=()=>{n&&(n=!1,e.classList.remove(`pressed`),f({t:`btn`,id:t,down:!1}))};e.addEventListener(`pointerdown`,r),e.addEventListener(`pointerup`,i),e.addEventListener(`pointercancel`,i)}function D(e,t){let n=0;e.addEventListener(`input`,()=>{let r=performance.now();r-n<40||(n=r,f({t:`val`,id:t,v:Number(e.value)}))}),e.addEventListener(`change`,()=>f({t:`val`,id:t,v:Number(e.value)})),e.addEventListener(`pointerdown`,()=>e.classList.add(`dragging`)),e.addEventListener(`pointerup`,()=>e.classList.remove(`dragging`))}function O(e,t,n=``,r,i){if(o=e,s={},y.l=[0,0],y.r=[0,0],b=!0,l.innerHTML=``,l.dataset.layout=e,d.hidden=a,e===`lobby`){let e=c(`
      <section class="lobby">
        <div class="lobby-icon"><span></span></div>
        <h1>${t}</h1>
        <p>${n}</p>
        <div class="lobby-missions"></div>
        ${i?`<button class="m-tile cta"><span class="mono">READY</span><b>${i}</b></button>`:``}
        <button class="btn ghost skip">Skip commander line ›</button>
      </section>`),a=e.querySelector(`.lobby-missions`);for(let e of r??[]){let t=c(`<button class="m-tile ${e.enabled?``:`locked`}"><span class="mono">MISSION ${e.code}</span><b>${e.title}</b>${e.enabled?``:`<em>In development</em>`}</button>`);e.enabled&&t.addEventListener(`click`,()=>{g(20),f({t:`tap`,id:`mission:${e.id}`})}),a.appendChild(t)}e.querySelector(`.skip`).addEventListener(`click`,()=>f({t:`tap`,id:`skip`})),e.querySelector(`.cta`)?.addEventListener(`click`,()=>{g(30),f({t:`tap`,id:`confirm`})}),l.appendChild(e)}else if(e===`jupiter`){let e=c(`
      <section class="pad-layout">
        <div class="hud-strip mono"><span class="objective">${t}</span><button class="mini skip">Skip ›</button></div>
        <div class="touchpad joy floating"><div class="knob"></div><div class="pad-hint">Drag to point the telescope</div><div class="pad-grid"></div></div>
        <div class="side">
          <div class="zoom-row">
            <button class="round zoom-out">−</button>
            <span class="mono label">ZOOM</span>
            <button class="round zoom-in">+</button>
          </div>
          <label class="sl"><span class="mono">FOCUS</span><input type="range" min="0" max="1" step="0.005" value="0.5" class="focus"></label>
          <label class="sl"><span class="mono">EXPOSURE</span><input type="range" min="0" max="1" step="0.01" value="0.5" class="exposure"></label>
          <button class="capture"><span>CAPTURE</span></button>
        </div>
      </section>`);T(e.querySelector(`.touchpad`),`l`,!0),E(e.querySelector(`.zoom-in`),`zoomIn`),E(e.querySelector(`.zoom-out`),`zoomOut`),E(e.querySelector(`.capture`),`primary`),D(e.querySelector(`.focus`),`focus`),D(e.querySelector(`.exposure`),`exposure`),e.querySelector(`.skip`).addEventListener(`click`,()=>f({t:`tap`,id:`skip`})),l.appendChild(e)}else if(e===`mars`){let e=c(`
      <section class="drive-layout">
        <div class="hud-strip mono">
          <span class="objective">${t}</span>
          <span class="timer" hidden></span>
          <span class="batt"><i><b></b></i><em>100%</em></span>
          <button class="mini skip">Skip ›</button>
        </div>
        <div class="joy fixed left"><div class="ring"></div><div class="knob"></div><span class="joy-label mono">DRIVE</span></div>
        <div class="center">
          <div class="compass"><div class="arrow"></div><span class="dist mono">-</span></div>
          <button class="interact disabled"><span class="label">INTERACT</span></button>
          <button class="mini view-btn">VIEW · MASTCAM</button>
        </div>
        <div class="joy fixed right"><div class="ring"></div><div class="knob"></div><span class="joy-label mono">CAMERA</span></div>
      </section>`);T(e.querySelector(`.joy.left`),`l`),T(e.querySelector(`.joy.right`),`r`),E(e.querySelector(`.interact`),`interact`),e.querySelector(`.view-btn`).addEventListener(`click`,()=>{g(10),f({t:`tap`,id:`view`})}),e.querySelector(`.skip`).addEventListener(`click`,()=>f({t:`tap`,id:`skip`})),l.appendChild(e)}else if(e===`iss`){let e=c(`
      <section class="iss-layout">
        <div class="hud-strip mono"><span class="objective">${t}</span><button class="mini skip">Skip ›</button></div>
        <div class="iss-q"></div>
        <div class="iss-choices"></div>
        <div class="touchpad joy floating look"><div class="knob"></div><div class="pad-hint">Drag to look around</div></div>
      </section>`);T(e.querySelector(`.touchpad`),`r`,!0),e.querySelector(`.skip`).addEventListener(`click`,()=>f({t:`tap`,id:`skip`})),l.appendChild(e)}else l.appendChild(c(`<section class="lobby"><h1>${t}</h1><p>${n}</p></section>`))}var k=``;function A(){let e=l.querySelector(`.objective`);if(e&&s.objective&&(e.textContent=s.objective),l.classList.toggle(`alert`,!!s.alert),o===`jupiter`&&s.vals)for(let[e,t]of Object.entries(s.vals)){let n=l.querySelector(`.${e}`);n&&!n.classList.contains(`dragging`)&&(n.value=String(t))}if(o===`iss`){let e=l.querySelector(`.iss-choices`),t=JSON.stringify(s.choices??null);t!==k&&(k=t,e.innerHTML=``,(s.choices??[]).forEach((t,n)=>{let r=t.startsWith(`✕ `),i=c(`<button class="m-tile choice${r?` bad`:``}"${r?` disabled`:``}><span class="mono">OPTION ${n+1}</span><b></b></button>`);i.querySelector(`b`).textContent=r?t.slice(2):t,r||i.addEventListener(`click`,()=>{g(20),f({t:`tap`,id:`choice:${n+1}`})}),e.appendChild(i)}),e.classList.toggle(`empty`,!(s.choices??[]).length));let n=l.querySelector(`.iss-q`);n.textContent=s.choices?.length?s.prompt??``:``,n.hidden=!n.textContent}if(o===`mars`){let e=l.querySelector(`.batt`);e&&s.battery!==void 0&&(e.querySelector(`b`).style.width=`${Math.round(s.battery*100)}%`,e.querySelector(`em`).textContent=`${Math.round(s.battery*100)}%`,e.classList.toggle(`low`,s.battery<.25));let t=l.querySelector(`.timer`);t.hidden=s.timer==null,s.timer!=null&&(t.textContent=`${Math.floor(s.timer/60)}:${String(Math.floor(s.timer%60)).padStart(2,`0`)}`);let n=l.querySelector(`.compass`);n.classList.toggle(`off`,s.bearing==null),s.bearing!=null&&(n.querySelector(`.arrow`).style.transform=`rotate(${s.bearing}rad)`),n.querySelector(`.dist`).textContent=s.distance==null?`-`:`${Math.round(s.distance)} m`;let r=l.querySelector(`.interact`);r.classList.toggle(`disabled`,!s.prompt),r.querySelector(`.label`).textContent=s.prompt??`INTERACT`}}m();