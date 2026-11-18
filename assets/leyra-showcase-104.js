(function(){'use strict';
const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
 // 首屏世界地图：点阵大陆 + 两种状态(示例地址)。经纬度按等距投影换成画布坐标
 (function(){
  var geo=document.getElementById('geo');if(!geo)return;
  var NS='http://www.w3.org/2000/svg',W=1000,H=470,LAT0=82,LAT1=-56;
  function P(lon,lat){return [(lon+180)/360*W,(LAT0-lat)/(LAT0-LAT1)*H]}
  function el(n,a,p){var e=document.createElementNS(NS,n);for(var k in a)e.setAttribute(k,a[k]);if(p)p.appendChild(e);return e}
  // 粗略的大陆轮廓(经度，纬度),只用来生成点阵
  var LAND=[
   [[-168,66],[-162,70],[-140,70],[-120,72],[-95,72],[-80,73],[-65,68],[-60,58],[-55,52],[-66,45],[-70,42],[-76,38],[-80,32],[-81,25],[-84,30],[-90,29],[-97,26],[-97,22],[-92,18],[-87,21],[-88,16],[-83,10],[-79,8],[-80,7],[-86,12],[-92,14],[-100,17],[-105,20],[-110,23],[-112,30],[-117,32],[-120,34],[-124,40],[-124,48],[-130,54],[-138,59],[-150,60],[-158,57],[-165,60]],
   [[-55,60],[-43,60],[-20,70],[-18,77],[-30,83],[-60,82],[-70,78],[-55,70]],
   [[-80,8],[-72,12],[-62,10],[-50,0],[-35,-5],[-38,-13],[-40,-22],[-48,-28],[-58,-38],[-65,-42],[-68,-52],[-72,-50],[-74,-42],[-72,-30],[-71,-18],[-76,-14],[-81,-5],[-80,0],[-78,7]],
   [[-10,36],[-9,43],[-2,44],[-5,48],[2,51],[8,54],[8,57],[5,62],[12,66],[20,70],[30,71],[40,68],[45,66],[60,68],[60,55],[50,45],[40,42],[30,41],[26,38],[22,37],[20,40],[16,38],[12,44],[10,44],[3,43],[-1,37]],
   [[-6,50],[2,51],[0,53],[-2,56],[-5,58],[-6,55],[-3,54],[-5,52]],
   [[-17,21],[-10,30],[-6,35],[10,37],[20,32],[32,31],[35,28],[43,12],[51,12],[42,-2],[40,-12],[35,-24],[32,-29],[20,-35],[18,-30],[12,-17],[13,-5],[9,4],[-5,5],[-13,8],[-17,15]],
   [[44,-25],[47,-25],[50,-15],[48,-13],[43,-20]],
   [[26,38],[36,36],[35,30],[43,13],[52,16],[57,23],[60,25],[66,25],[70,21],[73,16],[77,8],[80,13],[80,16],[87,22],[92,22],[94,17],[98,10],[100,4],[104,1],[103,10],[106,10],[109,12],[108,17],[106,21],[110,20],[117,23],[121,28],[122,31],[119,35],[122,37],[121,40],[125,40],[129,35],[130,43],[140,48],[142,54],[135,55],[140,60],[155,60],[163,62],[170,65],[180,66],[180,72],[140,73],[110,77],[100,78],[80,73],[70,73],[60,70],[45,68],[40,68],[30,71],[28,60],[30,50],[40,42],[30,41]],
   [[130,31],[132,34],[135,34],[140,35],[141,40],[140,45],[142,45],[145,43],[141,41],[142,38],[140,36],[136,33]],
   [[95,5],[98,4],[106,-6],[102,-4]],[[109,1],[111,-3],[116,-4],[119,1],[117,7],[113,3]],[[106,-6],[114,-7],[114,-9],[106,-8]],
   [[131,-1],[141,-3],[150,-10],[141,-9],[137,-5]],[[120,18],[122,18],[126,8],[124,6],[121,12]],[[120,22],[122,25],[121,25]],
   [[113,-22],[114,-34],[118,-35],[123,-34],[130,-31],[135,-35],[138,-35],[141,-38],[147,-39],[150,-37],[153,-29],[153,-25],[146,-19],[143,-11],[141,-13],[136,-12],[132,-11],[129,-15],[125,-14],[122,-18]],
   [[172,-34],[178,-38],[174,-41],[167,-46],[171,-44],[174,-39]]
  ];
  function inside(x,y,poly){var c=false;for(var i=0,j=poly.length-1;i<poly.length;j=i++){var a=poly[i],b=poly[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])c=!c}return c}
  var land=document.getElementById('geo-land'),frag=document.createDocumentFragment();
  for(var lat=LAT0-1;lat>LAT1;lat-=2.6)for(var lon=-178;lon<180;lon+=2.6){
   for(var i=0;i<LAND.length;i++)if(inside(lon,lat,LAND[i])){var p=P(lon,lat);el('circle',{cx:p[0].toFixed(1),cy:p[1].toFixed(1),r:2.1,'class':'land'},frag);break}
  }
  land.appendChild(frag);
  // 地点：你(伦敦，示例)、Claude(旧金山)、独享 IP(洛杉矶),普通节点的出口城市
  var YOU=[-0.1,51.5],CLAUDE=[-122.4,37.8],IP=[-118.2,34];
  var NODES=[['东京',139.7,35.7,'198.51.100.23'],['新加坡',103.8,1.35,'203.0.113.77'],['香港',114.2,22.3,'192.0.2.58'],['迪拜',55.3,25.2,'203.0.113.201'],['首尔',127,37.5,'198.51.100.140']];
  var cities=document.getElementById('geo-cities'),pins=document.getElementById('geo-pins'),arcs=document.getElementById('geo-arcs');
  var cityEls=NODES.map(function(n){var p=P(n[1],n[2]),g=el('g',{'class':'city fade'},cities);el('circle',{cx:p[0],cy:p[1],r:4,'class':'ring'},g);el('circle',{cx:p[0],cy:p[1],r:3.6,'class':'c'},g);el('text',{x:p[0],y:p[1]-10,'text-anchor':'middle'},g).textContent=n[0];return g});
  function pin(pt,label,cls,dy){var p=P(pt[0],pt[1]),g=el('g',{'class':'pin '+cls},pins);el('circle',{cx:p[0],cy:p[1],r:11,'class':'halo'},g);el('circle',{cx:p[0],cy:p[1],r:5,'class':'dot'},g);el('text',{x:p[0],y:p[1]+dy,'text-anchor':'middle'},g).textContent=label;return g}
  pin(YOU,'你','you',-14);pin(CLAUDE,'Claude','claude',-14);var ipPin=pin(IP,'你的 IP','ip fade',24);
  // 两点之间向上拱起的弧线(距离越远拱得越高)
  function arc(a,b){var p=P(a[0],a[1]),q=P(b[0],b[1]),mx=(p[0]+q[0])/2,my=(p[1]+q[1])/2,d=Math.hypot(q[0]-p[0],q[1]-p[1]);return 'M'+p[0].toFixed(1)+' '+p[1].toFixed(1)+' Q'+mx.toFixed(1)+' '+(my-d*.32).toFixed(1)+' '+q[0].toFixed(1)+' '+q[1].toFixed(1)}
  var ipEl=document.getElementById('geo-ip'),tip=document.getElementById('geo-tip'),btns=[].slice.call(geo.querySelectorAll('.geo-sw button'));
  var mode='bad',k=0,tick=null,cycle=null,raf=[];
  function clear(){arcs.textContent='';raf.forEach(function(f){f.stop=true});raf=[]}
  // 光点沿路径流动(requestAnimationFrame)
  function flow(path,n,dur,color){var len=path.getTotalLength(),dots=[],h={stop:false};raf.push(h);for(var i=0;i<n;i++)dots.push(el('circle',{r:3.6,fill:color},arcs));var t0=performance.now();(function f(t){if(h.stop)return;var s=((t-t0)/dur)%1;dots.forEach(function(d,i){var pt=path.getPointAtLength(((s+i/n)%1)*len);d.setAttribute('cx',pt.x);d.setAttribute('cy',pt.y)});requestAnimationFrame(f)})(t0)}
  function hop(){
   var idx=k%NODES.length,n=NODES[idx],c=cityEls[idx];k++;
   clear();cityEls.forEach(function(e){e.classList.remove('dim')});
   el('path',{d:arc(YOU,[n[1],n[2]]),'class':'arc bad'},arcs);var p2=el('path',{d:arc([n[1],n[2]],CLAUDE),'class':'arc bad'},arcs);
   c.classList.remove('hit');void c.getBBox();c.classList.add('hit');
   ipEl.textContent=n[3]+' · '+n[0];ipEl.className='bad';tip.textContent='IP 反复横跳，增加账号被封号的风险';
   if(!reduce)flow(p2,1,1400,'#F2B45A');
  }
  function steady(){
   clear();cityEls.forEach(function(e){e.classList.add('dim')});
   var a=arc(YOU,IP),b=arc(IP,CLAUDE);
   el('path',{d:a,'class':'arc glow'},arcs);el('path',{d:b,'class':'arc glow'},arcs);
   var pa=el('path',{d:a,'class':'arc good'},arcs),pb=el('path',{d:b,'class':'arc good'},arcs);
   ipEl.textContent='203.0.113.10 · 美国';ipEl.className='good';tip.textContent='每次都是同一个你，降低被封号的风险';
   if(!reduce){flow(pa,3,2200,'#8FD0FF');flow(pb,2,1100,'#8FD0FF')}
  }
  function set(m){mode=m;btns.forEach(function(b){b.classList.toggle('on',b.dataset.m===m);b.setAttribute('aria-pressed',String(b.dataset.m===m))});ipPin.style.opacity=m==='good'?1:.25;clearInterval(tick);if(m==='bad'){hop();if(!reduce)tick=setInterval(hop,1300)}else steady()}
  btns.forEach(function(b){b.addEventListener('click',function(){clearInterval(cycle);cycle=null;set(b.dataset.m)})});
  set('bad');
  // 自动来回切：普通节点 6.5 秒，Leyra 6.5 秒；用户点过切换就不再自动切
  if(!reduce)cycle=setInterval(function(){set(mode==='bad'?'good':'bad')},6500);
 })();
 // 客户端截图轮播:5 秒一张，鼠标停在上面暂停，点标签或箭头切换，手机左右滑
 (function(){
  var box=document.getElementById('shots');if(!box)return;
  var tabs=[].slice.call(box.querySelectorAll('.shot-tabs button')),imgs=[].slice.call(box.querySelectorAll('.stage img')),cap=box.querySelector('.shot-cap');
  var caps=['<b>首页</b>：连上就显示「实时守护中」，Claude 看到的 IP、今天变过没有一眼可见','<b>线路不对先拦截</b>：线路不对就先拦住 Claude，其他网站照常；原因、归谁写在原因条上，截图发客服就够','<b>诊断与记录</b>：你的网络身份、逐项检查、到独享 IP 的延迟，出问题一键复制报告给客服','<b>节点</b>：贴上节点订阅，自动选最快，掉了自动换','<b>分流规则</b>：自定义需要走独享出口的域名与 Mac 应用'];
  var cur=0,timer=null,DUR=5000;
  function show(i){cur=(i+imgs.length)%imgs.length;imgs.forEach(function(m,k){m.classList.toggle('on',k===cur)});tabs.forEach(function(t,k){t.classList.remove('on');void t.offsetWidth;if(k===cur)t.classList.add('on')});tabs.forEach(function(t,k){t.setAttribute('aria-pressed',String(k===cur))});cap.innerHTML=caps[cur];if(!reduce)restart()}
  function restart(){clearTimeout(timer);if(!box.classList.contains('paused'))timer=setTimeout(function(){show(cur+1)},DUR)}
  box.style.setProperty('--dur',DUR/1000+'s');
  tabs.forEach(function(t,k){t.addEventListener('click',function(){show(k)})});
  box.querySelector('.arr.l').addEventListener('click',function(){show(cur-1)});
  box.querySelector('.arr.r').addEventListener('click',function(){show(cur+1)});
  var frame=box.querySelector('.frame');
  frame.addEventListener('mouseenter',function(){box.classList.add('paused');clearTimeout(timer)});
  frame.addEventListener('mouseleave',function(){box.classList.remove('paused');if(!reduce)restart()});
  var x0=null;frame.addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});
  frame.addEventListener('touchend',function(e){if(x0===null)return;var dx=e.changedTouches[0].clientX-x0;if(Math.abs(dx)>40)show(cur+(dx<0?1:-1));x0=null});
  show(0);
 })();

})();
