(function(){
"use strict";

/* House rules come from the server (src/lib.js). These are only first-paint defaults. */
var CONFIG = {
  eventLeadDays:3, eventMaxDays:7, practiceLeadDays:1, practiceWindowDays:14,
  practiceFromHour:16, practiceToHour:22, practiceMaxHours:2, dayFromHour:8, dayToHour:24, maxSlotsPerRequest:10
};
var DEFAULTS = [
  {id:"dept-lights",name:"Department of Lights",group:"lights",kind:"department",qty:1},
  {id:"equip-lights",name:"Lights Equipment",group:"lights",kind:"equipment",qty:1},
  {id:"dept-sounds",name:"Department of Sounds",group:"sound",kind:"department",qty:1},
  {id:"equip-sounds",name:"Sounds Equipment",group:"sound",kind:"equipment",qty:1}
];
var S = {
  tab:"book", sub:"queue", me:null, ready:false, googleClientId:"", domain:"", loadErr:null,
  resources:DEFAULTS.slice(), fests:[], bookings:[],
  ev:{club:"", title:"", date:"", start:"18:00", end:"21:00", items:{}},
  pr:{festId:"", club:"", title:"", date:"", hours:[], slots:[], items:{}},
  fs:{name:"", start:"", end:""},
  sched:{date:""}, flash:null, confirm:null, busy:false, showStaff:false, pw:""
};
var session=null, staffToken=null, lastSig="", app=document.getElementById("app");
try{ session=localStorage.getItem("atd.session"); staffToken=localStorage.getItem("atd.staff"); }catch(e){}
try{ var savedClub=localStorage.getItem("atd.club"); if(savedClub){S.ev.club=savedClub;S.pr.club=savedClub;} }catch(e){}
function store(k,v){try{ if(v==null) localStorage.removeItem(k); else localStorage.setItem(k,v);}catch(e){}}

/* ---- helpers ---- */
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
function pad(n){return String(n).padStart(2,"0");}
function iso(d){return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());}
function parse(s){var p=s.split("-").map(Number);return new Date(p[0],p[1]-1,p[2]);}
function addDays(s,n){var d=parse(s);d.setDate(d.getDate()+n);return iso(d);}
function today(){return iso(new Date());}
function toMin(t){var p=t.split(":").map(Number);return p[0]*60+p[1];}
function fmtT(m){return pad(Math.floor(m/60))+":"+pad(m%60);}
function fmtD(s){return parse(s).toLocaleDateString("en-IN",{weekday:"short",day:"numeric",month:"short"});}
function fmtDL(s){return parse(s).toLocaleDateString("en-IN",{weekday:"long",day:"numeric",month:"long"});}
function cue(b){return "Q-"+String(b.id).slice(0,4).toUpperCase();}
function resById(id){return S.resources.find(function(r){return r.id===id;});}
function blocking(b){return b.status==="pending"||b.status==="approved";}
function isStaff(){return !!(S.me&&S.me.staff);}
function statusText(s){return {pending:"Awaiting approval",approved:"Approved",rejected:"Declined",cancelled:"Cancelled"}[s]||s;}
function sortRes(a,b){ if(a.kind!==b.kind) return a.kind==="department"?-1:1; return String(a.name).localeCompare(String(b.name)); }
function itemsText(items){
  return Object.keys(items||{}).map(function(id){var r=resById(id);return esc(r?r.name:"Removed item");}).join(", ");
}
function usedQty(resId,date,s,e,excludeId,onlyApproved){
  return S.bookings.reduce(function(a,b){
    if(b.id===excludeId||b.date!==date) return a;
    if(onlyApproved? b.status!=="approved" : !blocking(b)) return a;
    if(!(b.startMin<e&&b.endMin>s)) return a;
    return a+((b.items&&b.items[resId])||0);
  },0);
}
function freeQty(r,date,s,e,excludeId,onlyApproved){return r.qty-usedQty(r.id,date,s,e,excludeId,onlyApproved);}
function conflicts(b){
  var out=[];
  Object.keys(b.items||{}).forEach(function(id){
    var r=resById(id); if(!r) return;
    if(b.items[id]>freeQty(r,b.date,b.startMin,b.endMin,b.id,true)) out.push(r.name+" is already held by an approved booking at this time.");
  });
  return out;
}
function setPath(path,val){var p=path.split(".");S[p[0]][p[1]]=val;}

/* ---- API ---- */
async function api(path,opt){
  opt=opt||{};
  var h={"content-type":"application/json"};
  if(session) h["authorization"]="Bearer "+session;
  if(staffToken) h["x-staff-token"]=staffToken;
  var res=await fetch("/api/"+path,{method:opt.method||"GET",headers:h,body:opt.body?JSON.stringify(opt.body):undefined});
  var data=null; try{data=await res.json();}catch(e){}
  if(res.status===401&&path!=="login"){ signOutLocal(); }
  if(!res.ok) throw new Error((data&&data.error)||"Something went wrong. Try again.");
  return data;
}
function signOutLocal(){session=null;staffToken=null;store("atd.session",null);store("atd.staff",null);S.me=null;S.showStaff=false;lastSig="";}
async function load(quiet){
  try{
    var d=await api("state");
    var sig=JSON.stringify([d.me,d.fests,d.bookings]);
    if(d.me&&!d.me.staff&&staffToken){staffToken=null;store("atd.staff",null);}
    S.me=d.me; S.loadErr=null;
    if(sig!==lastSig){lastSig=sig;S.fests=d.fests;S.bookings=d.bookings;schedule();}
  }catch(e){ if(!quiet){S.loadErr=e.message;} schedule(); }
}

/* ---- views ---- */
function pickerHTML(prefix,form,win){
  var html='<header><h2>What do you need?</h2><p class="hint">Tick the departments and equipment you want for this booking.</p></header>';
  [["lights","Lights"],["sound","Sounds"]].forEach(function(g){
    var rs=S.resources.filter(function(r){return r.group===g[0];}).sort(sortRes);
    html+='<fieldset class="grp g-'+g[0]+'"><legend>'+g[1]+'</legend>';
    rs.forEach(function(r){
      var chosen=form.items[r.id]||0;
      var free=win?freeQty(r,win.date,win.s,win.e):null;
      var cls="av",txt;
      if(free===null){txt="Pick a time to check";}
      else if(free<=0){cls+=" none";txt="Taken";}
      else {txt="Free";}
      var dis=(free!==null&&free<=0&&!chosen);
      html+='<label class="res'+(dis?" disabled":"")+'"><input type="checkbox" id="'+prefix+'-r-'+esc(r.id)+'" data-res="'+prefix+':'+esc(r.id)+'"'+(chosen?" checked":"")+(dis?" disabled":"")+'>'
        +'<span class="nm">'+esc(r.name)+'</span><span class="'+cls+'">'+txt+'</span></label>';
    });
    html+='</fieldset>';
  });
  if(!win) html+='<p class="hint">Pick the date and time to see what is free.</p>';
  return html;
}

function bookView(){
  var f=S.ev, min=addDays(today(),CONFIG.eventLeadDays), max=addDays(today(),CONFIG.eventMaxDays);
  var win=(f.date&&f.start&&f.end&&toMin(f.end)>toMin(f.start))?{date:f.date,s:toMin(f.start),e:toMin(f.end)}:null;
  return '<div class="cols"><section class="panel"><header><h2>Book for an event</h2><p class="hint">Reserve the Department of Lights, the Department of Sounds and their equipment for a show. Book up to '+CONFIG.eventMaxDays+' days ahead, with at least '+CONFIG.eventLeadDays+' days notice. Requests are reviewed by the stage controls departments.</p></header>'
    +'<div class="field"><label for="ev-club">Club or department</label><input type="text" id="ev-club" data-bind="ev.club" autocomplete="organization" placeholder="e.g. Mime Club, Dance Club" value="'+esc(f.club)+'"></div>'
    +'<div class="field"><label for="ev-title">Event name</label><input type="text" id="ev-title" data-bind="ev.title" placeholder="eg. practice slot" value="'+esc(f.title)+'"></div>'
    +'<div class="field"><label for="ev-date">Date</label><input type="date" id="ev-date" data-bind="ev.date" data-rr="1" min="'+min+'" max="'+max+'" value="'+esc(f.date)+'"><span class="hint">Open from '+fmtD(min)+' to '+fmtD(max)+'.</span></div>'
    +'<div class="row2"><div class="field"><label for="ev-start">From</label><input type="time" id="ev-start" data-bind="ev.start" data-rr="1" value="'+esc(f.start)+'"></div>'
    +'<div class="field"><label for="ev-end">Until</label><input type="time" id="ev-end" data-bind="ev.end" data-rr="1" value="'+esc(f.end)+'"></div></div>'
    +'<div class="actions"><button class="btn" data-act="submit-ev"'+(S.busy?" disabled":"")+'>Send request</button><span class="hint">Setup and strike time count as booked time.</span></div>'
    +'</section><section class="panel">'+pickerHTML("ev",f,win)+'</section></div>';
}

function allSlots(f){
  var out=f.slots.slice();
  if(f.hours.length&&f.date) out.push({date:f.date,startMin:f.hours[0]*60,endMin:(f.hours[f.hours.length-1]+1)*60});
  return out;
}
function upcomingFests(){return S.fests.filter(function(f){return f.start>today();}).sort(function(a,b){return a.start<b.start?-1:1;});}
function prWindow(f){
  if(!f) return null;
  var lo=addDays(f.start,-CONFIG.practiceWindowDays), hi=addDays(f.start,-1), earliest=addDays(today(),CONFIG.practiceLeadDays);
  return {lo:lo>earliest?lo:earliest, hi:hi, closed:hi<earliest};
}
function hourCount(date,h){
  return S.bookings.filter(function(b){return blocking(b)&&b.date===date&&b.startMin<(h+1)*60&&b.endMin>h*60;}).length;
}
function practiceView(){
  var fests=upcomingFests();
  if(!fests.length){
    return '<div class="empty"><b>No fests announced</b>Practice slots open once the stage controls departments add a fest. You can book up to '+CONFIG.practiceWindowDays+' days before it starts.</div>';
  }
  var f=S.pr;
  if(!fests.some(function(x){return x.id===f.festId;})) f.festId=fests[0].id;
  var fest=fests.filter(function(x){return x.id===f.festId;})[0], w=prWindow(fest);
  var opts=fests.map(function(x){return '<option value="'+esc(x.id)+'"'+(x.id===f.festId?" selected":"")+'>'+esc(x.name)+' · starts '+fmtD(x.start)+'</option>';}).join("");
  var left='<section class="panel"><header><h2>Book a practice slot</h2><p class="hint">Rehearse on stage with real lights and sound in the '+CONFIG.practiceWindowDays+' days before a fest. Slots are 2 hours by default.</p></header>'
    +'<div class="field"><label for="pr-fest">Fest</label><select id="pr-fest" data-bind="pr.festId" data-rr="1">'+opts+'</select></div>';
  var win=null;
  if(w.closed){
    left+='<div class="flash info" style="margin:0">The practice window for '+esc(fest.name)+' has closed. It ran until '+fmtD(w.hi)+'.</div></section>';
  }else{
    left+='<div class="field"><label for="pr-date">Practice date</label><input type="date" id="pr-date" data-bind="pr.date" data-rr="1" min="'+w.lo+'" max="'+w.hi+'" value="'+esc(f.date)+'"><span class="hint">Open from '+fmtD(w.lo)+' to '+fmtD(w.hi)+'.</span></div>';
    var dateOk=f.date&&f.date>=w.lo&&f.date<=w.hi;
    if(dateOk){
      var chips="";
      for(var h=CONFIG.practiceFromHour;h<CONFIG.practiceToHour;h++){
        var n=hourCount(f.date,h);
        chips+='<button type="button" class="chip" data-act="hour" data-h="'+h+'" aria-pressed="'+(f.hours.indexOf(h)>=0)+'">'+pad(h)+':00<small>'+(n?n+" booked":"open")+'</small></button>';
      }
      left+='<div class="field"><span class="lbl">Hours on '+fmtD(f.date)+'</span><div class="chips">'+chips+'</div><span class="hint">Tap a start hour to take a 2-hour slot. Tap the second hour to shorten it to 1 hour.</span></div>'
        +'<div class="actions"><button class="btn ghost sm" data-act="add-slot"'+(f.hours.length?"":" disabled")+'>Add this slot to the request</button><span class="hint">Pick another day or hour to add more, up to '+CONFIG.maxSlotsPerRequest+' slots.</span></div>';
      if(f.hours.length) win={date:f.date,s:f.hours[0]*60,e:(f.hours[f.hours.length-1]+1)*60};
    }
    if(f.slots.length){
      left+='<div class="field"><span class="lbl">Slots in this request ('+f.slots.length+')</span><div class="chips">'
        +f.slots.map(function(sl,i){return '<button type="button" class="chip" data-act="rm-slot" data-i="'+i+'" title="Remove this slot" aria-label="Remove slot '+esc(fmtD(sl.date))+' '+fmtT(sl.startMin)+'">'+esc(fmtD(sl.date))+'<small>'+fmtT(sl.startMin)+'–'+fmtT(sl.endMin)+' ✕</small></button>';}).join("")
        +'</div></div>';
    }
    left+='<div class="field"><label for="pr-club">Club or department</label><input type="text" id="pr-club" data-bind="pr.club" autocomplete="organization" placeholder="e.g. Dance Club, Mime Club" value="'+esc(f.club)+'"></div>'
      +'<div class="field"><label for="pr-title">What are you practising?</label><input type="text" id="pr-title" data-bind="pr.title" placeholder="Cue run, sound check, full dress" value="'+esc(f.title)+'"></div>'
      +'<div class="actions"><button class="btn" data-act="submit-pr"'+(S.busy?" disabled":"")+'>Send request'+(allSlots(f).length>1?' ('+allSlots(f).length+' slots)':'')+'</button></div></section>';
  }
  return '<div class="cols">'+left+(w.closed?"":'<section class="panel">'+pickerHTML("pr",f,win)+'</section>')+'</div>';
}

function laneLayout(list){
  var ends=[],out=[];
  list.slice().sort(function(a,b){return a.startMin-b.startMin;}).forEach(function(b){
    var i=ends.findIndex(function(x){return x<=b.startMin;});
    if(i<0){i=ends.length;ends.push(0);}
    ends[i]=b.endMin; out.push([b,i]);
  });
  return {items:out,lanes:Math.max(ends.length,1)};
}
function scheduleView(){
  if(!S.sched.date) S.sched.date=today();
  var d=S.sched.date, from=CONFIG.dayFromHour*60, to=CONFIG.dayToHour*60, span=to-from, n=CONFIG.dayToHour-CONFIG.dayFromHour;
  var day=S.bookings.filter(function(b){return b.date===d&&blocking(b);}).sort(function(a,b){return a.startMin-b.startMin;});
  var html='<div class="daybar"><div class="dl">'+esc(fmtDL(d))+'</div>'
    +'<button class="btn ghost sm" data-act="day" data-n="-1" aria-label="Previous day">← Prev</button>'
    +'<button class="btn ghost sm" data-act="day" data-n="0">Today</button>'
    +'<button class="btn ghost sm" data-act="day" data-n="1" aria-label="Next day">Next →</button>'
    +'<input type="date" id="sc-date" data-bind="sched.date" data-rr="1" value="'+esc(d)+'" aria-label="Pick a date"></div>';
  var hrs="";for(var h=CONFIG.dayFromHour;h<CONFIG.dayToHour;h++)hrs+="<span>"+pad(h)+"</span>";
  var tl='<div class="tl" style="--n:'+n+'"><div class="r"><div class="lab"></div><div class="hrs">'+hrs+'</div></div>';
  [["lights","Lights"],["sound","Sounds"]].forEach(function(g){
    var rs=S.resources.filter(function(r){return r.group===g[0];}).sort(sortRes);
    if(!rs.length) return;
    tl+='<div class="r gh g-'+g[0]+'"><div class="lab">'+g[1]+'</div><div class="trk" style="height:8px;background:none"></div></div>';
    rs.forEach(function(r){
      var mine=day.filter(function(b){return b.items&&b.items[r.id];});
      var L=laneLayout(mine), h2=L.lanes*26+8;
      var bars=L.items.map(function(p){
        var b=p[0],i=p[1], left=Math.max(0,(b.startMin-from)/span*100), w=(Math.min(b.endMin,to)-Math.max(b.startMin,from))/span*100;
        return '<div class="bar '+b.status+'" style="left:'+left+'%;width:'+w+'%;top:'+(4+i*26)+'px" title="'+esc(b.club+" · "+b.title+" · "+fmtT(b.startMin)+"–"+fmtT(b.endMin)+" · "+statusText(b.status))+'">'+esc(b.club)+'</div>';
      }).join("");
      tl+='<div class="r g-'+g[0]+'"><div class="lab"><span>'+esc(r.name)+'</span></div><div class="trk" style="height:'+h2+'px">'+bars+'</div></div>';
    });
  });
  tl+="</div>";
  html+='<div class="tlwrap">'+tl+'</div><div class="legend"><span><i></i>Approved</span><span><i class="p"></i>Awaiting approval, still holds the slot</span></div>';
  html+='<h3 style="margin-bottom:12px">Bookings on this day</h3>';
  html+= day.length? '<div class="list">'+day.map(function(b){return bookingCard(b,{});}).join("")+'</div>' : '<div class="empty"><b>Nothing booked</b>The auditorium is free all day.</div>';
  return html;
}

function bookingCard(b,opt){
  var h='<article class="bk '+(b.type==="practice"?"practice":"")+'"><div class="hd"><span class="cue">'+cue(b)+'</span><span class="pill '+b.status+'">'+statusText(b.status)+'</span>'
    +'<span class="pill" style="background:var(--soft)">'+(b.type==="practice"?"Practice":"Event")+'</span></div>'
    +'<div class="ttl">'+esc(b.club)+' · '+esc(b.title)+'</div>'
    +'<div class="when">'+esc(fmtD(b.date))+' · '+fmtT(b.startMin)+'–'+fmtT(b.endMin)+'</div>'
    +'<div class="items">'+itemsText(b.items)+'</div>';
  if(b.festId){var fe=S.fests.filter(function(x){return x.id===b.festId;})[0]; if(fe) h+='<div class="hint">Practice for '+esc(fe.name)+'</div>';}
  if(opt.who) h+='<div class="hint">Requested by '+esc(b.createdByName||b.createdBy)+' ('+esc(b.createdBy)+')</div>';
  if(b.note) h+='<div class="hint">Note from the desk: '+esc(b.note)+'</div>';
  if(opt.conf&&opt.conf.length) h+=opt.conf.map(function(c){return '<div class="warn">⚠ '+esc(c)+'</div>';}).join("");
  var acts="";
  if(opt.queue){
    h+='<div class="field"><label for="note-'+esc(b.id)+'">Note to the club (optional)</label><input type="text" id="note-'+esc(b.id)+'"></div>';
    acts+='<button class="btn sm" data-act="approve" data-id="'+esc(b.id)+'"'+((opt.conf&&opt.conf.length)||S.busy?" disabled":"")+'>Approve</button>'
      +'<button class="btn danger sm" data-act="reject" data-id="'+esc(b.id)+'"'+(S.busy?" disabled":"")+'>Decline</button>';
  }
  if(opt.cancel&&blocking(b)){
    acts+= S.confirm==="cancel:"+b.id
      ? '<button class="btn danger sm" data-act="cancel" data-id="'+esc(b.id)+'">Yes, cancel this booking</button><button class="btn ghost sm" data-act="noconfirm">Keep it</button>'
      : '<button class="btn ghost sm" data-act="cancel" data-id="'+esc(b.id)+'">Cancel booking</button>';
  }
  if(acts) h+='<div class="actions">'+acts+'</div>';
  return h+'</article>';
}

function mineView(){
  var mine=S.bookings.filter(function(b){return S.me&&b.createdBy===S.me.email;}).sort(function(a,b){return a.date<b.date?1:a.date>b.date?-1:b.startMin-a.startMin;});
  if(!mine.length) return '<div class="empty"><b>No bookings yet</b>Requests you send show up here with their status.</div>';
  var t=today(), up=mine.filter(function(b){return b.date>=t;}).reverse(), past=mine.filter(function(b){return b.date<t;});
  var h='';
  if(up.length) h+='<h3 style="margin-bottom:12px">Upcoming</h3><div class="list">'+up.map(function(b){return bookingCard(b,{cancel:true});}).join("")+'</div>';
  if(past.length) h+='<h3 style="margin:26px 0 12px">Past</h3><div class="list">'+past.map(function(b){return bookingCard(b,{});}).join("")+'</div>';
  return h;
}

function deskView(){
  var subs=[["queue","Approvals"],["fests","Fests"]];
  var h='<div class="sub" role="tablist">'+subs.map(function(s){return '<button role="tab" data-act="sub" data-v="'+s[0]+'" aria-selected="'+(S.sub===s[0])+'">'+s[1]+'</button>';}).join("")+'</div>';
  if(S.sub==="queue"){
    var q=S.bookings.filter(function(b){return b.status==="pending";}).sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.startMin-b.startMin;});
    h+= q.length? '<div class="list">'+q.map(function(b){return bookingCard(b,{queue:true,who:true,conf:conflicts(b)});}).join("")+'</div>'
      : '<div class="empty"><b>Queue is clear</b>New requests appear here for approval.</div>';
  }
  if(S.sub==="fests"){
    var fl=S.fests.slice().sort(function(a,b){return a.start<b.start?-1:1;}).map(function(f){
      return '<tr><td>'+esc(f.name)+'</td><td class="mono">'+esc(f.start)+' → '+esc(f.end)+'</td><td class="small">Practice '+esc(fmtD(addDays(f.start,-CONFIG.practiceWindowDays)))+' – '+esc(fmtD(addDays(f.start,-1)))+'</td>'
        +'<td>'+(S.confirm==="fest:"+f.id?'<button class="btn danger sm" data-act="del-fest" data-id="'+esc(f.id)+'">Remove</button> <button class="btn ghost sm" data-act="noconfirm">Keep</button>':'<button class="btn ghost sm" data-act="del-fest" data-id="'+esc(f.id)+'">Remove</button>')+'</td></tr>';
    }).join("");
    h+='<div class="cols"><section class="panel"><header><h2>Fests</h2><p class="hint">Practice slots open for each fest in the '+CONFIG.practiceWindowDays+' days before its first day.</p></header>'
      +(fl?'<div class="tblwrap"><table class="tbl"><thead><tr><th>Fest</th><th>Dates</th><th>Practice window</th><th></th></tr></thead><tbody>'+fl+'</tbody></table></div>':'<div class="empty"><b>No fests yet</b>Add the first one to open practice booking.</div>')+'</section>'
      +'<section class="panel"><header><h3>Add a fest</h3></header>'
      +'<div class="field"><label for="fs-name">Fest name</label><input type="text" id="fs-name" data-bind="fs.name" value="'+esc(S.fs.name)+'"></div>'
      +'<div class="row2"><div class="field"><label for="fs-start">First day</label><input type="date" id="fs-start" data-bind="fs.start" value="'+esc(S.fs.start)+'"></div>'
      +'<div class="field"><label for="fs-end">Last day</label><input type="date" id="fs-end" data-bind="fs.end" value="'+esc(S.fs.end)+'"></div></div>'
      +'<div class="actions"><button class="btn" data-act="add-fest">Add fest</button></div></section></div>';
  }
  return h;
}

function loginView(){
  var msg;
  if(!S.ready) msg='<p class="hint">Loading…</p>';
  else if(!S.googleClientId) msg='<div class="flash err" style="margin:0">Sign-in is not set up yet. Set GOOGLE_CLIENT_ID for this site.</div>';
  else msg='<div id="gbtn"></div><p class="hint">Use your college Google account'+(S.domain?' (@'+esc(S.domain)+')':'')+'.</p>';
  return '<header class="top"><h1>Main Audi Bookings Portal</h1><p>Book the Departments of Lights and Sounds and their equipment for your event, and reserve practice hours before the fest.</p></header>'
    +(S.flash?'<div class="flash '+S.flash.kind+'" role="status">'+esc(S.flash.text)+'</div>':'')
    +'<section class="panel login"><header><h2>Sign in to book</h2></header>'+msg+'</section>';
}

function render(){
  var a=document.activeElement, id=a&&a.id, sel=null;
  if(a&&typeof a.selectionStart==="number"){try{sel=[a.selectionStart,a.selectionEnd];}catch(e){}}
  var tw=app.querySelector(".tlwrap"), sl=tw?tw.scrollLeft:0;
  if(!S.me){ app.innerHTML=loginView(); mountGoogle(0); return; }
  if(S.tab==="desk"&&!isStaff()) S.tab="book";
  var pend=S.bookings.filter(function(b){return b.status==="pending";}).length;
  var tabs=[["book","Book an event"],["practice","Practice slots"],["schedule","Schedule"],["mine","My bookings"]];
  if(isStaff()) tabs.push(["desk","Desk"]);
  var flash=S.flash?'<div class="flash '+S.flash.kind+'" role="status">'+esc(S.flash.text)+'</div>':"";
  if(S.loadErr) flash='<div class="flash err" role="status">'+esc(S.loadErr)+'</div>'+flash;
  var body={book:bookView,practice:practiceView,schedule:scheduleView,mine:mineView,desk:deskView}[S.tab]();
  var staffBox= isStaff()
    ? '<span><b>Staff access on</b></span><button class="btn ghost sm" data-act="staff-off">Leave staff mode</button>'
    : (S.showStaff
        ? '<input type="password" id="st-pw" placeholder="Staff password" autocomplete="current-password" value="'+esc(S.pw)+'"><button class="btn sm" data-act="staff-on">Enter</button><button class="btn ghost sm" data-act="staff-cancel">Cancel</button>'
        : '<button class="btn ghost sm" data-act="staff-show">Staff sign-in</button>');
  app.innerHTML='<header class="top"><h1>Main Audi Bookings Portal</h1><p>Book the Departments of Lights and Sounds and their equipment for your event, and reserve practice hours before the fest.</p></header>'
    +'<div class="userbar"><span>Signed in as <b>'+esc(S.me.name)+'</b></span><div class="sp">'+staffBox+'<button class="btn ghost sm" data-act="signout">Sign out</button></div></div>'
    +'<nav class="tabs" role="tablist">'+tabs.map(function(t){return '<button role="tab" data-act="tab" data-v="'+t[0]+'" aria-selected="'+(S.tab===t[0])+'">'+t[1]+(t[0]==="desk"&&pend?'<span class="badge">'+pend+'</span>':"")+'</button>';}).join("")+'</nav>'
    +flash+body;
  if(id){var n=document.getElementById(id); if(n){n.focus(); if(sel&&n.setSelectionRange){try{n.setSelectionRange(sel[0],sel[1]);}catch(e){}}}}
  var tw2=app.querySelector(".tlwrap"); if(tw2) tw2.scrollLeft=sl;
}
var raf=0; function schedule(){ if(raf) return; raf=requestAnimationFrame(function(){raf=0;render();}); }
function say(kind,text){S.flash={kind:kind,text:text};render();window.scrollTo({top:0,behavior:"smooth"});}

/* ---- Google sign-in ---- */
var gInit=false;
function mountGoogle(tries){
  var el=document.getElementById("gbtn"); if(!el||!S.googleClientId) return;
  if(!(window.google&&google.accounts&&google.accounts.id)){ if(tries<40) setTimeout(function(){mountGoogle(tries+1);},250); return; }
  if(!gInit){ google.accounts.id.initialize({client_id:S.googleClientId,callback:onCredential}); gInit=true; }
  google.accounts.id.renderButton(el,{theme:"outline",size:"large",text:"signin_with",width:280});
}
async function onCredential(resp){
  try{
    var d=await api("login",{method:"POST",body:{credential:resp.credential}});
    session=d.session; store("atd.session",session); S.me=d.user; S.flash=null; lastSig="";
    await load(); render();
  }catch(e){ S.flash={kind:"err",text:e.message}; render(); }
}

/* ---- actions ---- */
function validate(kind){
  if(!S.me) return "Sign in to send a request.";
  if(kind==="pr") return validatePractice();
  var f=S.ev, club=(f.club||"").trim();
  if(!club) return "Enter your club or department.";
  var title,date,s,e,festId=null;
  if(kind==="ev"){
    title=(f.title||"").trim(); if(!title) return "Enter the event name.";
    date=f.date; if(!date) return "Pick a date.";
    var min=addDays(today(),CONFIG.eventLeadDays), maxD=addDays(today(),CONFIG.eventMaxDays);
    if(date<min) return "Events need at least "+CONFIG.eventLeadDays+" days notice. The earliest date is "+fmtD(min)+".";
    if(date>maxD) return "Events can be booked up to "+CONFIG.eventMaxDays+" days ahead. The latest date is "+fmtD(maxD)+".";
    if(!f.start||!f.end) return "Set the start and end times.";
    s=toMin(f.start); e=toMin(f.end);
    if(e<=s) return "The end time must be after the start time.";
    if(s<CONFIG.dayFromHour*60) return "Bookings start from "+pad(CONFIG.dayFromHour)+":00.";
  }
  var ids=Object.keys(f.items);
  if(!ids.length) return "Choose at least one department or piece of equipment.";
  for(var i=0;i<ids.length;i++){
    var r=resById(ids[i]); if(!r) return "One of the chosen items does not exist.";
    if(freeQty(r,date,s,e)<1) return r.name+" is not free for that time.";
  }
  return {type:kind==="ev"?"event":"practice",club:club,title:title,date:date,startMin:s,endMin:e,items:Object.assign({},f.items),festId:festId};
}
function validatePractice(){
  if(!S.me) return "Sign in to send a request.";
  var f=S.pr, club=(f.club||"").trim();
  if(!club) return "Enter your club or department.";
  var fest=S.fests.filter(function(x){return x.id===f.festId;})[0]; if(!fest) return "Choose a fest.";
  var w=prWindow(fest); if(w.closed) return "The practice window for this fest has closed.";
  var slots=allSlots(f); if(!slots.length) return "Pick at least one hour.";
  if(slots.length>CONFIG.maxSlotsPerRequest) return "You can request up to "+CONFIG.maxSlotsPerRequest+" slots at once.";
  var ids=Object.keys(f.items);
  if(!ids.length) return "Choose at least one department or piece of equipment.";
  for(var i=0;i<slots.length;i++){
    var sl=slots[i], tag="Slot "+(i+1)+" ("+fmtD(sl.date)+", "+fmtT(sl.startMin)+"–"+fmtT(sl.endMin)+"): ";
    if(sl.date<w.lo||sl.date>w.hi) return tag+"practice is open from "+fmtD(w.lo)+" to "+fmtD(w.hi)+".";
    for(var j=0;j<i;j++){ if(slots[j].date===sl.date&&slots[j].startMin<sl.endMin&&slots[j].endMin>sl.startMin) return tag+"this overlaps another slot in your request."; }
    for(var k=0;k<ids.length;k++){
      var r=resById(ids[k]); if(!r) return "One of the chosen items does not exist.";
      if(freeQty(r,sl.date,sl.startMin,sl.endMin)<1) return tag+r.name+" is not free for that time.";
    }
  }
  return {type:"practice",club:club,title:(f.title||"").trim()||"Practice",festId:fest.id,items:Object.assign({},f.items),slots:slots};
}
async function submit(kind){
  var v=validate(kind); if(typeof v==="string"){say("err",v);return;}
  S.busy=true; render();
  try{
    await api("bookings",{method:"POST",body:v});
    store("atd.club",v.club);
    var f=kind==="ev"?S.ev:S.pr; f.items={}; f.title=""; if(kind==="pr"){f.hours=[];f.slots=[];}
    lastSig=""; await load(true); S.busy=false; S.tab="mine";
    say("ok","Request sent. It holds the slot while the stage controls departments review it. Check the status here.");
  }catch(err){ S.busy=false; await load(true); say("err",err.message); }
}
async function run(fn,okText){
  S.busy=true; render();
  try{ await fn(); lastSig=""; await load(true); S.busy=false; say("ok",okText); }
  catch(err){ S.busy=false; say("err",err.message); }
}

document.addEventListener("click",function(ev){
  var t=ev.target.closest("[data-act]"); if(!t) return;
  var act=t.dataset.act, id=t.dataset.id;
  if(act==="tab"){S.tab=t.dataset.v;S.flash=null;S.confirm=null;render();return;}
  if(act==="sub"){S.sub=t.dataset.v;S.flash=null;S.confirm=null;render();return;}
  if(act==="noconfirm"){S.confirm=null;render();return;}
  if(act==="signout"){signOutLocal();S.flash=null;render();return;}
  if(act==="staff-show"){S.showStaff=true;render();var p=document.getElementById("st-pw");if(p)p.focus();return;}
  if(act==="staff-cancel"){S.showStaff=false;S.pw="";render();return;}
  if(act==="staff-off"){staffToken=null;store("atd.staff",null);S.me.staff=false;S.tab="book";lastSig="";render();return;}
  if(act==="staff-on"){ staffLogin(); return; }
  if(act==="hour"){
    var h=Number(t.dataset.h), H=S.pr.hours, at=H.indexOf(h);
    if(at>=0){ if(H.length===2&&at===1) S.pr.hours=[H[0]]; else S.pr.hours=[]; }
    else { S.pr.hours=(h+1<CONFIG.practiceToHour)?[h,h+1]:[h]; }
    render();return;
  }
  if(act==="add-slot"){
    var ps=S.pr;
    if(ps.hours.length&&ps.date){
      var ns={date:ps.date,startMin:ps.hours[0]*60,endMin:(ps.hours[ps.hours.length-1]+1)*60};
      if(ps.slots.length>=CONFIG.maxSlotsPerRequest){say("err","You can request up to "+CONFIG.maxSlotsPerRequest+" slots at once.");return;}
      if(ps.slots.some(function(x){return x.date===ns.date&&x.startMin<ns.endMin&&x.endMin>ns.startMin;})){say("err","That time overlaps a slot you already added.");return;}
      ps.slots.push(ns); ps.slots.sort(function(a,b){return a.date<b.date?-1:a.date>b.date?1:a.startMin-b.startMin;});
      ps.hours=[]; S.flash=null;
    }
    render();return;
  }
  if(act==="rm-slot"){S.pr.slots.splice(Number(t.dataset.i),1);render();return;}
  if(act==="day"){var n=Number(t.dataset.n); S.sched.date=n===0?today():addDays(S.sched.date||today(),n); render();return;}
  if(act==="submit-ev"){submit("ev");return;}
  if(act==="submit-pr"){submit("pr");return;}
  if(act==="approve"||act==="reject"){
    var note=(document.getElementById("note-"+id)||{}).value||"";
    run(function(){return api("bookings/"+id+"/decide",{method:"POST",body:{status:act==="approve"?"approved":"rejected",note:note}});},act==="approve"?"Approved.":"Declined.");
    return;
  }
  if(act==="cancel"){
    if(S.confirm!=="cancel:"+id){S.confirm="cancel:"+id;render();return;}
    S.confirm=null; run(function(){return api("bookings/"+id+"/cancel",{method:"POST"});},"Booking cancelled. The slot is free again."); return;
  }
  if(act==="add-fest"){
    var f=S.fs; if(!f.name.trim()||!f.start||!f.end){say("err","Enter the fest name and both dates.");return;}
    if(f.end<f.start){say("err","The last day cannot be before the first day.");return;}
    run(async function(){await api("fests",{method:"POST",body:{name:f.name.trim(),start:f.start,end:f.end}});S.fs={name:"",start:"",end:""};},"Fest added. Practice booking is open for it."); return;
  }
  if(act==="del-fest"){
    if(S.confirm!=="fest:"+id){S.confirm="fest:"+id;render();return;}
    S.confirm=null; run(function(){return api("fests/"+id,{method:"DELETE"});},"Fest removed."); return;
  }
});
async function staffLogin(){
  if(!S.pw){say("err","Enter the staff password.");return;}
  try{
    var d=await api("staff-login",{method:"POST",body:{password:S.pw}});
    staffToken=d.token; store("atd.staff",staffToken); S.pw=""; S.showStaff=false; lastSig="";
    await load(true); S.tab="desk"; S.flash=null; render();
  }catch(e){ say("err",e.message); }
}
document.addEventListener("keydown",function(ev){ if(ev.key==="Enter"&&ev.target&&ev.target.id==="st-pw"){ev.preventDefault();staffLogin();} });

function onField(ev,committed){
  var t=ev.target;
  if(t.id==="st-pw"){S.pw=t.value;return;}
  if(t.dataset.bind){
    setPath(t.dataset.bind,t.value);
    if(t.dataset.bind==="pr.festId"){S.pr.hours=[];S.pr.slots=[];}
    if(t.dataset.bind==="pr.date"){S.pr.hours=[];}
    if(committed&&t.dataset.rr) render();
    return;
  }
  if(!committed) return;
  if(t.dataset.res){
    var p=t.dataset.res.split(":"), f=p[0]==="ev"?S.ev:S.pr;
    if(t.checked) f.items[p[1]]=1; else delete f.items[p[1]];
    render();
  }
}
document.addEventListener("input",function(ev){onField(ev,false);});
document.addEventListener("change",function(ev){onField(ev,true);});

/* ---- start ---- */
async function init(){
  render();
  try{
    var c=await (await fetch("/api/config")).json();
    Object.assign(CONFIG,c.config||{});
    if(c.resources&&c.resources.length) S.resources=c.resources;
    S.googleClientId=c.googleClientId||""; S.domain=c.domain||"";
  }catch(e){ S.loadErr="Could not reach the server. Check your connection and reload."; }
  S.ready=true;
  if(session) await load(true);
  render();
  setInterval(function(){ if(S.me&&!document.hidden&&!S.busy) load(true); },20000);
}
init();
})();
