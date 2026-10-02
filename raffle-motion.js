/* 視覺揭曉與抽樣分離：此檔只讀管理者取得的遮罩名單、不發 API、不決定得獎者。 */
(() => {
  let overlay=null, started=0, animation=0, previousFocus=null, previousOverflow='', mainWasInert=false;
  const reelAnimations=new Set();
  const reduced=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function element(tag,cls,text) { const el=document.createElement(tag); el.className=cls; if(text!==undefined) el.textContent=text; return el; }
  function close() {
    if(!overlay) return;
    cancelAnimationFrame(animation); reelAnimations.forEach(a=>a.cancel()); reelAnimations.clear(); overlay.remove(); overlay=null;
    document.body.style.overflow=previousOverflow;
    const main=document.getElementById('main'); if(main) main.inert=mainWasInert;
    if(previousFocus?.isConnected && !previousFocus.disabled) previousFocus.focus({preventScroll:true});
  }
  function start({eventName,prize,count,demo}) {
    close(); started=performance.now(); previousFocus=document.activeElement;
    previousOverflow=document.body.style.overflow; document.body.style.overflow='hidden';
    const main=document.getElementById('main'); mainWasInert=!!main?.inert; if(main) main.inert=true;
    overlay=element('section','draw-theater'); overlay.setAttribute('role','dialog'); overlay.setAttribute('aria-modal','true'); overlay.setAttribute('aria-label','抽獎揭曉'); overlay.tabIndex=-1;
    overlay.append(element('p','motion-event',eventName),element('p','motion-kicker',demo?'示範抽獎 · 虛構名單':'好運，即將揭曉'),element('h2','motion-prize',prize));
    const suspense=element('div','motion-suspense'),orbit=element('div','motion-orbit');
    orbit.append(element('i','motion-ring'));
    for(let i=0;i<12;i++){const spark=element('i','motion-spark');spark.style.setProperty('--i',i);orbit.append(spark);}
    orbit.setAttribute('aria-hidden','true');orbit.append(element('div','motion-symbol','✦'));suspense.append(orbit);
    const caption=element('p','motion-caption','正在抽選 '+count+' 位幸運學員…');caption.setAttribute('role','status');
    overlay.append(suspense,caption,element('p','motion-bottom','下一份好運，會是誰？'));
    overlay.addEventListener('keydown',event=>{
      if(event.key==='Escape' && overlay?.classList.contains('revealed')) {event.stopPropagation();close();}
      if(event.key==='Tab'){event.preventDefault();const focus=overlay?.querySelector('button') || overlay;focus?.focus();}
    });
    document.body.append(overlay);overlay.focus();
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
  async function spinNames(target, draw) {
    target.classList.add('spinning');
    const suspense=target.querySelector('.motion-suspense');suspense.replaceChildren();
    const stage=element('div','motion-name-stage'),order=element('p','motion-name-order');
    const viewport=element('div','motion-name-viewport'),track=element('div','motion-name-track'),frame=element('div','motion-selection');
    viewport.setAttribute('aria-hidden','true');viewport.append(track,frame);
    const tray=element('div','motion-awarded');tray.setAttribute('aria-label','本輪已揭曉');
    stage.append(order,viewport,tray);suspense.append(stage);
    let pool=draw.animation.candidates.slice();
    target.querySelector('.motion-bottom').textContent='金色框內，下一位幸運學員。';
    for(let index=0;index<draw.animation.winners.length;index++) {
      if(overlay!==target)return;
      cancelAnimationFrame(animation);target.querySelector('.motion-confetti')?.remove();
      const winner=draw.animation.winners[index];
      viewport.classList.toggle('sole',pool.length===1);
      viewport.classList.remove('locked');track.style.transform='translateY(0)';track.replaceChildren();
      order.textContent='第 '+(index+1)+' / '+draw.winners.length+' 位 · '+pool.length+' 人參與本次輪播';
      target.querySelector('.motion-caption').textContent=pool.length===1?'最後一位幸運學員，即將揭曉':'姓名輪播中…';
      // 僅打亂顯示順序；真正得獎者已由後端保存。每個畫面項目都出自合格名單。
      const shuffled=pool.slice();
      for(let j=shuffled.length-1;j>0;j--){const k=Math.floor(Math.random()*(j+1));[shuffled[j],shuffled[k]]=[shuffled[k],shuffled[j]];}
      const last=55,sequence=Array.from({length:last+3},(_,i)=>shuffled[i%shuffled.length]);sequence[last]=winner;
      const others=shuffled.filter(p=>p.key!==winner.key);
      if(others.length){sequence[last-1]=others[0];sequence[last+1]=others[1%others.length];}
      // 三列視窗的中央列固定為中獎停點，行高不隨視窗寬度變化。
      sequence.forEach(p=>track.append(nameRow(p)));
      const height=track.firstElementChild.getBoundingClientRect().height;
      if(pool.length>1) {
        const reel=track.animate([
          {transform:'translateY(0)',offset:0,easing:'linear'},
          {transform:'translateY(-'+(last-1)*height*.7+'px)',offset:.42,easing:'cubic-bezier(.25,.8,.3,1)'},
          {transform:'translateY(-'+(last-1)*height+'px)',offset:1}
        ],{duration:5000,fill:'forwards'});
        reelAnimations.add(reel);
        try {await reel.finished;} catch(_) {return;} finally {reelAnimations.delete(reel);}
        if(overlay!==target)return;
        // 固定為三列，避免取消動畫或視窗縮放時跳回開頭。
        track.replaceChildren(...sequence.slice(last-1,last+2).map(nameRow));track.style.transform='translateY(0)';reel.cancel();
      } else {
        track.replaceChildren(nameRow(winner),nameRow(winner),nameRow(winner));await delay(600);
      }
      if(overlay!==target)return;
      viewport.classList.add('locked');viewport.dataset.winnerKey=winner.key;
      target.querySelector('.motion-caption').textContent='恭喜 '+winner.name+' · 手機末三碼 '+winner.phoneTail;
      await delay(450);if(overlay!==target)return;confetti(target);
      await delay(1200);if(overlay!==target)return;
      const awarded=element('div','motion-awarded-person');awarded.dataset.key=winner.key;
      awarded.append(element('span','',String(index+1).padStart(2,'0')),element('strong','',winner.name),element('small','',winner.phoneTail));tray.append(awarded);
      pool=pool.filter(p=>p.key!==winner.key);
    }
    target.classList.remove('spinning');
  }
  async function reveal(draw) {
    if(!overlay || !draw) {close();return;}
    const target=overlay;
    const canSpin=validAnimation(draw);
    if(!reduced() && canSpin) {
      await delay(Math.max(0,900-(performance.now()-started)));
      if(overlay!==target)return;
      target.querySelector('.motion-caption').textContent='準備揭曉';
      for(const n of ['3','2','1']) {
        if(overlay!==target)return;
        const old=target.querySelector('.motion-symbol'),symbol=element('div','motion-symbol counting',n);old.replaceWith(symbol);
        await delay(800);
      }
      if(overlay!==target)return;
      await spinNames(target,draw);
    }
    if(overlay!==target)return;
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
  window.RaffleMotion={start,reveal,abort:close};
})();
