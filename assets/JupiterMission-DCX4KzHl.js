import{t as e}from"./objectiveIntro-BdfHY5DR.js";import{D as t,Gn as n,Lt as r,St as i,Tt as a,Wn as o,Xn as s,a as c,c as l,gr as u,hr as d,i as f,l as p,n as m,s as h,t as g,u as _}from"./dom-Cn_XVGn4.js";var v=71492,y=[{key:`io`,name:`Io`,radiusKm:1821.6,orbitRj:5.9,periodH:42.46,phase0:150,tint:[1,1,1]},{key:`europa`,name:`Europa`,radiusKm:1560.8,orbitRj:9.4,periodH:85.23,phase0:-80,tint:[-1,0,0]},{key:`ganymede`,name:`Ganymede`,radiusKm:2634.1,orbitRj:15,periodH:171.7,phase0:60,tint:[1,1,1]},{key:`callisto`,name:`Callisto`,radiusKm:2410.3,orbitRj:26.3,periodH:400.5,phase0:-110,tint:[1,1,1]}],b={u:.364,v:.606},x=.115,S=.05,C=new d(30,13),w=new u(-.16,.04,1).normalize(),T=(e,t,r)=>new n({uniforms:{map:{value:e},hasMap:{value:+!!e},tint:{value:new u(...t)},sunDir:{value:w},limbPower:{value:r}},vertexShader:`
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
      }`,fragmentShader:`
      uniform sampler2D map; uniform float hasMap; uniform vec3 tint; uniform vec3 sunDir; uniform float limbPower;
      varying vec2 vUv; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN);
        vec3 base = hasMap > 0.5 ? texture2D(map, vUv).rgb : vec3(0.75, 0.65, 0.5);
        // tint.x < 0 marks a greyscale map that gets two-tone colouring (Europa: bright ice, red-brown lineae)
        if (tint.x < 0.0) { float l = dot(base, vec3(0.333)); base = mix(vec3(0.30, 0.16, 0.09), vec3(0.92, 0.89, 0.84), smoothstep(0.05, 0.75, l)); }
        else base *= tint; // sRGB textures are decoded to linear by the GPU
        float ndl = max(dot(n, sunDir), 0.0);
        float mu = max(n.z, 0.0);              // towards the observer (camera looks down -z)
        float limb = pow(mu, limbPower);         // limb darkening
        gl_FragColor = vec4(base * (0.02 + 1.15 * ndl) * mix(0.55, 1.0, limb), 1.0);
      }`}),E={uniforms:{tDiffuse:{value:null},resolution:{value:new d(1,1)},blur:{value:0},gain:{value:1},noise:{value:.02},time:{value:0},boot:{value:1},zoomVel:{value:0},panVel:{value:new d},flash:{value:0},breathe:{value:0}},vertexShader:`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,fragmentShader:`
    uniform sampler2D tDiffuse; uniform vec2 resolution; uniform float blur; uniform float gain;
    uniform float noise; uniform float time; uniform float boot;
    uniform float zoomVel; uniform vec2 panVel; uniform float flash; uniform float breathe;
    varying vec2 vUv;
    const vec2 DISK[16] = vec2[16](
      vec2(-0.94,-0.40), vec2(0.95,-0.77), vec2(-0.09,-0.93), vec2(0.34,0.29),
      vec2(-0.92,0.46), vec2(-0.82,0.15), vec2(0.97,0.76), vec2(0.44,-0.87),
      vec2(0.54,0.97), vec2(-0.26,-0.42), vec2(-0.27,0.53), vec2(0.79,0.19),
      vec2(-0.38,0.92), vec2(0.14,-0.18), vec2(-0.71,-0.71), vec2(0.0,0.0));
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    vec3 aces(vec3 x) { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    void main() {
      vec2 px = blur / resolution;
      // focus breathing: the image scale shifts a little as the focus moves
      vec2 uv = (vUv - 0.5) * (1.0 - breathe) + 0.5;
      vec3 c = vec3(0.0);
      float zv = clamp(zoomVel, -2.5, 2.5);
      bool moving = abs(zv) > 0.04 || dot(panVel, panVel) > 1e-6;
      if (moving) {
        // motion smear while the optics move: radial for zoom, directional for slewing,
        // with chromatic separation growing toward the edges of the field
        vec2 d = uv - 0.5;
        vec2 stepv = d * zv * 0.018 + panVel;
        for (int i = 0; i < 12; i++) {
          float t = float(i) / 11.0 - 0.5;
          vec2 o = stepv * t + DISK[i] * px;
          float ca = 1.0 + length(d) * abs(zv) * 0.02;
          c.r += texture2D(tDiffuse, 0.5 + (uv + o - 0.5) * ca).r;
          c.g += texture2D(tDiffuse, uv + o).g;
          c.b += texture2D(tDiffuse, 0.5 + (uv + o - 0.5) / ca).b;
        }
        c /= 12.0;
      } else if (blur < 0.4) {
        c = texture2D(tDiffuse, uv).rgb;
      } else {
        // slight colour fringing grows with defocus, like real optics
        for (int i = 0; i < 16; i++) {
          vec2 o = DISK[i] * px;
          c.r += texture2D(tDiffuse, uv + o * 1.04).r;
          c.g += texture2D(tDiffuse, uv + o).g;
          c.b += texture2D(tDiffuse, uv + o * 0.96).b;
        }
        c /= 16.0;
      }
      c *= gain;
      // overexposure: clipped highlights bleed into a soft sensor bloom
      float over = max(0.0, gain - 1.6);
      if (over > 0.0) {
        vec3 b = vec3(0.0);
        for (int i = 0; i < 8; i++) b += texture2D(tDiffuse, uv + DISK[i * 2] * 9.0 / resolution).rgb;
        c += max(b / 8.0 * gain - 1.0, 0.0) * min(over, 2.0) * 0.35;
      }
      c = aces(c * 1.6);
      // sensor read noise: stronger when underexposed
      float g = hash(vUv * resolution + fract(time) * 100.0) - 0.5;
      c += g * noise;
      // vignette + faint row banding from the readout
      vec2 d = vUv - 0.5;
      c *= 1.0 - dot(d, d) * 0.55;
      c *= 0.985 + 0.015 * sin(vUv.y * resolution.y * 1.2);
      // boot flicker
      c *= mix(1.0, step(0.5, hash(vec2(floor(time * 30.0), 1.0))) * 0.6 + 0.4, boot);
      // capture: shutter flash, then a readout sweep down the frame
      if (flash > 0.0) {
        c += vec3(0.75, 0.85, 1.0) * pow(flash, 3.0) * 0.6;
        float sweep = 1.0 - flash;
        c += vec3(0.3, 0.8, 1.0) * smoothstep(0.012, 0.0, abs(1.0 - vUv.y - sweep)) * flash * 0.8;
      }
      c = pow(max(c, 0.0), vec3(1.0 / 2.2));
      gl_FragColor = vec4(c, 1.0);
    }`},D=class{scene=new o;camera=new r(-1,1,1,-1,.1,200);composer;scope;jupiter;moons=[];aspect=16/9;center=new d(5.5,2.6);centerTarget=this.center.clone();fieldH=9;fieldTarget=9;focus=.18;exposure=.5;timeScale=1;paused=!1;bootT=1;zoomRate=0;slewRate=0;focusRate=0;lastFocus=.18;panVel=new d;breathe=0;flashT=0;elapsed=0;pendingCapture=null;constructor(e,n){this.scene.background=new t(0),this.camera.position.set(0,0,100),this.jupiter=new a(new s(1,128,96),T(e.textures.jupiter??null,[1,1,1],.45)),this.jupiter.scale.set(1,.935,1),this.jupiter.rotation.y=-1.25,this.scene.add(this.jupiter);for(let t of y){let n=t.radiusKm/v,r=new a(new s(n,48,32),T(e.textures[t.key]??null,t.tint,.25));this.scene.add(r),this.moons.push({def:t,mesh:r,phase:i.degToRad(t.phase0)})}this.composer=new p(n),this.composer.addPass(new l(this.scene,this.camera)),this.scope=new _(E),this.composer.addPass(this.scope),this.update(0)}bestFocus(e=this.fieldH){return .5+.22*Math.sin(Math.log(e)*1.7+.6)}focusError(){return Math.abs(this.focus-this.bestFocus())}gain(){return 2**((this.exposure-.5)*5)}exposureSeconds(){return .35*this.gain()}fieldArcsec(){return this.fieldH*22.4}pan(e,t){this.centerTarget.x=i.clamp(this.centerTarget.x+e,-C.x,C.x),this.centerTarget.y=i.clamp(this.centerTarget.y+t,-C.y,C.y)}zoomBy(e){this.fieldTarget=i.clamp(this.fieldTarget*e,S,24)}grsAngle(){return Math.atan2(this.grsNormal().x,this.grsNormal().z)}grsNormal(){let e=b.u*Math.PI*2,t=b.v*Math.PI;return new u(-Math.cos(e)*Math.sin(t),Math.cos(t),Math.sin(e)*Math.sin(t)).applyQuaternion(this.jupiter.quaternion).normalize()}grs(){let e=this.grsNormal();return{key:`grs`,name:`Great Red Spot`,pos:e.clone().multiply(this.jupiter.scale),radius:x*Math.max(e.z,.2),visible:e.z>.25}}body(e){if(e===`jupiter`)return{key:e,name:`Jupiter`,pos:new u,radius:1,visible:!0};let t=this.moons.find(t=>t.def.key===e),n=t.mesh.position,r=n.z<0&&Math.hypot(n.x,n.y/.935)<1+t.def.radiusKm/71492;return{key:e,name:t.def.name,pos:n.clone(),radius:t.def.radiusKm/v,visible:!r}}bodiesInView(){let e=this.fieldH*this.aspect/2,t=this.fieldH/2;return[`jupiter`,...y.map(e=>e.key)].map(e=>this.body(e)).filter(n=>n.visible&&Math.abs(n.pos.x-this.center.x)<e&&Math.abs(n.pos.y-this.center.y)<t)}toScreen(e){return{x:.5+(e.x-this.center.x)/(this.fieldH*this.aspect),y:.5-(e.y-this.center.y)/this.fieldH}}capture(){return new Promise(e=>this.pendingCapture=e)}update(e){if(!this.paused){let t=e*238*this.timeScale;this.jupiter.rotation.y+=t/35730*Math.PI*2;for(let e of this.moons)e.phase+=t/(e.def.periodH*3600)*Math.PI*2,e.mesh.position.set(Math.sin(e.phase)*e.def.orbitRj,0,Math.cos(e.phase)*e.def.orbitRj),e.mesh.rotation.y=e.phase}this.elapsed+=e;let t=1-Math.exp(-e*7),n=this.center.x,r=this.center.y,a=this.fieldH;if(this.center.lerp(this.centerTarget,t),this.fieldH+=(this.fieldTarget-this.fieldH)*(1-Math.exp(-e*8)),this.bootT=Math.max(0,this.bootT-e*1.4),e>0){let t=Math.log(this.fieldH/a)/e;this.zoomRate+=(t-this.zoomRate)*Math.min(1,e*20);let o=(this.center.x-n)/(this.fieldH*this.aspect),s=(this.center.y-r)/this.fieldH;this.slewRate=Math.hypot(o,s)/e,this.panVel.set(-o,s).multiplyScalar(.9);let c=(this.focus-this.lastFocus)/e;this.focusRate+=(c-this.focusRate)*Math.min(1,e*14),this.lastFocus=this.focus,this.breathe+=(i.clamp(this.focusRate*.012,-.02,.02)-this.breathe)*Math.min(1,e*6),this.flashT=Math.max(0,this.flashT-e*1.8)}let o=this.fieldH/2,s=o*this.aspect;this.camera.left=this.center.x-s,this.camera.right=this.center.x+s,this.camera.top=this.center.y+o,this.camera.bottom=this.center.y-o,this.camera.updateProjectionMatrix();let c=this.scope.uniforms;c.blur.value=Math.min(16,this.focusError()*110),c.gain.value=this.gain(),c.noise.value=.018+Math.max(0,.5-this.exposure)*.12,c.time.value=this.elapsed,c.boot.value=this.bootT,c.zoomVel.value=Math.abs(this.zoomRate)>.04?this.zoomRate:0,c.panVel.value.copy(this.panVel),this.panVel.lengthSq()<4e-6&&c.panVel.value.set(0,0),c.breathe.value=this.breathe,c.flash.value=this.flashT}flash(){this.flashT=1}render(e){if(this.composer.render(),this.pendingCapture){let t=this.pendingCapture;this.pendingCapture=null,t(e.domElement.toDataURL(`image/jpeg`,.88))}}resize(e,t){this.aspect=e/t,this.composer.setPixelRatio(this.composer.renderer.getPixelRatio()),this.composer.setSize(e,t),this.scope.uniforms.resolution.value.set(e,t)}dispose(){this.composer.dispose(),this.scene.traverse(e=>{let t=e;t.isMesh&&(t.geometry.dispose(),t.material.dispose())})}},O=[[`Launched`,`24 April 1990`],[`Primary mirror`,`2.4 m`],[`Orbit`,`≈ 500 km above Earth`],[`Instrument`,`Wide Field Camera 3`]],k=e=>[`Welcome to the Deep Space Observatory. Today we will observe Jupiter with the Hubble Space Telescope. I will handle the guidance; you take the pictures.`,`Hubble launched in 1990. Orbiting above our atmosphere, its 2.4 metre mirror sees without the blur that limits telescopes on the ground.`,e===`phone`?`Drag on your phone’s touch pad to point the telescope. Use the zoom buttons and the focus slider, then press capture.`:`Drag with the mouse or use W A S D to point the telescope. Scroll to zoom, Z and X to focus, and Space to capture.`],A=[{id:`disk`,code:`A`,title:`Full planetary observation`,short:`Frame Jupiter’s entire disk`,start:`Objective one: frame Jupiter’s entire disk. Centre the planet, zoom until it fills the brackets, then sharpen the focus.`,success:[`Observation confirmed. Jupiter is the largest planet in our solar system, about eleven times wider than Earth.`,`Those coloured bands are clouds of ammonia and water, stretched around the planet by powerful east and west winds.`],caption:`Jupiter · full disk`},{id:`grs`,code:`B`,title:`Great Red Spot observation`,short:`Centre and capture the Great Red Spot`,start:`Objective two: the Great Red Spot, in the southern hemisphere. A day on Jupiter lasts only about ten hours, so track the storm as it rotates into view.`,success:[`Great Red Spot captured. This storm is wider than Earth, and astronomers have watched it for more than 150 years.`,`Hubble has measured it shrinking over the decades. Watching how it changes is one reason Hubble returns to Jupiter every year.`],caption:`Great Red Spot`},{id:`europa`,code:`C`,title:`Jupiter moon observation`,short:`Find and capture Europa`,start:`Final objective: Europa, one of the four large moons Galileo discovered in 1610. Zoom out and look to the left of Jupiter: Europa is the nearest moon on that side.`,success:[`Europa acquired. Beneath its icy shell, scientists think there is a salty ocean holding about twice as much water as all of Earth’s oceans.`,`NASA’s Europa Clipper launched in 2024 to investigate whether that ocean could support life.`],caption:`Europa`}],j={noTarget:`The target is not in the frame. Pan the telescope toward it.`,offCentre:`Almost. Centre the target in the frame, then capture.`,tooSmall:`The target is too small. Zoom in.`,tooLarge:`Too close. Zoom out until the whole target fits the brackets.`,focus:`The image is soft. Adjust the focus until the fine detail sharpens.`,over:`Overexposed: the bright clouds are clipping. Lower the exposure.`,under:`Too dark. Raise the exposure.`,grsHidden:`The Great Red Spot is on the far side. Wait for Jupiter’s rotation to bring it around.`,refocus:`Zooming shifts the focus. Re-focus after every zoom.`,ambient:`Every year Hubble’s OPAL programme maps Jupiter, building a long-term record of its changing weather.`},M=`Target locked. Ready when you are.`,N=[`All three observations are complete. Excellent work, Operator.`,`Scientists combine images like these over many years to track how Jupiter’s atmosphere changes.`],P={title:`Seen in infrared: James Webb Space Telescope`,text:`In 2022, NASA’s James Webb Space Telescope imaged Jupiter in infrared light, revealing glowing auroras at its poles and its faint rings. Webb orbits the Sun about 1.5 million km from Earth. It observes Jupiter from there, not from Jupiter itself.`},F={disk:{name:`Jupiter`,rows:[[`Equatorial diameter`,`142,984 km`],[`Day length`,`≈ 9.9 hours`],[`Mass`,`> 2× all other planets combined`],[`Type`,`Gas giant`]]},grs:{name:`Great Red Spot`,rows:[[`Location`,`Southern hemisphere, ≈ 22° S`],[`Size`,`Wider than Earth`],[`Observed`,`Since at least the 1830s`],[`Trend`,`Shrinking (Hubble)`]]},europa:{name:`Europa`,rows:[[`Diameter`,`3,122 km`],[`Distance from Jupiter`,`≈ 671,000 km`],[`Orbit`,`3.55 days`],[`Surface`,`Water ice`]]}},I=class{app;stage=null;hud=null;paused=!1;disposers=[];objectiveIndex=0;captures=[];busy=!1;wasReady=!1;objectiveStart=0;lastHintAt=0;saidAmbient=!1;saidRefocus=!1;saidLocked=!1;lastField=0;finish;briefingOff;constructor(e){this.app=e}disposed=!1;start(){let e=new Promise(e=>this.finish=e);return this.flow(),e}async flow(){let e=await this.briefing();if(!this.disposed){if(!e)return this.finish({to:`select`});await this.bootTelescope(),this.disposed||this.runObjectives()}}abort(e){this.finish(e)}setPaused(e){this.paused=e,this.stage&&(this.stage.paused=e),e&&this.app.sfx.scopeMotors(0,0,0)}dispose(){this.disposed=!0,this.briefingOff?.(),this.disposers.forEach(e=>e()),this.disposers=[],this.app.sfx.stopLoops(),this.hud?.remove(),this.hud=null,this.app.space.showModel(null),this.stage&&=(this.stage.dispose(),null)}briefing(){let{app:e}=this;e.engine.setStage(e.space),e.space.setShot(`briefing`,.7);let t=e.assets.models.hubble?.scene;e.space.showModel(t?t.clone(!0):null,4.6),e.link.send({t:`layout`,layout:`lobby`,title:`Mission 01 · Briefing`,subtitle:`Tap Begin when you are ready`,cta:`Begin mission`});let n=O.map(([e,t])=>`<div><span>${e}</span><b>${t}</b></div>`).join(``),r=A.map(e=>`<li><span class="mono">${e.code}</span>${f(e.title)}</li>`).join(``),i=c(`
      <section class="briefing">
        <div class="brief-panel panel brackets fade-up">
          <div class="eyebrow">Mission 01 · Briefing</div>
          <h2>Deep Space Observatory</h2>
          <p class="brief-lead">Operate the <b>Hubble Space Telescope</b> to make three observations of Jupiter, the largest planet in the solar system.</p>
          <div class="brief-specs mono">${n}</div>
          <h4 class="mono">Objectives</h4>
          <ol class="brief-objs">${r}</ol>
          <div class="brief-actions">
            <button class="btn primary go">Begin observation <span class="kbd">ENTER</span></button>
            <button class="btn ghost abort">Abort</button>
          </div>
          <p class="brief-note">Hubble model: NASA 3D Resources · Jupiter imagery: NASA/JPL/Space Science Institute (Cassini)</p>
        </div>
        <div class="brief-caption mono fade-up" style="animation-delay:.4s">HUBBLE SPACE TELESCOPE · LOW EARTH ORBIT</div>
      </section>`);return e.screens.show(i),e.commander.say(k(e.mode),{interrupt:!0}),new Promise(t=>{let n=n=>{r(),e.commander.clear(),e.sfx[n?`confirm`:`back`](),t(n)};g(i,`.go`).addEventListener(`click`,()=>n(!0)),g(i,`.abort`).addEventListener(`click`,()=>n(!1));let r=e.input.onPress(e=>{this.paused||e!==`confirm`&&e!==`primary`||n(!0)});this.briefingOff=r})}async bootTelescope(){let{app:t}=this,n=c(`
      <section class="scope-boot">
        <div class="boot-lines mono"></div>
      </section>`);t.screens.show(n),t.space.setShot(`depart`,.9);let r=[`SLEWING TO TARGET · JUPITER`,`FINE GUIDANCE SENSORS · GUIDE STARS ACQUIRED`,`WIDE FIELD CAMERA 3 · UVIS CHANNEL READY`,`OPENING SHUTTER`],i=g(n,`.boot-lines`);t.sfx.riser(1.8);for(let e of r)i.appendChild(c(`<div class="fade-up">› ${e}</div>`)),t.sfx.blip(),await h(380);t.sfx.shutter(),await h(250),t.space.showModel(null),this.stage=new D(t.assets,t.engine.renderer),this.stage.resize(window.innerWidth,window.innerHeight),t.engine.setStage(this.stage),t.sfx.setAmbience(`space`),t.sfx.setMusic(`jupiter`),t.input.pointerEnabled=!0,this.lastField=this.stage.fieldH,this.hud=this.buildHud(),await t.screens.show(this.hud),t.link.send({t:`layout`,layout:`jupiter`,title:`Point · zoom · focus · capture`}),this.syncPhone(),await e(t.ui,t.input,t.sfx,{eyebrow:`Mission 01 · Jupiter`,title:`Observe the giant planet`,accent:`#f2b56b`,accent2:`#4f7dff`,objectives:[{title:A[0].title,sub:`Centre Jupiter, zoom until it fills the brackets, sharpen the focus`,icon:`target`},{title:A[1].title,sub:`Track the storm as it rotates into view`,icon:`storm`},{title:A[2].title,sub:`Find Europa, the nearest moon on Jupiter’s left`,icon:`moon`}],footer:t.mode===`device`?`Drag/WASD point  ·  Wheel zoom  ·  Z X focus  ·  Space capture`:`Use the phone to point, zoom, focus and capture`,target:()=>this.hud?.querySelector(`.jh-obj`)??null}),this.disposed||this.disposers.push(t.engine.onTick(e=>this.tick(e)),t.input.onPress(e=>{this.paused||e===`primary`&&this.tryCapture()}),t.input.onValue((e,t)=>{this.stage&&!this.paused&&(e===`focus`&&(this.stage.focus=t),e===`exposure`&&(this.stage.exposure=t))}),()=>t.input.pointerEnabled=!1)}pauseInfo(){let e=A[Math.min(this.objectiveIndex,A.length-1)];return{objective:this.objectiveIndex>=A.length?`Observations complete`:`${e.code} · ${e.short}`,fact:e.success[e.success.length-1]}}get objective(){return A[this.objectiveIndex]}async runObjectives(){this.app.commander.clear(),this.beginObjective(0)}beginObjective(e){this.objectiveIndex=e,this.objectiveStart=performance.now(),this.wasReady=!1,this.paintObjective(),e>0&&this.app.sfx.objective(),this.app.commander.say(this.objective.start)}evaluate(){let e=this.stage,t=this.objective.id,n=e.fieldH,r=!1,i=!1,a=!1,o=j.tooSmall,s=``,c=(t,r)=>Math.hypot(t.x-e.center.x,t.y-e.center.y)/n<=r,l=t=>Math.abs(t.x-e.center.x)<n*(window.innerWidth/window.innerHeight)/2&&Math.abs(t.y-e.center.y)<n/2;if(t===`disk`){let t=e.body(`jupiter`);r=l(t.pos)||Math.hypot(t.pos.x-e.center.x,t.pos.y-e.center.y)<1;let s=1.87/n;a=s>=.55&&s<=.98,o=s<.55?j.tooSmall:j.tooLarge,i=c(t.pos,.09)}else if(t===`grs`){let t=e.grs();r=t.visible&&l(t.pos),t.visible||(s=j.grsHidden),a=n>=.38&&n<=1.6,o=n>1.6?j.tooSmall:j.tooLarge,i=c(t.pos,.11)}else{let t=e.body(`europa`);r=t.visible&&l(t.pos);let s=2*t.radius/n;a=s>=.12&&s<=.85,o=s<.12?j.tooSmall:j.tooLarge,i=c(t.pos,.11)}let u=e.focusError()<.045,d=e.exposure>=.36&&e.exposure<=.66,f={target:r,centred:r&&i,size:a,focus:u,exposure:d},p=s||(r?a?i?u?d?``:e.exposure>.66?j.over:j.under:j.focus:j.offCentre:o:j.noTarget);return{checks:f,ready:Object.values(f).every(Boolean),hint:p}}async tryCapture(){let e=this.stage;if(!e||this.busy||this.objectiveIndex>=A.length)return;this.busy=!0;let t=this.evaluate();this.app.sfx.shutter(),this.flash();let n=await e.capture();if(e.flash(),!t.ready){this.app.sfx.error(),this.showCard(n,`Capture rejected`,t.hint,!1),this.app.commander.say(t.hint,{interrupt:!0}),this.lastHintAt=performance.now(),await h(1600),this.busy=!1;return}let r=this.objective;this.captures.push({id:r.id,url:n}),this.app.sfx.success(),this.app.link.buzz([40,60,40]),this.showCard(n,`Observation ${this.captures.length} confirmed`,r.caption,!0),this.addToGallery(n,r.caption),this.paintProgress(),e.timeScale=1;let i=this.app.commander.say(r.success,{interrupt:!0});if(this.objectiveIndex+1<A.length){if(await h(1400),this.disposed)return;this.beginObjective(this.objectiveIndex+1),this.busy=!1}else{if(this.objectiveIndex=A.length,this.paintProgress(),await i,await this.app.commander.say(N),this.disposed)return;this.showReport()}}tick(e){let t=this.stage;if(!t||!this.hud||this.paused)return;let{input:n}=this.app,r=window.innerHeight;this.app.sfx.scopeMotors(Math.min(1,Math.abs(t.zoomRate)/1.4),Math.min(1,t.slewRate*2.5),Math.min(1,Math.abs(t.focusRate)*5)),this.hud.style.setProperty(`--zoomv`,Math.min(1,Math.abs(t.zoomRate)/1.4).toFixed(3));let a=n.stickL(),o=n.stickR(),s=t.fieldH*.75*e;t.pan((a.x+o.x)*s,(a.y+o.y)*s);let c=n.consumeMouse();(c.dx||c.dy)&&t.pan(-c.dx/r*t.fieldH,c.dy/r*t.fieldH),c.wheel&&t.zoomBy(1.18**c.wheel),n.held(`zoomIn`,`KeyE`)&&t.zoomBy(Math.exp(-e*1.5)),n.held(`zoomOut`,`KeyQ`)&&t.zoomBy(Math.exp(e*1.5));let l=!1;if(n.key(`KeyZ`)&&(t.focus=Math.max(0,t.focus-e*.25),l=!0),n.key(`KeyX`)&&(t.focus=Math.min(1,t.focus+e*.25),l=!0),n.key(`KeyC`)&&(t.exposure=Math.max(0,t.exposure-e*.35),l=!0),n.key(`KeyV`)&&(t.exposure=Math.min(1,t.exposure+e*.35),l=!0),l&&this.syncPhone(),this.objectiveIndex>=A.length)return this.paintMeters();if(this.objective.id===`grs`){let e=i.radToDeg(t.grsAngle());t.timeScale===1&&(e>62||e<-115)?t.timeScale=9:t.timeScale>1&&e>-70&&e<-45&&(t.timeScale=1)}else t.timeScale=1;let u=this.evaluate();u.ready&&!this.wasReady&&(this.app.sfx.lockOn(),this.app.link.buzz(25),this.hud.classList.remove(`lock-flash`),this.hud.offsetWidth,this.hud.classList.add(`lock-flash`),!this.saidLocked&&!this.app.commander.busy&&(this.saidLocked=!0,this.app.commander.say(M))),this.wasReady=u.ready,this.paintChecks(u),this.paintMeters(),this.paintLabels();let d=performance.now();!this.saidRefocus&&Math.abs(Math.log(t.fieldH/this.lastField))>.9&&t.focusError()>.08&&!this.app.commander.busy&&(this.saidRefocus=!0,this.app.commander.say(j.refocus)),!this.saidAmbient&&this.objective.id===`grs`&&d-this.objectiveStart>28e3&&!this.app.commander.busy&&(this.saidAmbient=!0,this.app.commander.say(j.ambient)),!this.busy&&!u.ready&&d-this.objectiveStart>4e4&&d-this.lastHintAt>22e3&&!this.app.commander.busy&&(this.lastHintAt=d,this.app.commander.say(u.hint)),t.focusError()<.045&&(this.lastField=t.fieldH),this.app.link.hud({objective:`${this.objective.code} · ${this.objective.short}`,vals:{focus:L(t.focus),exposure:L(t.exposure)}})}syncPhone(){let e=this.stage;e&&this.app.link.hud({vals:{focus:L(e.focus),exposure:L(e.exposure)}})}buildHud(){let e=this.app.mode===`device`,t=c(`
      <section class="jhud passthrough">
        <div class="scope-frame"><i class="tl"></i><i class="tr"></i><i class="bl"></i><i class="br"></i></div>
        <svg class="reticle" viewBox="-60 -60 120 120"><circle r="18" /><path d="M-56 0H-26M26 0H56M0 -56V-26M0 26V56" /><circle r="1.6" class="dot"/></svg>
        <div class="body-labels"></div>
        <div class="ready-tag mono">READY TO CAPTURE</div>

        <header class="jh-top">
          <div class="jh-inst">
            <div class="eyebrow">Hubble Space Telescope</div>
            <div class="jh-name">WFC3 · UVIS</div>
            <div class="jh-track mono"><i></i>Tracking · fine guidance lock</div>
          </div>
          <div class="jh-obj">
            <div class="mono jh-mission">MISSION 01 · DEEP SPACE OBSERVATORY</div>
            <div class="jh-obj-title"></div>
            <div class="chips mono">
              <span data-c="target">Target</span><span data-c="size">Size</span><span data-c="centred">Centred</span><span data-c="focus">Focus</span><span data-c="exposure">Exposure</span>
            </div>
          </div>
          <div class="jh-target panel"></div>
        </header>

        <aside class="jh-left panel mono">
          <div class="meter"><label>Zoom</label><div class="bar"><b class="zoom-b"></b></div><span class="zoom-v"></span></div>
          <div class="meter"><label>Field of view</label><span class="fov-v big"></span></div>
          <div class="meter"><label>Sharpness</label><div class="bar"><b class="sharp-b"></b></div><span class="sharp-v"></span></div>
          <div class="meter"><label>Focus position</label><div class="bar"><b class="focus-b"></b></div><span class="focus-v"></span></div>
          <div class="meter"><label>Exposure</label><div class="bar exp"><em></em><b class="exp-b"></b></div><span class="exp-v"></span></div>
          <div class="meter row"><label>Aperture</label><span>2.4 m · f/24</span></div>
          <div class="meter row"><label>Time-lapse</label><span class="tl-v"></span></div>
        </aside>

        <aside class="jh-right">
          <div class="panel jh-status mono">
            <div class="eyebrow">Instrument status</div>
            <div><span>Power</span><b class="ok">Nominal</b></div>
            <div><span>Pointing</span><b class="ok">Gyro (1-gyro mode)</b></div>
            <div><span>Detector</span><b class="ok">UVIS · 4096²</b></div>
            <div><span>Filters</span><b>Visible colour</b></div>
          </div>
          <div class="panel jh-progress">
            <div class="eyebrow">Observations</div>
            <ol class="mono"></ol>
          </div>
          <div class="jh-gallery"></div>
        </aside>

        ${e?`<footer class="jh-keys mono">
          <span><b class="kbd">Drag</b>/<b class="kbd">WASD</b> point</span>
          <span><b class="kbd">Wheel</b>/<b class="kbd">Q</b><b class="kbd">E</b> zoom</span>
          <span><b class="kbd">Z</b><b class="kbd">X</b> focus</span>
          <span><b class="kbd">C</b><b class="kbd">V</b> exposure</span>
          <span><b class="kbd">Space</b> capture</span>
          <span><b class="kbd">Esc</b> pause</span>
        </footer>`:``}
        <div class="shutter-flash"></div>
        <div class="capture-card panel"><img alt="" /><div><div class="cc-title mono"></div><div class="cc-sub"></div></div></div>
      </section>`);return this.hud=t,this.paintObjective(),this.paintProgress(),t}paintObjective(){if(!this.hud)return;let e=this.objective;g(this.hud,`.jh-obj-title`).textContent=`OBJ ${e.code} · ${e.title.toUpperCase()}`;let t=F[e.id];g(this.hud,`.jh-target`).innerHTML=`
      <div class="eyebrow">Target</div>
      <div class="jt-name">${t.name}</div>
      ${t.rows.map(([e,t])=>`<div class="jt-row"><span>${e}</span><b>${t}</b></div>`).join(``)}`,this.paintProgress()}paintProgress(){this.hud&&(g(this.hud,`.jh-progress ol`).innerHTML=A.map((e,t)=>{let n=this.captures.some(t=>t.id===e.id),r=t===this.objectiveIndex;return`<li class="${n?`done`:r?`active`:``}"><i></i><span>${e.code} · ${e.title}</span></li>`}).join(``))}paintChecks(e){let t=this.hud;for(let n of m(t,`.chips span`))n.classList.toggle(`ok`,e.checks[n.dataset.c]);t.classList.toggle(`ready`,e.ready)}paintMeters(){let e=this.stage,t=this.hud,n=Math.log(24/e.fieldH)/Math.log(480);g(t,`.zoom-b`).style.transform=`scaleX(${n.toFixed(3)})`,g(t,`.zoom-v`).textContent=`×${(24/e.fieldH).toFixed(1)}`;let r=e.fieldArcsec();g(t,`.fov-v`).textContent=r>=60?`${(r/60).toFixed(1)}′`:`${r.toFixed(1)}″`;let i=Math.max(0,1-e.focusError()*7);g(t,`.sharp-b`).style.transform=`scaleX(${i.toFixed(3)})`,g(t,`.sharp-v`).textContent=e.focusError()<.045?`IN FOCUS`:`${Math.round(i*100)}%`,g(t,`.focus-b`).style.transform=`scaleX(${e.focus.toFixed(3)})`,g(t,`.focus-v`).textContent=e.focus.toFixed(2),g(t,`.exp-b`).style.transform=`scaleX(${e.exposure.toFixed(3)})`;let a=e.exposureSeconds();g(t,`.exp-v`).textContent=`${a<1?a.toFixed(2):a.toFixed(1)} s${e.exposure>.66?` · OVER`:e.exposure<.36?` · UNDER`:``}`,g(t,`.tl-v`).textContent=`×${Math.round(238*e.timeScale).toLocaleString()}${e.timeScale>1?` ⏩`:``}`}paintLabels(){let e=this.stage,t=this.hud,n=g(t,`.body-labels`),r=e.bodiesInView();if(this.objective.id===`grs`){let t=e.grs();t.visible&&e.fieldH<4&&r.push(t)}n.innerHTML=r.map(t=>{let n=e.toScreen(t.pos),r=t.radius/e.fieldH*window.innerHeight;if(t.key===`jupiter`&&r>window.innerHeight*.3)return``;let i=Math.max(10,r)+8;return`<span class="blabel mono" style="left:${(n.x*100).toFixed(2)}%;top:calc(${(n.y*100).toFixed(2)}% - ${i.toFixed(0)}px)">${t.name}${t.key!==`jupiter`&&t.key!==`grs`?` <em>${Math.round(Math.hypot(t.pos.x,t.pos.z)*v/1e3).toLocaleString()}k km</em>`:``}</span>`}).join(``)}flash(){let e=g(this.hud,`.shutter-flash`);e.classList.remove(`go`),e.offsetWidth,e.classList.add(`go`)}showCard(e,t,n,r){let i=g(this.hud,`.capture-card`);g(i,`img`).src=e,g(i,`.cc-title`).textContent=t.toUpperCase(),g(i,`.cc-sub`).textContent=n,i.classList.toggle(`bad`,!r),i.classList.remove(`show`),i.offsetWidth,i.classList.add(`show`),clearTimeout(i._t),i._t=window.setTimeout(()=>i.classList.remove(`show`),r?4200:2400)}addToGallery(e,t){g(this.hud,`.jh-gallery`).appendChild(c(`<figure class="fade-up"><img src="${e}" alt="${f(t)}"><figcaption class="mono">${f(t)}</figcaption></figure>`))}showReport(){let{app:e}=this;e.input.pointerEnabled=!1,e.sfx.scopeMotors(0,0,0),e.sfx.setMusic(`triumph`),e.link.send({t:`layout`,layout:`lobby`,title:`Mission 01 complete`,subtitle:`Observation report on the main screen`});let t=this.captures.map((e,t)=>{let n=A.find(t=>t.id===e.id);return`<figure class="fade-up" style="animation-delay:${.15+t*.12}s"><img src="${e.url}" alt=""><figcaption><span class="mono">OBS ${t+1} · ${n.code}</span><b>${n.caption}</b><p>${f(n.success[0])}</p></figcaption></figure>`}).join(``),n=e.missionAvailable(`mars`),r=c(`
      <section class="report">
        <div class="report-inner">
          <div class="eyebrow">Mission 01 complete · Observation report</div>
          <h2>Deep Space Observatory</h2>
          <div class="report-figs">${t}</div>
          <div class="jwst panel"><div class="eyebrow">${P.title}</div><p>${P.text}</p></div>
          <p class="report-src mono">Simulated observation. Jupiter imagery: Cassini map (NASA/JPL/SSI) · moon maps: NASA/USGS · facts: science.nasa.gov</p>
          <div class="report-actions">
            ${n?`<button class="btn primary next">Next: Mars expedition →</button>`:``}
            <button class="btn ${n?``:`primary`} to-select">Mission select</button>
            <button class="btn ghost replay">Replay mission</button>
          </div>
        </div>
      </section>`);e.screens.show(r),e.sfx.success();let i=t=>{e.sfx.click(),this.finish(t)};r.querySelector(`.next`)?.addEventListener(`click`,()=>i({to:`mission`,id:`mars`})),g(r,`.to-select`).addEventListener(`click`,()=>i({to:`select`})),g(r,`.replay`).addEventListener(`click`,()=>i({to:`restart`}))}},L=e=>Math.round(e*1e3)/1e3;export{I as JupiterMission};