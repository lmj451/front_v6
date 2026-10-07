(function(){
  "use strict";

  var vp=document.getElementById('viewport'), layer=document.getElementById('layer');
  var imgC=document.getElementById('img'), ictx=imgC.getContext('2d',{willReadFrequently:true});
  var drop=document.getElementById('drop'), runBtn=document.getElementById('run');
  var p1=document.getElementById('p1'), p2=document.getElementById('p2'), p3=document.getElementById('p3');
  var MAXDIM=1100, loaded=false, IW=0, IH=0, scale=1, tx=0, ty=0, fileLabel='';

  function esc(s){
    return String(s==null?'':s).replace(/[&<>"']/g, function(c){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
    });
  }

  /* ═══════════════════════════════════════════════════════════
     진단 기준 (루브릭) — 수행계획서 "진단 기준" 슬라이드와 같은 내용
     criteria_version: v1_draft
     · 선 품질 세부 기준 3개는 계획서 JSON 예시와 동일
     · 나머지 4개 항목의 세부 기준은 항목 설명을 나눈 초안 → 팀에서 확정 필요
     · 이 배열이 1단계 DeepSeek 고정 프롬프트의 채점 기준표(루브릭)와 1:1로 맞아야 함
     ═══════════════════════════════════════════════════════════ */
  var AXES=[
    {id:'line_quality', name:'선 품질',
     desc:'주요 선의 단절·겹침·번짐이 구조 해석을 방해하는지',
     subs:['주요 선의 식별 가능성','필요한 연결부의 명확성','겹친 선의 해석 방해 여부']},
    {id:'proportion', name:'비율',
     desc:'대응되는 부분의 길이·너비 차이와 크기 관계',
     subs:['대응 부위의 길이 차이','대응 부위의 너비 차이','부위 간 크기 관계']},
    {id:'silhouette', name:'실루엣',
     desc:'외곽선 누락·중첩과 전체 형태의 판독 가능 여부',
     subs:['외곽선 누락 여부','외곽선 중첩 여부','전체 형태의 판독 가능성']},
    {id:'balance', name:'균형',
     desc:'대응되는 요소의 높이·위치·정렬 차이',
     subs:['대응 요소의 높이 차이','대응 요소의 위치 차이','중심선 기준 정렬']},
    {id:'detail', name:'디테일',
     desc:'그려진 요소의 형태·경계·연결 관계의 판독 가능 여부',
     subs:['디테일 형태의 판독 가능성','디테일 경계의 명확성','몸판과의 연결 관계']}
  ];
  var AXIS_BY_ID={}; AXES.forEach(function(a){ AXIS_BY_ID[a.id]=a; });

  /* 세부 기준 상태값 (1단계 DeepSeek 응답 JSON과 동일하게 사용) */
  var SUB_LABEL={analyzed:null, cannot_judge:'판단 불가', not_applicable:'해당 없음'};

  /* 항목 점수 = 유효한 세부 기준 점수 합계 ÷ (유효한 세부 기준 개수 × 2) × 100
     판단 불가·해당 없음은 제외, 유효한 기준이 없으면 null.
     ※ 실제 서비스에서도 이 계산은 모델에게 맡기지 말고 Django에서 같은 공식으로 계산한다.
       (DeepSeek는 세부 기준별 rating·observation만 내고, 산수는 서버가 해야 결과가 일관됨) */
  function itemScore(subratings){
    var valid=subratings.filter(function(s){ return s.status==='analyzed'; });
    if(!valid.length) return {score:null, earned:0, max:0};
    var earned=valid.reduce(function(t,s){ return t+s.rating; },0), max=valid.length*2;
    return {score:Math.round(earned/max*100), earned:earned, max:max};
  }

  /* ─────────── 화면 전환 (진단 / 기준 가이드) ─────────── */
  function showView(v){
    document.getElementById('view-diagnose').classList.toggle('hidden', v!=='diagnose');
    document.getElementById('view-guide').classList.toggle('hidden', v!=='guide');
    document.querySelectorAll('#navLinks a').forEach(function(a){ a.classList.toggle('on', a.dataset.view===v); });
    if(v==='diagnose' && loaded) fit();
  }
  function route(){ showView(location.hash==='#guide'?'guide':'diagnose'); }
  window.addEventListener('hashchange', route);

  (function buildGuide(){
    var h='';
    AXES.forEach(function(a){
      h+='<div class="g-item"><h3>'+esc(a.name)+'</h3><p>'+esc(a.desc)+'</p><ol>';
      a.subs.forEach(function(s){ h+='<li>'+esc(s)+'</li>'; });
      h+='</ol></div>';
    });
    document.getElementById('guideItems').innerHTML=h;
  })();

  /* ─────────── 탭 ─────────── */
  document.getElementById('tabs').addEventListener('click', function(e){
    var b=e.target.closest('button'); if(!b) return;
    this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('on', x===b); });
    ['p1','p2','p3'].forEach(function(id){
      document.getElementById(id).classList.toggle('on', id===b.dataset.p);
    });
  });

  /* ─────────── 확대·축소·이동 ─────────── */
  function apply(){
    layer.style.transform='translate('+tx+'px,'+ty+'px) scale('+scale+')';
    document.getElementById('zoomVal').textContent = loaded ? Math.round(scale*100)+'%' : '—';
  }
  function cl(s){ return Math.max(0.1, Math.min(8, s)); }
  function fit(){
    if(!loaded) return;
    scale = cl(Math.min((vp.clientWidth-32)/IW, (vp.clientHeight-32)/IH));
    tx=(vp.clientWidth-IW*scale)/2; ty=(vp.clientHeight-IH*scale)/2; apply();
  }
  function zoomAt(cx,cy,f){
    if(!loaded) return;
    var ns=cl(scale*f), k=ns/scale;
    tx=cx-(cx-tx)*k; ty=cy-(cy-ty)*k; scale=ns; apply();
  }
  function zc(f){ zoomAt(vp.clientWidth/2, vp.clientHeight/2, f); }
  document.getElementById('z-in').onclick=function(){ zc(1.25); };
  document.getElementById('z-out').onclick=function(){ zc(1/1.25); };
  document.getElementById('z-fit').onclick=fit;
  document.getElementById('z-100').onclick=function(){ if(loaded) zc(1/scale); };
  vp.addEventListener('wheel', function(e){
    if(!loaded) return; e.preventDefault();
    var r=vp.getBoundingClientRect();
    zoomAt(e.clientX-r.left, e.clientY-r.top, e.deltaY<0?1.12:1/1.12);
  },{passive:false});
  var pan=false,px=0,py=0;
  vp.addEventListener('pointerdown',function(e){
    if(!loaded) return; pan=true; px=e.clientX; py=e.clientY;
    vp.classList.add('drag'); vp.setPointerCapture(e.pointerId);
  });
  vp.addEventListener('pointermove',function(e){
    if(!pan) return; tx+=e.clientX-px; ty+=e.clientY-py; px=e.clientX; py=e.clientY; apply();
  });
  function ep(){ pan=false; vp.classList.remove('drag'); }
  vp.addEventListener('pointerup',ep); vp.addEventListener('pointercancel',ep);
  window.addEventListener('resize',function(){ if(loaded) fit(); });

  /* ─────────── 이미지 로드 ─────────── */
  function loadImage(src,name){
    var im=new Image();
    im.onload=function(){
      var s=Math.min(1, MAXDIM/Math.max(im.width,im.height));
      IW=Math.round(im.width*s); IH=Math.round(im.height*s);
      imgC.width=IW; imgC.height=IH;
      ictx.fillStyle='#FFF'; ictx.fillRect(0,0,IW,IH); ictx.drawImage(im,0,0,IW,IH);
      loaded=true; drop.classList.add('hidden'); runBtn.disabled=false;
      fileLabel=name||'이미지';
      document.getElementById('fileName').textContent=fileLabel;
      document.getElementById('sizeInfo').textContent=im.width+' × '+im.height+' px';
      p1.innerHTML='<div class="empty-r"><b>진단 준비 완료</b><p>아래 진단하기를 눌러주세요.</p></div>';
      fit();
    };
    im.onerror=function(){ alert('이미지를 불러오지 못했습니다. PNG나 JPG 파일인지 확인해 주세요.'); };
    im.src=src;
  }
  /* TODO(Django 연동 지점): 서버로 보낼 땐 imgC.toBlob(...)으로 캔버스 이미지를 꺼내
     FormData에 담는다. (requestDiagnosis 참고) */
  function readFile(f){
    if(!f||!/^image\/(png|jpeg)$/.test(f.type)){ alert('PNG 또는 JPG 이미지만 올릴 수 있습니다.'); return; }
    var fr=new FileReader(); fr.onload=function(){ loadImage(fr.result,f.name); }; fr.readAsDataURL(f);
  }
  document.getElementById('t-open').onclick=function(){ document.getElementById('file').click(); };
  document.getElementById('file').onchange=function(e){ readFile(e.target.files[0]); };
  ['dragenter','dragover'].forEach(function(t){ vp.addEventListener(t,function(e){ e.preventDefault(); vp.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(t){ vp.addEventListener(t,function(e){ e.preventDefault(); vp.classList.remove('over'); }); });
  vp.addEventListener('drop',function(e){ if(e.dataTransfer.files&&e.dataTransfer.files[0]) readFile(e.dataTransfer.files[0]); });

  /* ─────────── 예시 스케치 ─────────── */
  function su(s){ return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(s); }
  var TEE='<svg xmlns="http://www.w3.org/2000/svg" width="640" height="560" viewBox="0 0 640 560">'+
   '<rect width="640" height="560" fill="#fff"/>'+
   '<g fill="none" stroke="#2A3A42" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">'+
   '<path d="M250 120 C262 104 286 96 320 96 C354 96 378 104 390 120"/>'+
   '<path d="M250 120 L150 168 L120 276 L186 300 L196 236"/>'+
   '<path d="M390 120 L496 166 L520 252 L462 272 L452 224"/>'+
   '<path d="M196 236 L192 452 L452 452 L452 224"/>'+
   '<path d="M286 100 C300 118 340 118 354 100"/></g>'+
   '<g fill="none" stroke="#5C6A66" stroke-width="1.8" stroke-linecap="round">'+
   '<path d="M360 300 L438 300 M360 318 L434 318 M360 336 L440 336 M364 354 L432 354 M362 372 L436 372"/>'+
   '<path d="M380 396 L428 398 M384 412 L424 414"/><circle cx="330" cy="330" r="14"/>'+
   '<path d="M214 320 L250 322"/></g>'+
   '<g fill="none" stroke="#9AA4A0" stroke-width="1.4" stroke-dasharray="6 5">'+
   '<path d="M186 300 L196 236 M462 272 L452 224"/></g></svg>';
  var DRESS='<svg xmlns="http://www.w3.org/2000/svg" width="560" height="680" viewBox="0 0 560 680">'+
   '<rect width="560" height="680" fill="#fff"/>'+
   '<g fill="none" stroke="#2A3A42" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">'+
   '<path d="M186 104 C198 88 220 82 250 82 C280 82 302 88 314 104"/>'+
   '<path d="M186 104 L136 140 L150 196 L196 180"/>'+
   '<path d="M314 104 L366 138 L352 194 L306 178"/>'+
   '<path d="M196 180 L188 300 L96 596 L392 596 L312 300 L306 178"/>'+
   '<path d="M188 300 L312 300"/></g>'+
   '<g fill="none" stroke="#5C6A66" stroke-width="1.8" stroke-linecap="round">'+
   '<path d="M140 380 L176 384 M132 420 L172 424 M124 460 L168 464 M116 500 L164 504 M108 540 L160 544"/>'+
   '<path d="M212 214 L250 216 M212 244 L246 246"/></g></svg>';
  document.getElementById('t-s1').onclick=function(){ loadImage(su(TEE),'예시 · 티셔츠 도식화'); };
  document.getElementById('t-s2').onclick=function(){ loadImage(su(DRESS),'예시 · 원피스'); };

  /* ═══════════════════════════════════════════════════════════
     프로세스 B: 고민 글 → 진단 초점
     지금은 키워드로 항목을 찾아 칩을 켜고, 해석 결과를 문장으로 보여줘 사용자가 확인·수정하게 한다.
     TODO(미정 · 회의 질문 3): 실제 해석 방식(모델이 고민 글을 읽고 focus를 정할지,
     지금처럼 키워드 규칙을 하드코딩할지)은 DeepSeek 테스트 후 결정.
     어느 쪽이든 서버에 보내는 값은 focus 배열(항목 id 목록) 하나로 통일한다.
     ═══════════════════════════════════════════════════════════ */
  var RULES={
    line_quality:['선이','선을','선 ','끊','번지','번져','겹쳐','겹친','지저분','흐릿','연결'],
    proportion:['비율','길이','소매','총장','어깨','너비','폭','크기','짧','길어'],
    silhouette:['실루엣','외곽','윤곽','형태','모양','핏'],
    balance:['균형','대칭','좌우','한쪽','기울','비뚤','높이','정렬','치우'],
    detail:['디테일','밋밋','심심','포켓','주머니','칼라','단추','주름','장식','봉제']
  };
  var focus={}, fromText={}, chipsEl=document.getElementById('chips');
  var worryEl=document.getElementById('worry'), noteEl=document.getElementById('focusNote');

  function focusIds(){ return AXES.filter(function(a){ return focus[a.id]; }).map(function(a){ return a.id; }); }
  function chips(){
    chipsEl.innerHTML='';
    AXES.forEach(function(a){
      var b=document.createElement('button');
      b.className='chip'; b.type='button'; b.textContent=a.name; b.title=a.desc;
      b.setAttribute('aria-pressed', focus[a.id]?'true':'false');
      b.onclick=function(){ focus[a.id]=!focus[a.id]; chips(); updateNote(); };
      chipsEl.appendChild(b);
    });
  }
  function updateNote(){
    var t=worryEl.value.trim();
    if(!t){ noteEl.classList.add('hidden'); return; }
    var hits=AXES.filter(function(a){ return fromText[a.id]; }).map(function(a){ return a.name; });
    noteEl.classList.remove('hidden');
    if(hits.length){
      noteEl.innerHTML='고민 글을 <b>'+esc(hits.join(', '))+'</b> 문제로 이해했어요. 이 항목을 먼저 보여드릴게요. 맞지 않으면 위에서 항목을 바꿔주세요.';
    }else{
      noteEl.innerHTML='고민 글에서 해당하는 항목을 찾지 못했어요. 중점으로 볼 항목을 위에서 직접 골라주세요.';
    }
  }
  chips();
  worryEl.addEventListener('input',function(){
    var t=this.value, hit={};
    Object.keys(RULES).forEach(function(k){ RULES[k].forEach(function(w){ if(t.indexOf(w)>-1) hit[k]=true; }); });
    // 이전에 글에서 켜졌던 항목은 끄고, 새로 찾은 항목만 켠다 (사용자가 직접 누른 항목은 유지)
    Object.keys(fromText).forEach(function(k){ if(!hit[k]) focus[k]=false; });
    Object.keys(hit).forEach(function(k){ focus[k]=true; });
    fromText=hit;
    chips(); updateNote();
  });

  /* ═══════════════════════════════════════════════════════════
     ① 서버 요청 — DeepSeek(채점) → LLM(설명) 2단계 구조 (지금은 로컬 데모 응답)

     [1단계] DeepSeek : 분류 · 채점
       모델: deepseek-v4-flash-vision-exp (DeepSeek에서 이미지를 받는 비전 모델, 실험 버전)
       입력: 스케치 이미지 + 고정 프롬프트(채점 기준표)
       출력: relevance(관련성·확신도·카테고리) + 세부 기준별 rating·observation
       → Django가 점수 공식으로 항목 점수(scores) 계산
     [2단계] LLM : 진단 리포트 · 개선 문장 작성
       입력: 1단계 채점 JSON + 고민 글·focus + 같은 카테고리 데이터셋 근거
       출력: 항목별 개선 문장(advice). 1단계 점수·판정은 바꾸지 않음
       ※ 1단계에서 거절되면 2단계는 부르지 않는다. 재확인이면 사용자가 확인한 뒤에 부른다.

     TODO(Django 연동 지점):
       1단계  POST /api/diagnose/  FormData(image, worry, focus) + X-CSRFToken
              → {diagnosis_id, relevance, focus, scores, evidence}
       2단계  POST /api/advice/    {diagnosis_id}
              → {advice: {항목id: 문장}}
     ═══════════════════════════════════════════════════════════ */
  function requestDiagnosis(){
    return new Promise(function(resolve){
      setTimeout(function(){ resolve(buildDemoStage1()); }, 600);
    });
  }
  function requestAdvice(stage1){
    return new Promise(function(resolve){
      setTimeout(function(){ resolve(buildDemoStage2(stage1)); }, 500);
    });
  }
  /* 두 단계 결과를 화면이 읽는 하나의 모양으로 합친다 (실제로는 Django가 합쳐서 줘도 됨) */
  function merge(stage1, stage2){
    var res=JSON.parse(JSON.stringify(stage1));
    Object.keys(res.evidence||{}).forEach(function(id){
      res.evidence[id].advice=(stage2&&stage2.advice&&stage2.advice[id])||'';
    });
    return res;
  }

  /* ─────────── 로컬 데모: 픽셀 계산으로 실제 응답과 같은 모양의 JSON을 만든다 ─────────── */
  var GX=10, GY=12;
  function measure(){
    var step=Math.max(1,Math.round(Math.max(IW,IH)/420));
    var d=ictx.getImageData(0,0,IW,IH).data;
    var bw=Math.ceil(IW/step), bh=Math.ceil(IH/step), bin=new Uint8Array(bw*bh);
    var ink=0,minX=bw,maxX=0,minY=bh,maxY=0,sx=0,x,y,dark=0;
    for(y=0;y<bh;y++) for(x=0;x<bw;x++){
      var i=((y*step)*IW+(x*step))*4;
      var lum=d[i]*0.299+d[i+1]*0.587+d[i+2]*0.114;
      if(lum<170){
        bin[y*bw+x]=1; ink++; sx+=x;
        if(x<minX)minX=x; if(x>maxX)maxX=x; if(y<minY)minY=y; if(y>maxY)maxY=y;
      }
    }
    var inkRatio=ink/(bw*bh);
    if(ink<60) return {inkRatio:inkRatio, empty:true};
    var W0=Math.max(1,maxX-minX+1), H0=Math.max(1,maxY-minY+1), mid=(minX+maxX)/2;
    var cxn=(sx/ink-mid)/W0;

    // 좌우 겹침률: 선 픽셀마다 중심선 반대편 같은 위치(±2칸 허용)에 선이 있는지 확인
    function near(cx,cy){
      for(var oy=-2;oy<=2;oy++) for(var ox=-2;ox<=2;ox++){
        var yy=cy+oy, xx=cx+ox;
        if(yy>=0&&yy<bh&&xx>=0&&xx<bw&&bin[yy*bw+xx]) return true;
      }
      return false;
    }
    var matched=0, L=0, R=0;
    for(y=minY;y<=maxY;y++) for(x=minX;x<=maxX;x++){
      if(!bin[y*bw+x]) continue;
      if(x<mid) L++; else R++;
      if(near(Math.round(2*mid-x),y)) matched++;
    }
    var sym=matched/Math.max(1,L+R), side=Math.max(L,R)/Math.max(1,Math.min(L,R));

    // 행별 좌우 폭 차이, 선이 없는 행 비율, 좌우 최상단 높이
    var wdSum=0, wdN=0, gapRows=0, topL=-1, topR=-1;
    for(y=minY;y<=maxY;y++){
      var lx=-1, rx=-1;
      for(x=minX;x<=maxX;x++) if(bin[y*bw+x]){ if(lx<0) lx=x; rx=x; }
      if(lx<0){ gapRows++; continue; }
      if(topL<0 && lx<mid) topL=y;
      if(topR<0 && rx>mid) topR=y;
      wdSum+=Math.abs((mid-lx)-(rx-mid)); wdN++;
    }
    var widthDiff=wdN?(wdSum/wdN)/W0:0, gap=gapRows/H0;
    var topDiff=(topL<0||topR<0)?1:Math.abs(topL-topR)/H0;

    // 외곽에서 채우기 → 닫힌 영역 비율
    var seen=new Uint8Array(bw*bh), q=[], head=0;
    for(x=0;x<bw;x++){ q.push(x); q.push((bh-1)*bw+x); }
    for(y=0;y<bh;y++){ q.push(y*bw); q.push(y*bw+bw-1); }
    q.forEach(function(i){ if(!bin[i]) seen[i]=1; });
    while(head<q.length){
      var c=q[head++]; if(!seen[c]) continue;
      var cy=Math.floor(c/bw), cx=c%bw;
      [[1,0],[-1,0],[0,1],[0,-1]].forEach(function(dd){
        var nx=cx+dd[0], ny=cy+dd[1];
        if(nx<0||ny<0||nx>=bw||ny>=bh) return;
        var n=ny*bw+nx;
        if(!bin[n]&&!seen[n]){ seen[n]=1; q.push(n); }
      });
    }
    var box=0, enc=0;
    for(y=minY;y<=maxY;y++) for(x=minX;x<=maxX;x++){
      box++; var ii=y*bw+x; if(!bin[ii]&&!seen[ii]) enc++;
    }
    var closure=box?enc/box:0, fill=ink/box;

    // 구역별 선 밀도
    var cells=[], mean=0;
    for(var gy=0;gy<GY;gy++) for(var gx=0;gx<GX;gx++){
      var x0=minX+Math.floor(W0*gx/GX), x1=minX+Math.floor(W0*(gx+1)/GX);
      var y0=minY+Math.floor(H0*gy/GY), y1=minY+Math.floor(H0*(gy+1)/GY);
      var n=0;
      for(y=y0;y<y1;y++) for(x=x0;x<x1;x++) if(bin[y*bw+x]) n++;
      cells.push({gx:gx,gy:gy,n:n}); mean+=n;
    }
    mean/=cells.length;
    var sd=0; cells.forEach(function(c){ sd+=(c.n-mean)*(c.n-mean); });
    sd=Math.sqrt(sd/cells.length);
    var hot=cells.slice().sort(function(a,b){return b.n-a.n;})[0];
    var emptyCells=cells.filter(function(c){ return c.n<mean*0.2; }).length/cells.length;

    return {inkRatio:inkRatio, sym:sym, side:side, heavy:(L>R?'왼쪽':'오른쪽'), cxn:cxn,
      widthDiff:widthDiff, gap:gap, topDiff:topDiff, closure:closure, fill:fill,
      cv:mean?sd/mean:1, hotRatio:mean?hot.n/mean:1, hot:hot, emptyCells:emptyCells, aspect:H0/W0};
  }
  function zone(gx,gy){
    return ['왼쪽','가운데','오른쪽'][Math.min(2,Math.floor(gx/(GX/3)))]+' '+
           ['위쪽','가슴~허리','아래쪽'][Math.min(2,Math.floor(gy/(GY/3)))];
  }
  /* v가 good 이하(또는 이상)면 2점, ok까지면 1점, 그 밖은 0점 */
  function grade(v,good,ok,higherIsBetter){
    if(higherIsBetter) return v>=good?2:(v>=ok?1:0);
    return v<=good?2:(v<=ok?1:0);
  }
  function sub(criterion,rating,observation){ return {criterion:criterion,status:'analyzed',rating:rating,observation:observation}; }
  function skip(criterion,status,observation){ return {criterion:criterion,status:status,rating:null,observation:observation}; }
  function pc(v){ return Math.round(v*100)+'%'; }

  /* 데모용 개선 문장: 가장 낮게 나온 세부 기준에 맞는 문장을 고른다.
     (실제 서비스에서는 2단계 LLM이 1단계 채점 결과와 데이터셋 근거를 보고 만든다) */
  var ADVICE={
    '주요 선의 식별 가능성':'칠하거나 번진 부분을 정리하고, 몸판·소매의 주요 선을 한 번 더 또렷하게 그어 주세요.',
    '필요한 연결부의 명확성':'끊긴 연결부(옆선·어깨선 등)부터 이어 그려 각 부위가 어디로 이어지는지 보이게 하세요.',
    '겹친 선의 해석 방해 여부':'선이 몰린 구역의 겹친 보조선을 지우거나 연하게 정리해 주요 선이 먼저 읽히게 하세요.',
    '대응 부위의 길이 차이':'어깨너비와 총장 기준을 먼저 정하고, 좌우 소매처럼 짝이 되는 부위의 길이를 같은 기준선에서 다시 재보세요.',
    '대응 부위의 너비 차이':'중심선을 기준으로 좌우 폭을 같은 간격으로 표시한 뒤 외곽선을 다시 맞춰 보세요.',
    '부위 간 크기 관계':'몸판 대비 소매·칼라 크기를 기준 도식화와 비교해 비율을 다시 잡아 보세요.',
    '외곽선 누락 여부':'비어 있는 외곽 구간을 이어 전체 실루엣이 한 번에 닫히게 하세요.',
    '외곽선 중첩 여부':'겹쳐 그린 외곽선 중 하나를 정리해 최종 실루엣 선을 하나로 남기세요.',
    '전체 형태의 판독 가능성':'몸판과 소매 외곽선을 먼저 닫아 전체 형태가 한 번에 읽히게 하세요.',
    '대응 요소의 높이 차이':'좌우 어깨와 소매 끝처럼 짝이 되는 요소를 같은 높이의 가이드선에 맞춰 다시 잡아 보세요.',
    '대응 요소의 위치 차이':'중심선으로 접었을 때 어긋나는 쪽을 기준으로 반대편 요소의 위치를 다시 맞춰 보세요.',
    '중심선 기준 정렬':'앞중심선을 먼저 긋고 그 선을 기준으로 전체 형태를 정렬해 보세요.',
    '디테일 형태의 판독 가능성':'선이 몰린 구역의 디테일은 덜어내고, 비어 있는 구역에 봉제선이나 주름을 더해 분포를 맞추세요.',
    '디테일 경계의 명확성':'포켓·칼라 같은 디테일의 경계선을 닫아 몸판과 구분되게 하세요.',
    '몸판과의 연결 관계':'디테일이 몸판의 어느 위치에 붙는지 연결선이나 봉제선으로 표시해 주세요.'
  };
  function adviceFor(subs){
    var worst=subs.filter(function(x){ return x.status==='analyzed'; })
      .sort(function(a,b){ return a.rating-b.rating; })[0];
    if(!worst) return '점검할 수 있는 기준이 없어 개선 방향을 제시하지 못했습니다. 잘리거나 가려진 부분이 없는 이미지로 다시 올려주세요.';
    if(worst.rating===2) return '이 항목은 뚜렷한 문제가 보이지 않습니다.';
    return ADVICE[worst.criterion]||'';
  }

  function buildDemoStage1(){
    var m=measure();
    var base={criteria_version:'v1_draft', score_type:'visual_check_index', analysis_source:'local_demo', diagnosis_id:'demo-'+Date.now()};

    if(m.empty || m.inkRatio<0.004){
      base.relevance={relevant:false, confidence:0.9, category:null,
        reason:'이미지에서 의류 스케치로 볼 수 있는 선을 거의 찾지 못함'};
      return base;
    }
    if(m.inkRatio>0.55){
      base.relevance={relevant:true, confidence:0.55, category:'상의',
        reason:'이미지 대부분이 어둡게 채워져 있어 스케치인지 확실하지 않음'};
    }else{
      base.relevance={relevant:true, confidence:0.92, category:(m.aspect>1.15?'원피스':'티셔츠'), reason:''};
    }
    base.focus=focusIds();

    var r={};
    r.line_quality=[
      sub('주요 선의 식별 가능성', grade(m.fill,0.12,0.3),
        m.fill<=0.12?'주요 선을 구분할 수 있음':'선이 차지하는 면적이 '+pc(m.fill)+'로 커서 주요 선과 칠한 면이 섞여 보임'),
      sub('필요한 연결부의 명확성', grade(m.closure,0.45,0.25,true),
        m.closure>=0.45?'몸판 외곽의 연결이 이어져 있음':'닫힌 영역이 '+pc(m.closure)+'뿐이라 끊긴 연결부가 남아 있음'),
      sub('겹친 선의 해석 방해 여부', grade(m.hotRatio,4,6),
        m.hotRatio<=4?'겹친 선이 구조 해석을 방해하지 않음':zone(m.hot.gx,m.hot.gy)+'에 선이 평균의 '+m.hotRatio.toFixed(1)+'배로 몰려 있음')
    ];
    r.proportion=[
      sub('대응 부위의 길이 차이', grade(m.side,1.15,1.4),
        m.heavy+' 선 양이 반대쪽의 '+m.side.toFixed(2)+'배'),
      sub('대응 부위의 너비 차이', grade(m.widthDiff,0.05,0.11),
        '중심선 기준 좌우 폭 차이가 전체 너비의 '+pc(m.widthDiff)),
      sub('부위 간 크기 관계', (m.aspect>=0.7&&m.aspect<=2.0)?2:((m.aspect>=0.5&&m.aspect<=2.6)?1:0),
        '전체 세로/가로 비율 '+m.aspect.toFixed(2))
    ];
    r.silhouette=[
      sub('외곽선 누락 여부', grade(m.gap,0.02,0.08),
        m.gap<=0.02?'외곽선이 위아래로 끊김 없이 이어짐':'선이 비는 구간이 전체 높이의 '+pc(m.gap)),
      skip('외곽선 중첩 여부','cannot_judge','로컬 데모에서는 계산하지 않는 기준 (실제 서비스에서는 DeepSeek가 판정)'),
      sub('전체 형태의 판독 가능성', grade(m.closure,0.4,0.2,true),
        m.closure>=0.4?'의류의 전체 형태를 읽을 수 있음':'외곽이 닫히지 않아 전체 형태를 특정하기 어려움')
    ];
    r.balance=[
      sub('대응 요소의 높이 차이', grade(m.topDiff,0.03,0.07),
        '좌우 가장 높은 지점의 차이가 전체 높이의 '+pc(m.topDiff)),
      sub('대응 요소의 위치 차이', grade(m.sym,0.8,0.6,true),
        '중심선으로 접었을 때 '+pc(1-m.sym)+'가 어긋남'),
      sub('중심선 기준 정렬', grade(Math.abs(m.cxn),0.03,0.08),
        '무게중심이 '+(m.cxn>0?'오른쪽':'왼쪽')+'으로 '+pc(Math.abs(m.cxn))+' 치우침')
    ];
    r.detail=[
      sub('디테일 형태의 판독 가능성', grade(m.cv,1.4,2.0),
        '구역별 선 밀도 변동계수 '+m.cv.toFixed(2)),
      skip('디테일 경계의 명확성','cannot_judge','로컬 데모에서는 계산하지 않는 기준 (실제 서비스에서는 DeepSeek가 판정)'),
      sub('몸판과의 연결 관계', grade(m.emptyCells,0.6,0.75),
        '거의 비어 있는 구역이 전체의 '+pc(m.emptyCells))
    ];

    base.scores={}; base.evidence={};
    AXES.forEach(function(a){
      var s=itemScore(r[a.id]);
      base.scores[a.id]=s.score;
      base.evidence[a.id]={status:'analyzed', subratings:r[a.id], earned_points:s.earned, max_points:s.max};
    });
    return base;
  }
  function buildDemoStage2(stage1){
    var out={analysis_source:'local_demo', diagnosis_id:stage1.diagnosis_id, advice:{}};
    AXES.forEach(function(a){
      var ev=stage1.evidence[a.id];
      if(ev) out.advice[a.id]=adviceFor(ev.subratings||[]);
    });
    return out;
  }

  /* ═══════════════════════════════════════════════════════════
     ② 패션 스케치 확인 — 수행계획서 "예외처리 방식" 흐름도와 동일
       confidence ≥ 0.8 : relevant면 통과, 아니면 거절(비패션 이미지)
       confidence < 0.8 : category 없으면 거절(비패션 이미지)
                          category 있고 confidence ≥ 0.4 → 사용자 재확인(화질 저하 등 의심)
                          confidence < 0.4 → 거절(관련성 매우 낮음)
     ═══════════════════════════════════════════════════════════ */
  function decideRelevance(rel){
    if(!rel) return {status:'reject', title:'응답을 확인할 수 없습니다', msg:'서버 응답에 관련성 판정이 없습니다.'};
    if(rel.confidence>=0.8){
      return rel.relevant ? {status:'pass'}
        : {status:'reject', title:'패션 스케치로 인식되지 않았습니다', msg:rel.reason||'의류 스케치가 아닌 이미지로 판정되었습니다.'};
    }
    if(!rel.category) return {status:'reject', title:'패션 스케치로 인식되지 않았습니다', msg:rel.reason||'의류 카테고리를 찾지 못했습니다.'};
    if(rel.confidence>=0.4) return {status:'unsure', title:'이미지를 다시 확인해 주세요', msg:(rel.reason||'화질이 낮거나 일부가 가려져 스케치인지 확실하지 않습니다.')+' 의류 스케치가 맞다면 진단을 계속 진행하세요.'};
    return {status:'reject', title:'관련성이 매우 낮은 이미지입니다', msg:rel.reason||'다른 이미지를 올려주세요.'};
  }

  /* ─────────── 결과 렌더 ─────────── */
  var hist=[];
  function tone(s){ return s==null?'na':(s<=50?'low':(s<=75?'mid':'')); }
  function scoreLabel(s){ return s==null?'판단 불가':s+'점'; }
  function ratingBadge(sr){
    if(sr.status!=='analyzed') return '<span class="rt rx">'+esc(SUB_LABEL[sr.status]||sr.status)+'</span>';
    return '<span class="rt r'+sr.rating+'">'+sr.rating+'점</span>';
  }

  /* 화면이 읽는 모양: {relevance, focus, scores:{id:0~100|null}, evidence:{id:{status, subratings[], advice}}}
     1단계·2단계 결과를 merge()로 합친 것. */
  function render(res){
    var focusSet={}; (res.focus||[]).forEach(function(id){ focusSet[id]=true; });
    var ranked=AXES.map(function(a){
      var s=res.scores[a.id], ev=res.evidence[a.id]||{};
      // 정렬: 점수 낮은 순. 사용자가 고른 항목은 15점 앞당겨 보여줌. 판단 불가는 맨 뒤
      var key=(s==null)?999:(focusSet[a.id]?s-15:s);
      return {a:a, s:s, ev:ev, key:key};
    }).sort(function(x,y){ return x.key-y.key; });

    var valid=ranked.filter(function(it){ return it.s!=null; });
    var top=valid[0];
    var avg=valid.length?Math.round(valid.reduce(function(t,it){ return t+it.s; },0)/valid.length):null;
    var rec={label:top?top.a.name:'—', avg:avg, scores:{}};
    AXES.forEach(function(a){ rec.scores[a.id]=res.scores[a.id]; });
    hist.push(rec);

    // TODO(Django 연동 지점): 서버 연동 후 '로컬 데모 응답' pill 삭제
    var h='<div class="pills"><span class="pill">로컬 데모 응답 · 서버 연동 전</span>'+
          '<span class="pill">카테고리 <b>'+esc(res.relevance.category||'—')+'</b></span>'+
          (avg!=null?'<span class="pill">평균 <b>'+avg+'점</b></span>':'')+'</div>';

    if(top){
      var worst=(top.ev.subratings||[]).filter(function(x){ return x.status==='analyzed'; })
        .sort(function(a,b){ return a.rating-b.rating; })[0];
      h+='<div class="lead"><div class="l">가장 먼저 볼 항목'+(focusSet[top.a.id]?' · 고민 반영':'')+'</div>'+
         '<h3>'+esc(top.a.name)+' <em>'+top.s+'점</em></h3>'+
         '<p>'+esc(top.ev.advice||'')+'</p>'+
         (worst?'<p class="why"><span>근거</span>'+esc(worst.criterion)+': '+esc(worst.observation)+'</p>':'')+
         '</div>';
    }

    ranked.forEach(function(it, idx){
      var c=tone(it.s);
      h+='<details class="axis'+(focusSet[it.a.id]?' f':'')+'"'+(idx===0?' open':'')+'>'+
         '<summary><div class="axis-top"><span class="nm">'+esc(it.a.name)+'</span>'+
         '<span class="pc '+c+'">'+scoreLabel(it.s)+'</span></div>'+
         '<div class="bar"><i class="'+c+'" data-w="'+(it.s==null?0:it.s)+'"></i></div></summary>'+
         '<ul class="subs">';
      (it.ev.subratings||[]).forEach(function(sr){
        h+='<li>'+ratingBadge(sr)+'<div><b>'+esc(sr.criterion)+'</b><p>'+esc(sr.observation)+'</p></div></li>';
      });
      if(it.ev.status==='not_analyzed') h+='<li><span class="rt rx">분석 안 함</span><div><p>'+esc(it.ev.reason||'')+'</p></div></li>';
      h+='</ul>'+
         (it.ev.max_points?'<p class="calc">유효 기준 '+(it.ev.max_points/2)+'개 · '+it.ev.earned_points+' / '+it.ev.max_points+'점 → '+scoreLabel(it.s)+'</p>':'')+
         '</details>';
    });
    p1.innerHTML=h;

    renderHistory();

    requestAnimationFrame(function(){
      p1.querySelectorAll('.bar i').forEach(function(f){ f.style.width=f.dataset.w+'%'; });
    });
  }

  /* 입력·출력 탭: 서버로 보내는 값과 단계별 응답 JSON을 그대로 보여준다 */
  function renderIO(stage1, stage2){
    var fid=focusIds().map(function(id){ return AXIS_BY_ID[id].name; });
    var h='<h4 class="io-h">입력</h4><table class="dl">'+
      '<tr><td>스케치 이미지</td><td>'+esc(fileLabel)+' ('+IW+' × '+IH+')</td></tr>'+
      '<tr><td>고민 글</td><td>'+(worryEl.value.trim()?esc(worryEl.value.trim()):'<span class="muted">없음</span>')+'</td></tr>'+
      '<tr><td>중점 항목 (focus)</td><td>'+(fid.length?esc(fid.join(', ')):'<span class="muted">없음</span>')+'</td></tr>'+
      '<tr><td>고정 프롬프트</td><td>1단계 채점 기준표 '+esc(stage1.criteria_version||'')+' / 2단계 리포트 작성 규칙</td></tr>'+
      '</table>'+
      '<h4 class="io-h">1단계 응답 — DeepSeek 분류·채점 + Django 점수 계산</h4>'+
      '<pre class="json">'+esc(JSON.stringify(stage1,null,2))+'</pre>'+
      '<h4 class="io-h" style="margin-top:16px">2단계 응답 — LLM 개선 문장</h4>'+
      '<pre class="json">'+esc(JSON.stringify(stage2,null,2))+'</pre>'+
      '<p class="hint-box">지금은 브라우저가 만든 데모 응답입니다. 서버가 같은 형식으로 응답하면 진단 탭이 그대로 그려집니다.</p>';
    p2.innerHTML=h;
  }

  function renderHistory(){
    var hh='<div class="rec">';
    hist.slice(-6).forEach(function(x,i,arr){
      var pv=arr[i-1], df=(pv&&pv.avg!=null&&x.avg!=null)?x.avg-pv.avg:null;
      hh+='<div class="row"><span class="n">'+(hist.length-arr.length+i+1)+'차 · 가장 약한 항목 '+esc(x.label)+'</span>'+
          '<span class="a">평균 '+(x.avg==null?'—':x.avg+'점')+(df===null?'':' <span class="'+(df>=0?'up':'down')+'">'+(df>=0?'▲':'▼')+Math.abs(df)+'</span>')+'</span></div>';
    });
    hh+='</div><p class="hint-box">스케치를 수정해 다시 올리면 항목별 점수 변화가 쌓입니다.</p>';
    p3.innerHTML=hh;
  }

  function showLoading(msg){ p1.innerHTML='<div class="load">'+esc(msg)+'<div class="t"><i></i></div></div>'; }
  function showError(){
    runBtn.disabled=false;
    p1.innerHTML='<div class="empty-r"><b>진단 요청을 처리하지 못했습니다</b><p>서버 응답이 없거나 형식이 맞지 않습니다. 잠시 후 다시 시도해 주세요.</p>'+
      '<button class="btn primary" id="retry">다시 시도</button></div>';
    document.getElementById('retry').onclick=function(){ runBtn.onclick(); };
  }

  /* 2단계(LLM)를 부르고 결과를 합쳐 그린다 */
  function finish(stage1){
    showLoading('2단계: 채점 결과로 개선 방향을 정리하는 중');
    runBtn.disabled=true;
    requestAdvice(stage1).then(function(stage2){
      runBtn.disabled=false;
      render(merge(stage1, stage2));
      renderIO(stage1, stage2);
    }).catch(showError);
  }

  runBtn.onclick=function(){
    if(!loaded) return;
    runBtn.disabled=true;
    showLoading('1단계: 패션 스케치인지 분류하고 항목별로 채점하는 중');

    requestDiagnosis().then(function(stage1){
      var d=decideRelevance(stage1.relevance);
      runBtn.disabled=false;
      if(d.status==='reject'){
        // 거절이면 2단계(LLM)는 호출하지 않는다
        p1.innerHTML='<div class="empty-r"><b>'+esc(d.title)+'</b><p>'+esc(d.msg)+'</p></div>';
        return;
      }
      if(d.status==='unsure'){
        p1.innerHTML='<div class="empty-r"><b>'+esc(d.title)+'</b><p>'+esc(d.msg)+'</p>'+
          '<button class="btn primary" id="confirmProceed">스케치가 맞아요, 진단 보기</button></div>';
        // 사용자가 확인한 뒤에만 2단계를 부른다
        document.getElementById('confirmProceed').onclick=function(){ finish(stage1); };
        return;
      }
      finish(stage1);
    }).catch(showError);
  };

  route();
  apply();
})();
