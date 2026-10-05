/* 視覺揭曉與抽樣分離：此檔只讀管理者取得的遮罩名單、不發 API、不決定得獎者。 */
(() => {
  let overlay=null, current=null, animation=0, previousFocus=null, previousOverflow='', mainWasInert=false;
  const reelAnimations=new Set();
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function element(tag,cls,text) { const el=document.createElement(tag); el.className=cls; if(text!==undefined) el.textContent=text; return el; }
  function close() {
    if(!overlay) return;
    current?.resolve(null);current=null;
    cancelAnimationFrame(animation); reelAnimations.forEach(a=>a.cancel()); reelAnimations.clear(); overlay.remove(); overlay=null;
    document.body.style.overflow=previousOverflow;
    const main=document.getElementById('main'); if(main) main.inert=mainWasInert;
    if(previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({preventScroll:true});
  }
  function start({eventName,prize,count,demo,candidates=[]}) {
    close(); previousFocus=document.activeElement;
    previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const main=document.getElementById('main'); mainWasInert=!!main?.inert; if(main) main.inert=true;
    overlay=element('section','draw-theater'); overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','抽獎揭曉'); overlay.tabIndex=-1;
    overlay.append(element('p','motion-event',eventName),element('p','motion-kicker',demo?'示範抽獎 · 虛構名單':'好運，即將揭曉'),element('h2','motion-prize',prize));
    const suspense=element('div','motion-suspense'),orbit=element('div','motion-orbit');
    orbit.append(element('i','motion-rays'),element('i','motion-ring'));
    for(let i=0;i<12;i++){const spark=element('i','motion-spark');spark.style.setProperty('--i',i);orbit.append(spark);}
    orbit.setAttribute('aria-hidden','true');orbit.append(element('div','motion-symbol','✦'));suspense.append(orbit);
    const caption=element('p','motion-caption','正在抽選 '+count+' 位幸運學員…');caption.setAttribute('role','status');
    overlay.append(suspense,caption,element('p','motion-bottom','下一份好運，會是誰？'));
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape' && overlay?.classList.contains('revealed')) {event.stopPropagation();close();}
      if(event.key==='Tab'){event.preventDefault();const focus=overlay?.querySelector('button') || overlay;focus?.focus();}
    });
    document.body.append(overlay);overlay.focus();
    const session={target:overlay,count,candidates};
    session.result=new Promise(resolve=>{session.resolve=resolve;});current=session;
    // run 會在第一次 await 前顯示 3；呼叫端同時送出抽獎，不等待動畫。
    session.done=run(session).catch(()=>{if(current===session)close();});
  }
  function confetti(target) {
    if(reduced()) return;
    cancelAnimationFrame(animation);target.querySelector('.motion-confetti')?.remove();
    const canvas=element('canvas','motion-confetti');canvas.setAttribute('aria-hidden','true');target.append(canvas);
    const ctx=canvas.getContext('2d');if(!ctx)return;
    const w=innerWidth,h=innerHeight,dpr=Math.min(devicePixelRatio || 1,2);
    canvas.width=w*dpr;canvas.height=h*dpr;ctx.scale(dpr,dpr);
    const colors=['#ffe6ab','#ddae5f','#fff4da','#bc91ce','#f2cba1'];
    const pieces=Array.from({length:w<600?90:160},(_,i)=>({x:w/2,y:h*.42,vx:(Math.random()-.5)*19,vy:-7-Math.random()*13,a:Math.random()*6,s:4+Math.random()*7,color:colors[i%colors.length]}));
    let before=performance.now();const begin=before;
    function frame(now){
      if(overlay!==target)return;
      const dt=Math.min((now-before)/16.67,2);before=now;
      ctx.clearRect(0,0,w,h);ctx.globalAlpha=Math.min(1,(4400-(now-begin))/900);
      pieces.forEach(p=>{p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=.24*dt;p.vx*=Math.pow(.99,dt);p.a+=.07*dt;ctx.save();ctx.translate(p.x,p.y);ctx.rotate(p.a);ctx.fillStyle=p.color;ctx.fillRect(-p.s/2,-p.s/4,p.s,p.s*.5);ctx.restore();});
      if(now-begin<4400)animation=requestAnimationFrame(frame);else canvas.remove();
    }
    animation=requestAnimationFrame(frame);
  }
  function validAnimation(draw) {
    const data=draw.animation;
    if(!data || data.requestId!==draw.requestId || !Array.isArray(data.candidates) || !Array.isArray(data.winners) || data.winners.length!==draw.winners.length) return false;
    const pool=new Map(data.candidates.map(p=>[p.key,p]));
    return pool.size===data.candidates.length && new Set(data.winners.map(p=>p.key)).size===data.winners.length && data.winners.every((p,i)=>{
      const candidate=pool.get(p.key),saved=draw.winners[i];
      return candidate && candidate.name===p.name && candidate.phoneTail===p.phoneTail && p.name===saved.name && p.phoneTail===saved.phoneTail;
    });
  }
  function nameRow(person) {
    const row=element('div','motion-name-row');row.dataset.key=person.key;
    row.append(element('strong','',person.name),element('small','','手機末三碼 '+person.phoneTail));return row;
  }
  function makeStage(target) {
    target.classList.add('spinning');
    const suspense=target.querySelector('.motion-suspense');suspense.replaceChildren();
    const stage=element('div','motion-name-stage'),order=element('p','motion-name-order');
    const viewport=element('div','motion-name-viewport'),track=element('div','motion-name-track'),frame=element('div','motion-selection');
    viewport.setAttribute('aria-hidden','true');viewport.append(track,frame);
    const tray=element('div','motion-awarded');tray.setAttribute('aria-label','本輪已揭曉');
    stage.append(order,viewport,tray);suspense.append(stage);
    target.querySelector('.motion-bottom').textContent='金色框內，下一位幸運學員。';
    return {target,order,viewport,track,tray};
  }
  function cancelReel(reel) {if(reel){reel.cancel();reelAnimations.delete(reel);}}
  function beginFast(stage,pool,index,count) {
    const {target,order,viewport,track}=stage;
    cancelAnimationFrame(animation);target.querySelector('.motion-confetti')?.remove();
    viewport.classList.toggle('sole',pool.length===1);viewport.classList.remove('locked');delete viewport.dataset.winnerKey;
    target.dataset.phase='fast';track.style.transform='translateY(0)';track.replaceChildren();
    order.textContent='第 '+(index+1)+' / '+count+' 位 · '+pool.length+' 人參與本次輪播';
    target.querySelector('.motion-caption').textContent='姓名輪播中…';
    const shuffled=pool.slice();
    for(let j=shuffled.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[shuffled[j],shuffled[k]]=[shuffled[k],shuffled[j]];}
    // 重複同一批真實遮罩姓名，接縫不跳動，長時間等待也不持續增加 DOM。
    const cycle=48,sequence=Array.from({length:cycle},(_,i)=>shuffled[i%shuffled.length]);
    sequence.push(...sequence.slice(0,3));track.append(...sequence.map(nameRow));
    const height=track.firstElementChild.getBoundingClientRect().height;
    const reel=pool.length>1?track.animate([{transform:'translateY(0)'},{transform:'translateY(-'+cycle*height+'px)'}],{duration:4000,iterations:Infinity,easing:'linear'}):null;
    if(reel)reelAnimations.add(reel);
    return {stage,pool,sequence,height,reel};
  }
  async function stopOn(fast,winner) {
    const {stage,pool,sequence,height,reel}=fast,{target,viewport,track}=stage;
    // 從快轉的當下位置接上減速；不跳回起點，也不提前顯示尚未保存的得獎者。
    const offset=reel?Math.max(0,-new DOMMatrixReadOnly(getComputedStyle(track).transform).m42):0;
    track.style.transform='translateY(-'+offset+'px)';cancelReel(reel);
    const last=Math.floor(offset/height)+6;
    while(sequence.length<=last+1)sequence.push(pool[sequence.length%pool.length]);
    sequence[last]=winner;
    const others=pool.filter(p=>p.key!==winner.key);
    if(others.length){sequence[last-1]=others[0];sequence[last+1]=others[1%others.length];}
    track.replaceChildren(...sequence.map(nameRow));target.dataset.phase='slowing';
    target.querySelector('.motion-caption').textContent='好運，即將停在這一刻！';
    const landing=pool.length>1?track.animate([{transform:'translateY(-'+offset+'px)'},{transform:'translateY(-'+(last-1)*height+'px)'}],{duration:1000,easing:'cubic-bezier(.3,.7,.4,1)',fill:'forwards'}):null;
    if(landing)reelAnimations.add(landing);
    try {await (landing?landing.finished:delay(1000));} catch(_) {return false;} finally {reelAnimations.delete(landing);}
    if(overlay!==target)return false;
    track.replaceChildren(...sequence.slice(last-1,last+2).map(nameRow));track.style.transform='translateY(0)';landing?.cancel();
    viewport.classList.add('locked');viewport.dataset.winnerKey=winner.key;target.dataset.phase='locked';
    target.querySelector('.motion-caption').textContent='恭喜 '+winner.name+' · 手機末三碼 '+winner.phoneTail;
    await delay(450);if(overlay!==target)return false;confetti(target);target.dataset.phase='confetti';
    await delay(1200);return overlay===target;
  }
  async function run(session) {
    const {target}=session;
    if(!reduced()) {
      target.dataset.phase='countdown';target.querySelector('.motion-caption').textContent='準備揭曉';
      for(const n of ['3','2','1']) {
        if(overlay!==target)return;
        const symbol=element('div','motion-symbol counting');
        const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),text=document.createElementNS(ns,'text');
        svg.setAttribute('viewBox','0 0 160 160');svg.setAttribute('aria-hidden','true');
        text.setAttribute('font-size','160');text.setAttribute('fill','currentColor');text.textContent=n;svg.append(text);symbol.append(svg);
        target.querySelector('.motion-symbol').replaceWith(symbol);
        // 依字形實際邊界置中，避免字型基線讓 3／2／1 看起來偏下。
        const context=document.createElement('canvas').getContext('2d');
        context.font='160px '+getComputedStyle(symbol).fontFamily;
        const ink=context.measureText(n);
        text.setAttribute('x',80+(ink.actualBoundingBoxLeft-ink.actualBoundingBoxRight)/2);
        text.setAttribute('y',80+(ink.actualBoundingBoxAscent-ink.actualBoundingBoxDescent)/2);
        await delay(1000);
      }
    }
    if(overlay!==target)return;
    let stage=null,fast=null;
    if(!reduced() && session.candidates.length) {
      stage=makeStage(target);fast=beginFast(stage,session.candidates,0,session.count);
    } else if(!reduced()) {
      // 舊後端或資料缺少時不造假姓名；正常新版建立／載入時已備好候選名單。
      target.querySelector('.motion-symbol').textContent='✦';target.querySelector('.motion-caption').textContent='正在確認結果…';
    }
    const draw=await session.result;
    if(overlay!==target || !draw)return;
    const canSpin=validAnimation(draw);
    if(!reduced() && canSpin) {
      let pool=draw.animation.candidates.slice();
      stage=stage || makeStage(target);
      // 以後端該輪資料為準。舊頁面或不一致的預載不能決定資格或停點。
      const saved=new Map(pool.map(p=>[p.key,p]));
      const same=fast && fast.pool.length===pool.length && fast.pool.every(p=>{const q=saved.get(p.key);return q && p.name===q.name && p.phoneTail===q.phoneTail;});
      if(!same){cancelReel(fast?.reel);fast=beginFast(stage,pool,0,draw.winners.length);}
      for(let index=0;index<draw.animation.winners.length;index++) {
        if(overlay!==target)return;
        if(index>0){fast=beginFast(stage,pool,index,draw.winners.length);await delay(1000);if(overlay!==target)return;}
        const winner=draw.animation.winners[index];
        if(!await stopOn(fast,winner))return;
        const awarded=element('div','motion-awarded-person');awarded.dataset.key=winner.key;
        awarded.append(element('span','',String(index+1).padStart(2,'0')),element('strong','',winner.name),element('small','',winner.phoneTail));stage.tray.append(awarded);
        pool=pool.filter(p=>p.key!==winner.key);
      }
    } else {cancelReel(fast?.reel);}
    if(overlay!==target)return;
    target.classList.remove('spinning');target.dataset.phase='revealed';
    target.classList.add('revealed');target.querySelector('.motion-suspense').remove();target.querySelector('.motion-caption').remove();target.querySelector('.motion-bottom').remove();
    target.querySelector('.motion-kicker').textContent=canSpin?'THE LUCKY MOMENT':'得獎結果已保存';
    const results=element('div','motion-results');results.append(element('h2','motion-congrats','恭喜中獎！'));
    const list=element('div','motion-winners'+(draw.winners.length===1?' single':draw.winners.length>6?' many':''));
    draw.winners.forEach((w,i)=>{const card=element('div','motion-winner');card.style.setProperty('--order',Math.min(i,6));card.append(element('strong','',w.name),element('small','','手機末三碼 '+w.phoneTail));list.append(card);});
    results.append(list);const button=element('button','motion-close','回到抽獎台');button.type='button';button.addEventListener('click',close);
    target.append(results,element('p','motion-bottom','本輪 '+draw.winners.length+' 位得獎者 · 結果已保存'),button);
    target.setAttribute('aria-label',draw.prize+'：'+draw.winners.length+' 位得獎者已揭曉');
    target.scrollTop=0;button.focus({preventScroll:true});
    if(!canSpin && !reduced()) target.querySelector('.motion-bottom').textContent='輪播資料未取得，直接顯示已保存結果 · 不需重新抽獎';
  }
  async function reveal(draw) {
    const session=current;if(!session)return;
    if(!draw){close();return;}
    session.resolve(draw);await session.done;
  }
  window.RaffleMotion={start,reveal,abort:close};
})();
