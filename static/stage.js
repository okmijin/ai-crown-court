'use strict';

const emotions = ['attentive','nod','frown','angry','surprise','sweat','eyeroll'];

function inferEmotion(text, role) {
  const words = typeof text === 'object' && text ? Object.values(text).join(' ') : String(text ?? '');
  const juror = typeof role === 'number';
  if (/不成立|异议|\b(?:objection|does not survive)\b/i.test(words)) {
    return role === 'defense' || (juror && role % 3 === 0) ? 'angry' : 'surprise';
  }
  if (/未知|没有|未|\b(?:unknown|uncertain|missing|no evidence)\b/i.test(words)) return 'sweat';
  if (/失败|风险|缺口|攻击|\b(?:attack|fail\w*|risk\w*|gap\w*)\b/i.test(words)) {
    if (role === 'defense' || juror) return juror && role % 3 === 0 ? 'sweat' : 'frown';
  }
  if (/定位|能成|优势|\b(?:strength\w*|viable|positioning)\b/i.test(words)) {
    if (role === 'prosecution') return 'frown';
    if (juror && role % 3 !== 0) return 'nod';
  }
  if (/但是|然而|突然|反而|\b(?:however|yet|suddenly|in contrast)\b/i.test(words)) return 'surprise';
  if (/夸大|\b(?:exaggerat\w*|absurd)\b/i.test(words)) return 'eyeroll';
  return 'attentive';
}

const stage = (() => {
  const canvas = document.querySelector('#stage'), ctx = canvas.getContext('2d');
  const palette = {
    ink:'#181923', shade:'#242536', stone:'#393747', indigo:'#414c6c', lightBlue:'#66728a',
    moss:'#5e7255', wood:'#523530', trim:'#815341', rust:'#a25244', sand:'#b78659',
    gold:'#d8a965', cream:'#f1d49c', skin:'#d2976e', brown:'#94624d', pale:'#ebbc90', white:'#c8b7a5',
  };
  const people = [
    ['ink','pale','moss','glasses'], ['wood','skin','indigo','bob'], ['ink','brown','rust','sweep'],
    ['white','pale','shade','wig'], ['rust','pale','moss','spikes'], ['ink','skin','lightBlue','goggles'],
    ['wood','brown','sand','apron'], ['white','pale','indigo','glasses'], ['wood','skin','moss','bun'],
    ['ink','brown','shade','tie'], ['rust','pale','indigo','beret'], ['white','skin','rust','sweep'],
  ];
  const anchors = people.map((_, i) => [65 + i % 6 * 70, i < 6 ? 229 : 305]);
  const state = {active:null, seats:new Set(people.keys()), votes:new Map(), ceremony:false, strike:0, shake:0};
  const positions = {judge:[240,86], defense:[79,152], prosecution:[401,152], clerk:[240,135], dock:[240,187]};
  const world = document.querySelector('#stage-world');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const rect = (x,y,w,h,color) => { ctx.fillStyle = palette[color]; ctx.fillRect(x,y,w,h); };
  function polygon(points,color) {
    ctx.fillStyle=palette[color];
    ctx.beginPath();
    points.forEach(([x,y],i) => i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.fill();
  }
  function panel(x,y,w,h) {
    rect(x,y,w,h,'ink'); rect(x+2,y+2,w-4,h-4,'wood');
    rect(x+3,y+3,w-6,2,'trim'); rect(x+4,y+h-6,w-8,2,'shade');
    rect(x+3,y+5,2,h-9,'trim'); rect(x+w-5,y+5,2,h-9,'wood');
  }
  function column(x) {
    rect(x+5,0,20,139,'ink'); rect(x+8,1,14,133,'trim');
    rect(x+9,1,3,136,'sand'); rect(x+17,4,2,126,'wood');
    rect(x+2,10,25,5,'ink'); rect(x,9,28,3,'gold');
    rect(x+1,132,27,8,'ink'); rect(x,132,27,3,'sand');
  }
  function windowBay(x) {
    rect(x+6,20,36,7,'ink'); rect(x,27,48,63,'ink');
    rect(x+6,28,36,56,'indigo'); rect(x+10,31,28,23,'lightBlue');
    rect(x+10,55,28,26,'stone'); rect(x+22,25,4,59,'ink');
    rect(x+2,53,44,4,'ink'); rect(x-3,86,54,4,'trim');
    rect(x+13,33,2,13,'white'); rect(x+16,34,2,6,'white');
  }
  function drawRoom() {
    rect(0,0,480,canvas.height,'shade');
    for(let y=1;y<114;y+=12) {
      rect(0,y,480,1,'stone');
      for(let x=y%24?16:0;x<480;x+=32) rect(x,y,1,11,'stone');
    }
    windowBay(72); windowBay(360);
    for(const x of [14,134,318,438]) column(x);
    panel(168,-9,144,121);
    rect(183,0,114,88,'shade'); rect(185,0,110,81,'stone');
    for(const x of [185,190,284,289]) rect(x,0,3,79,'indigo');
    polygon([[223,11],[257,11],[257,38],[240,48],[223,38]],'ink');
    polygon([[226,13],[254,13],[254,36],[240,44],[226,36]],'rust');
    rect(226,13,13,9,'rust'); rect(241,13,13,9,'indigo');
    rect(226,24,13,11,'indigo'); rect(241,24,13,11,'rust');
    for (const [x,y] of [[228,15],[244,26]]) {
      for (let row=0;row<3;row++) {
        rect(x,y+row*3,9,1,'gold');
        rect(x+6,y-1+row*3,2,2,'cream');
      }
    }
    rect(245,15,5,5,'gold'); rect(232,27,4,6,'gold');
    // Crown and supporters of the royal arms.
    polygon([[228,3],[233,6],[237,4],[240,1],[243,4],[247,6],[252,3],[249,11],[231,11]],'gold');
    rect(232,9,16,1,'cream'); rect(236,7,2,2,'rust'); rect(243,7,2,2,'indigo');
    for(const x of [231,239,247]) rect(x,3,2,5,'gold');
    rect(239,0,2,5,'cream');
    polygon([[222,22],[219,26],[215,23],[214,17],[208,17],[204,22],[206,28],
      [203,35],[201,31],[201,26],[198,24],[197,29],[200,36],[206,39],[205,43],
      [210,43],[211,34],[215,36],[216,42],[220,42],[219,31],[223,27]],'gold');
    rect(206,18,5,10,'sand'); rect(211,20,2,2,'ink');rect(209,24,4,2,'rust');
    polygon([[258,24],[262,24],[265,17],[272,18],[274,24],[271,29],[276,34],
      [280,30],[282,33],[277,39],[274,43],[270,43],[270,37],[266,36],
      [265,42],[261,42],[263,30],[258,27]],'white');
    polygon([[267,18],[263,10],[270,18]],'cream');
    rect(267,21,2,2,'ink');
    rect(206,46,68,2,'trim');rect(217,47,46,2,'gold');
    for (let x=0;x<480;x+=34) panel(x,99,34,38);
    polygon([[0,149],[81,116],[399,116],[480,149],[480,296],[0,296]],'sand');
    for(let y=128;y<296;y+=13) {
      rect(0,y,480,1,'trim');
      for(let x=(y%2)*21;x<480;x+=42) rect(x,y,1,12,'trim');
    }
    polygon([[200,120],[280,120],[328,202],[152,202]],'wood');
    polygon([[204,120],[276,120],[312,203],[168,203]],'rust');
    rect(165,196,150,2,'gold');
    for(const x of [163,283]) {
      panel(x,108,34,12); panel(x,120,34,10); panel(x,130,34,9);
    }
    for (const x of [7,378]) {
      polygon([[x,177],[x+25,166],[x+86,166],[x+95,181],[x+83,190],[x+8,190]],'wood');
    }
    rect(0,199,480,canvas.height-199,'wood');
    for(let y=202;y<canvas.height;y+=13) rect(0,y,480,1,'trim');
    rect(0,197,480,4,'ink'); rect(0,197,480,1,'gold');
  }
  function sprite(x,base,style,role,t,index) {
    const [hair,skin,coat,feature] = style;
    const still = reduced.matches || state.frozen;
    const active = state.active === role;
    const standing = active || state.ceremony;
    const speaking = active && (state.frozen || (!still && state.typing));
    const frame = Math.floor(t/145);
    const breathing = still ? 0 : [0,1,2,1][Math.floor(t/430+index*.63)%4];
    const blink = !still && (Math.floor(t/90)+index*13)%47 < 2;
    const whisper = typeof role === 'number' && state.whisper && !state.votes.has(role)
      && (!reduced.matches || state.frozen);
    const reacting = !active && (state.frozen || t < state.reactionUntil);
    const emotion = whisper ? ['nod','sweat','frown'][(role+(still?0:Math.floor(t/440)))%3]
      : reacting ? state.reactions?.get(role) : 'attentive';
    const beat = still ? 1 : Math.floor(t/150)%3;
    if (whisper) x += role%2 ? -4 : 4;
    const y = base-33-(standing?5:0)-breathing+(emotion==='nod' && beat===1?2:0);
    const mouthOpen = speaking && (state.frozen || frame%2===0);
    rect(x-11,base-1,23,3,'shade');
    if(standing) {
      rect(x-13,y+16,26,14,'gold'); rect(x-9,y-2,18,20,'gold');
      rect(x-11,y+30,22,5,'gold');
    }
    rect(x-10,y+27,20,6,'ink'); rect(x-7,y+24,5,7,'stone'); rect(x+2,y+24,5,7,'stone');
    rect(x-10,y+17,20,11,'ink'); rect(x-8,y+17,16,10,coat);
    rect(x-2,y+17,4,5,'white'); rect(x-1,y+20,2,5,'gold');
    rect(x-8,y+2,16,15,'ink'); rect(x-6,y+2,12,13,skin);
    rect(x-4,y+14,8,2,skin); rect(x-8,y+10,2,4,skin); rect(x+6,y+10,2,4,skin);
    rect(x-7,y+2,14,5,hair); rect(x-8,y+4,3,6,hair);
    if(feature==='glasses'||feature==='goggles') {
      rect(x-6,y+8,12,1,'ink');
      for(const dx of [-6,1]) {
        rect(x+dx,y+9,5,3,'ink'); rect(x+dx+1,y+9,3,2,feature==='goggles'?'lightBlue':'cream');
      }
    }
    const eyeY = y+(emotion==='eyeroll' ? 8 : 9);
    rect(x-4,eyeY,2,blink?1:2,'ink'); rect(x+2,eyeY,2,blink?1:2,'ink');
    rect(x-1,y+13,mouthOpen?3:2,mouthOpen||emotion==='surprise'?2:1,'wood');
    if (emotion==='frown'||emotion==='angry') {
      rect(x-5,y+7,3,1,'ink'); rect(x+2,y+7,3,1,'ink');
      rect(x-2,y+8,1,1,'ink'); rect(x+1,y+8,1,1,'ink');
    }
    if(feature==='bob') {rect(x+5,y+5,4,12,hair); rect(x-8,y+7,3,10,hair);}
    if(feature==='sweep') {rect(x-5,y,13,3,hair); rect(x+4,y+1,4,7,hair);}
    if(feature==='wig'||feature==='gown') {
      rect(x-7,y,14,3,'cream');
      for(const dx of [-10,6]) {
        rect(x+dx,y+4,4,13,hair);
        for(const dy of [5,9,13]) rect(x+dx,y+dy,4,2,'cream');
      }
      if(feature==='gown') {
        polygon([[x-7,y+16],[x-13,y+30],[x+13,y+30],[x+7,y+16]],'ink');
        rect(x-7,y+17,2,12,coat);rect(x+5,y+17,2,12,coat);
        rect(x-3,y+17,2,6,'white');rect(x+1,y+17,2,6,'white');
      }
    }
    if(feature==='spikes') {rect(x-7,y,3,6,hair); rect(x-2,y-2,3,7,hair); rect(x+3,y,3,6,hair);}
    if(feature==='apron') {rect(x-5,y+21,10,7,'wood'); rect(x-2,y+23,4,3,'cream');}
    if(feature==='bun') {rect(x+4,y-3,6,6,hair); rect(x+4,y+1,4,2,'gold');}
    if(feature==='tie') rect(x-1,y+19,2,8,'rust');
    if(feature==='beret') {rect(x-8,y+1,15,4,hair); rect(x-6,y-1,9,2,hair);}
    if(active) {
      const raised = state.frozen || (speaking && frame%4===1);
      rect(x+8,y+(raised?16:19),6,4,coat); rect(x+13,y+(raised?14:19),3,3,skin);
    }
    if (emotion==='angry') {
      rect(x+11,y+4-beat,6,3,'white'); rect(x+14,y+2-beat,4,5,'white');
    }
    if (emotion==='surprise') {
      rect(x+12,y-2-beat,2,6,'gold'); rect(x+12,y+5-beat,2,2,'gold');
    }
    if (emotion==='sweat') {
      rect(x+12,y+3+beat,1,2,'lightBlue'); rect(x+11,y+5+beat,3,3,'lightBlue');
    }
  }
  function stand(x,y,w,side) {
    panel(x,y,w,23); rect(x-2,y,w+4,4,'ink');
    rect(x-2,y,w+4,2,'sand'); rect(x+4,y+6,w-8,3,side);
    rect(x+6,y+13,w-12,1,'trim'); rect(x+6,y+16,w-12,1,'trim');
  }
  function speechBubble(x,y,t,whisper=false) {
    const elapsed = t-state.speechStart;
    const still = reduced.matches || state.frozen;
    const width = whisper ? 22 : 36;
    const height = whisper ? 10 : 16;
    const scale = still || whisper ? 1 : Math.min(1,.35+elapsed/190);
    ctx.save();
    ctx.translate(x,y+height);
    ctx.scale(scale,scale);
    rect(-width/2,-height,width,height,'ink');
    rect(2-width/2,2-height,width-4,height-4,'cream');
    rect(-4,-1,6,5,'ink'); rect(-3,-3,4,5,'cream');
    for(let i=0;i<3;i++) {
      const emphasis=!still && Math.floor(t/155)%3===i;
      rect((i-1)*(whisper?5:8)-1, -height/2-(emphasis?2:0),3,2,emphasis?'rust':'trim');
    }
    ctx.restore();
  }
  function gavel(x,y,beat) {
    if(beat===1) {rect(x,y-6,3,13,'sand'); rect(x-6,y-10,15,5,'ink'); rect(x-5,y-9,13,3,'gold');}
    else {rect(x-11,y-1,12,3,'sand'); rect(x,y-5,6,11,'ink'); rect(x+1,y-4,4,9,'gold');}
    rect(x-6,y+6,17,3,'ink'); rect(x-5,y+6,15,1,'trim');
  }
  const labels = document.querySelector('#stage-labels');
  function tag(text,x,y,css) {
    const node=document.createElement('span');
    node.className=css; node.textContent=text; node.style.left=x/4.8+'%'; node.style.top=y/canvas.height*100+'%';
    labels.append(node);
    return node;
  }
  const seatTags=anchors.map(([x,y])=>tag('',x,y+5,'stage-tag juror-tag'));
  const voteTags=anchors.map(([x,y])=>tag('',x,y-30,'vote-tag'));
  const bench=tag('',240,95,'stage-tag');
  const defence=tag('',79,165,'stage-tag');
  const crown=tag('',401,165,'stage-tag');
  const dock=tag('',240,190,'stage-tag dock-tag');
  const clerk=tag('',240,136,'stage-tag');
  function refreshTags() {
    bench.textContent=t('法官','Judge');
    defence.textContent=t(...roles.defense);
    crown.textContent=t(...roles.prosecution);
    dock.textContent=t('被告席 · The dock','The dock');
    clerk.textContent=t('书记员','Clerk');
    anchors.forEach(([,y],i) => {
      seatTags[i].textContent=jurorName(jurors[i]);
      seatTags[i].title=jurorName(jurors[i]);
      seatTags[i].classList.toggle('empty',!state.seats.has(i));
      seatTags[i].classList.toggle('active',state.active===i);
      const vote=state.votes.get(i);
      const lifted=state.active===i;
      voteTags[i].hidden=!vote;
      voteTags[i].textContent=vote ? (lang==='zh'?voteKey(vote):finding(vote)) : '';
      voteTags[i].className='vote-tag'+(voteKey(vote)==='无罪'?' acquitted':voteKey(vote)==='未表决'?' abstained':'');
      voteTags[i].style.top=(y-(lifted?33:24))/canvas.height*100+'%';
      voteTags[i].style.marginLeft=lifted?'0':'3.8%';
    });
  }
  refreshTags();
  function draw(t) {
    const animate=!reduced.matches&&!state.frozen;
    const bump=animate && t<state.shake && t>state.strike-315 ? Math.round(Math.sin(t/17)*2) : 0;
    const speaker = positions[state.active] || anchors[state.active];
    const age = t-state.speechStart;
    const zoom = animate && speaker && age>=0 && age<1850 ? .32*Math.sin(Math.PI*age/1850)**2 : 0;
    const origin = speaker || [240,148];
    world.style.transformOrigin = (origin[0]/4.8)+'% '+((origin[1]-35)/canvas.height*100)+'%';
    world.style.transform = zoom || bump ? 'translate('+bump+'px,'+Math.abs(bump)+'px) scale('+ (1+zoom) +')' : '';
    drawRoom();
    sprite(240,86,['white','pale','shade','gown'],'judge',t,1);
    stand(187,77,106,'sand');
    const swing = animate && t<state.strike;
    const raised = swing && t<state.strike-315;
    if (swing) {
      polygon([[249,68],[raised?264:267,raised?56:68],[raised?266:269,raised?60:72],[248,73]],'ink');
      rect(raised?264:267,raised?56:67,4,4,'pale');
    }
    gavel(271,69,raised?1:0);
    sprite(79,152,['white','pale','lightBlue','gown'],'defense',t,2);
    sprite(401,152,['white','skin','rust','gown'],'prosecution',t,3);
    stand(28,149,102,'lightBlue'); stand(350,149,102,'rust');
    sprite(240,135,['wood','skin','moss','glasses'],'clerk',t,4);
    stand(215,125,50,'moss');
    sprite(240,187,['ink','skin','indigo','bob'],'dock',t,17);
    panel(205,167,70,29);
    for(let x=209;x<272;x+=7) rect(x,171,2,13,'gold');
    panel(20,199,440,canvas.height-201);
    for(const row of [0,1]) {
      const y=anchors[row*6][1];
      panel(24,y-11,432,23);
      for(let j=0;j<6;j++) {
        const i=row*6+j, x=anchors[i][0];
        panel(x-17,y-31,34,32); rect(x-13,y-27,26,20,'stone');
        rect(x-12,y-26,24,1,'lightBlue');
        if(state.seats.has(i)) sprite(x,y,people[i],i,t,i+5);
      }
      rect(25,y+3,430,2,'sand');
    }
    if (state.whisper && (!reduced.matches || state.frozen)) {
      anchors.forEach(([x,y],i)=>{
        if (state.seats.has(i) && !state.votes.has(i) && i%2===0) speechBubble(x+17,y-46,t,true);
      });
    }
    if (speaker && state.hasSpeech) speechBubble(speaker[0]+(state.active==='judge'?35:13),speaker[1]-63,t);
    if(!state.stopLoop) requestAnimationFrame(draw);
  }
  requestAnimationFrame(draw);
  return {state,reduced,refreshTags};
})();
