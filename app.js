const cfg=window.ZONE_CONFIG||{};
const configured=/^https:\/\//.test(cfg.SUPABASE_URL||'') && /^(sb_publishable_|eyJ)/.test(cfg.SUPABASE_ANON_KEY||'');
const db=configured?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
let admin=false,families=[],events=[],assignments=[],results=[],rosters=[],publicNames=[],scoreboard=[],registrationOpen=true;
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function notify(s){$('feedback').textContent=s;$('feedback').hidden=false;window.scrollTo(0,0)}
function show(id){document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x.id===id));window.scrollTo(0,0)}
const dateStr=d=>new Date(d+'T12:00:00').toLocaleDateString('ar-SA',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
async function fetchAll(){
 if(!db){notify('يلزم تحديث config.js بمفتاح Supabase العام على GitHub.');return}
 try{
  const sess=await db.auth.getSession();admin=!!sess.data.session&&(await db.rpc('is_zone_admin')).data===true;
  $('adminLogin').hidden=admin;$('adminTools').hidden=!admin;
  const [n,r,s,st]=await Promise.all([db.from('public_family_names').select('family').order('family'),db.from('published_rosters').select('*'),db.from('public_scoreboard').select('*').order('event_date'),db.from('zone_settings').select('*').eq('id',true).single()]);
  for(const q of [n,r,s,st])if(q.error)throw q.error;
  publicNames=n.data||[];rosters=r.data||[];scoreboard=s.data||[];registrationOpen=st.data.registration_open;
  if(admin){const all=await Promise.all([db.from('families').select('*').order('created_at'),db.from('events').select('*').order('event_date'),db.from('assignments').select('*'),db.from('results').select('*')]);for(const q of all)if(q.error)throw q.error;[families,events,assignments,results]=all.map(q=>q.data||[])}
  else{families=[];events=[];assignments=[];results=[]}
  render();
 }catch(e){notify('تعذر تحميل البيانات: '+e.message+' — تأكد من تشغيل migration_v2.sql')}
}
$('registration').addEventListener('submit',async e=>{
 e.preventDefault();if(!db||!registrationOpen)return notify('التسجيل غير متاح حاليًا');
 const f=new FormData(e.target);const row={family:String(f.get('family')).trim(),family_id:String(f.get('familyId')).trim(),coordinator_id:String(f.get('coordinatorId')).trim(),coordinator:String(f.get('coordinator')).trim()};
 const {error}=await db.from('families').insert(row);
 if(error)return notify(error.code==='23505'?'آيدي العائلة مسجل مسبقًا':'تعذر التسجيل: '+error.message);
 e.target.reset();notify('تم تسجيل العائلة في قائمة الانتظار، ولا يلزم تحديد موعد.');await fetchAll();show('families');
});
$('loginForm').addEventListener('submit',async e=>{e.preventDefault();const f=new FormData(e.target);const {error}=await db.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});if(error)return notify(error.message);await fetchAll();if(!admin)notify('ليس لهذا الحساب صلاحية الإدارة')});
async function logout(){await db.auth.signOut();await fetchAll()}
$('eventForm').addEventListener('submit',async e=>{e.preventDefault();if(!admin)return;const f=new FormData(e.target);const date=String(f.get('date'));const day=new Date(date+'T12:00:00').getDay();if(day!==2&&day!==3)return notify('اختر يوم الثلاثاء أو الأربعاء');const {error}=await db.from('events').insert({name:String(f.get('name')).trim(),event_date:date,event_time:String(f.get('time')),published:false});if(error)return notify(error.message);e.target.reset();await fetchAll()});
async function assign(familyId,eventId){if(!admin||!eventId)return;const used=assignments.filter(a=>a.family_id===familyId);if(assignments.some(a=>a.event_id===eventId&&a.family_id===familyId))return notify('العائلة موجودة بالفعل في هذا الروم');if(assignments.filter(a=>a.event_id===eventId).length>=8)return notify('الروم مكتمل');if(used.length>=3)return notify('استنفدت العائلة مشاركاتها الثلاث');if(results.some(r=>r.first_family_id===familyId||r.second_family_id===familyId))return notify('العائلة متأهلة بالفعل');const {error}=await db.from('assignments').insert({family_id:familyId,event_id:eventId});if(error)return notify(error.message);await fetchAll()}
async function randomDraw(eventId){
 if(!admin)return;
 const ev=events.find(e=>e.id===eventId);
 if(!ev||ev.published)return notify('أخفِ الروم قبل إجراء القرعة');
 if(assignments.some(a=>a.event_id===eventId))return notify('الروم يحتوي على عوائل بالفعل. أزل التوزيع الحالي قبل إجراء قرعة جديدة.');
 if(!confirm('إجراء قرعة عشوائية لاختيار 8 عوائل لهذا الروم؟'))return;
 const {data,error}=await db.rpc('zone_random_draw',{p_event_id:eventId});
 if(error)return notify('تعذرت القرعة: '+error.message);
 notify('اكتملت القرعة: '+data+' عوائل. راجع الجدول ثم اضغط نشر.');await fetchAll();
}
async function unassign(familyId,eventId){if(!admin)return;const ev=events.find(e=>e.id===eventId);if(ev?.published)return notify('أخفِ الروم قبل تعديل توزيعه');if(results.some(r=>r.event_id===eventId))return notify('احذف نتيجة الروم أولًا قبل تعديل المشاركين');const {error}=await db.from('assignments').delete().eq('family_id',familyId).eq('event_id',eventId);if(error)return notify(error.message);await fetchAll()}
async function saveResult(eventId){if(!admin)return;const first=$('first_'+eventId).value,second=$('second_'+eventId).value;if(!first||!second||first===second)return notify('اختر الفائز والوصيف من عائلتين مختلفتين');if(results.length>=32&&!results.some(r=>r.event_id===eventId))return notify('اكتملت مقاعد البطولة');const {error}=await db.from('results').upsert({event_id:eventId,first_family_id:first,second_family_id:second},{onConflict:'event_id'});if(error)return notify(error.message);notify('تم اعتماد الفائز والوصيف');await fetchAll()}
async function publishRoom(id,published){if(!admin)return;const {error}=await db.from('events').update({published}).eq('id',id);if(error)return notify(error.message);await fetchAll()}
async function toggleRegistration(){if(!admin)return;const {error}=await db.from('zone_settings').update({registration_open:!registrationOpen}).eq('id',true);if(error)return notify(error.message);await fetchAll()}
async function addFamily(){if(!admin)return;const family=prompt('اسم العائلة');if(!family)return;const family_id=prompt('آيدي العائلة');if(!family_id)return;const coordinator=prompt('اسم المنسق');if(!coordinator)return;const coordinator_id=prompt('آيدي المنسق');if(!coordinator_id)return;const {error}=await db.from('families').insert({family:family.trim(),family_id:family_id.trim(),coordinator_id:coordinator_id.trim(),coordinator:coordinator.trim()});if(error)return notify(error.message);await fetchAll()}
async function deleteFamily(id){if(!admin||!confirm('حذف العائلة؟ قد يمنع النظام حذف عائلة لها نتائج.'))return;const {error}=await db.from('families').delete().eq('id',id);if(error)return notify(error.message);await fetchAll()}
async function editFamily(id){if(!admin)return;const f=families.find(x=>x.id===id);const name=prompt('اسم العائلة',f.family);if(name===null)return;const family_id=prompt('آيدي العائلة',f.family_id);if(family_id===null)return;const coordinator=prompt('اسم المنسق',f.coordinator||'');if(coordinator===null)return;const coordinator_id=prompt('آيدي المنسق',f.coordinator_id);if(coordinator_id===null)return;const {error}=await db.from('families').update({family:name.trim(),family_id:family_id.trim(),coordinator:coordinator.trim(),coordinator_id:coordinator_id.trim()}).eq('id',id);if(error)return notify(error.message);await fetchAll()}
async function deleteRoom(id){if(!admin||!confirm('حذف الروم وتوزيعه ونتيجته؟'))return;const {error}=await db.from('events').delete().eq('id',id);if(error)return notify(error.message);await fetchAll()}
async function editRoom(id){if(!admin)return;const e=events.find(x=>x.id===id);const name=prompt('اسم الروم',e.name);if(name===null)return;const time=prompt('الوقت HH:MM',e.event_time.slice(0,5));if(time===null)return;const {error}=await db.from('events').update({name:name.trim(),event_time:time}).eq('id',id);if(error)return notify(error.message);await fetchAll()}
function render(){
 $('registered').textContent=publicNames.length;$('eventCount').textContent=admin?events.length:new Set(rosters.map(r=>r.event_id)).size;
 const first=scoreboard.filter(x=>x.first_family),second=scoreboard.filter(x=>x.second_family);
 const firstCount=admin?results.length:first.length,secondCount=admin?results.length:second.length;
 $('qualified').textContent=firstCount+secondCount;
 $('mainCount').textContent=firstCount+'/32 مقعد';$('secondCount').textContent=secondCount+'/32 مقعد';
 $('mainRemaining').textContent=Math.max(0,32-firstCount);$('secondRemaining').textContent=Math.max(0,32-secondCount);
 $('mainSeats').innerHTML=first.map((x,i)=>`<div class="team">${i+1}. ${esc(x.first_family)}</div>`).join('')||'<p class="muted">لم تُنشر نتائج بعد</p>';
 $('secondSeats').innerHTML=second.map((x,i)=>`<div class="team">${i+1}. ${esc(x.second_family)}</div>`).join('')||'<p class="muted">لم تُنشر نتائج بعد</p>';
 $('publicFamilies').innerHTML=publicNames.map((x,i)=>`<div class="team"><b>${i+1}. ${esc(x.family)}</b></div>`).join('')||'<p class="muted">لا توجد عوائل مسجلة</p>';
 $('registration').hidden=!registrationOpen;$('registerButton').disabled=!registrationOpen;
 const publicEvents=new Map();for(const r of rosters){if(!publicEvents.has(r.event_id))publicEvents.set(r.event_id,{...r,names:[]});publicEvents.get(r.event_id).names.push(r.family)}
 $('eventList').innerHTML=[...publicEvents.values()].sort((a,b)=>a.event_date.localeCompare(b.event_date)).map(e=>{const score=scoreboard.find(x=>x.event_id===e.event_id);return `<div class="panel" style="margin-bottom:12px"><h2>${esc(e.name)}</h2><p class="muted">${esc(dateStr(e.event_date))} • ${esc(e.event_time.slice(0,5))}</p><div class="grid">${e.names.map((n,i)=>`<div class="team">المواجهة ${Math.floor(i/2)+1} — ${i%2===0?'الطرف الأول':'الطرف الثاني'}: ${esc(n)}</div>`).join('')}</div><p>الفائز: ${esc(score?.first_family||'بانتظار النتيجة')} | الوصيف: ${esc(score?.second_family||'بانتظار النتيجة')}</p></div>`}).join('')||'<p class="muted">لم تُنشر جداول بعد</p>';
 if(!admin)return;
 $('registrationState').textContent=registrationOpen?'التسجيل مفتوح':'التسجيل مغلق';
 $('requests').innerHTML=families.map(f=>{const used=assignments.filter(a=>a.family_id===f.id),qualified=results.some(r=>r.first_family_id===f.id||r.second_family_id===f.id);return `<div class="team"><div><b>${esc(f.family)}</b><br><small>آيدي العائلة: ${esc(f.family_id)} | اسم المنسق: ${esc(f.coordinator)} | آيدي المنسق: ${esc(f.coordinator_id)}</small><br><small>المشاركات: ${used.length}/3 ${qualified?'• متأهلة':''}</small><br><small>${used.map(a=>esc(events.find(e=>e.id===a.event_id)?.name||'روم')).join('، ')||'في الانتظار'}</small></div><div class="team-actions"><select id="assign_${f.id}"><option value="">اختر الروم</option>${events.filter(e=>!e.published).map(e=>`<option value="${e.id}">${esc(e.name)} — ${esc(e.event_date)} (${assignments.filter(a=>a.event_id===e.id).length}/8)</option>`).join('')}</select><button ${qualified||used.length>=3?'disabled':''} onclick="assign('${f.id}',$('assign_${f.id}').value)">توزيع</button><button class="secondary" onclick="editFamily('${f.id}')">تعديل</button><button class="danger" onclick="deleteFamily('${f.id}')">حذف</button>${used.map(a=>`<button class="secondary" onclick="unassign('${f.id}','${a.event_id}')">إزالة من الروم</button>`).join('')}</div></div>`}).join('')||'<p class="muted">لا توجد عوائل مسجلة</p>';
 $('roomControls').innerHTML=events.map(e=>`<div class="team"><div><b>${esc(e.name)}</b><br><small>${esc(e.event_date)} ${esc(e.event_time)} • ${assignments.filter(a=>a.event_id===e.id).length}/8 • ${e.published?'منشور':'مخفي'}</small></div><div class="team-actions"><button class="secondary" ${e.published||assignments.some(a=>a.event_id===e.id)?'disabled':''} onclick="randomDraw('${e.id}')">قرعة عشوائية (8 عوائل)</button><button onclick="publishRoom('${e.id}',${!e.published})">${e.published?'إخفاء':'نشر'}</button><button class="secondary" onclick="editRoom('${e.id}')">تعديل</button><button class="danger" onclick="deleteRoom('${e.id}')">حذف</button></div></div>`).join('');
 $('resultControls').innerHTML=events.map(e=>{const selected=assignments.filter(a=>a.event_id===e.id).map(a=>families.find(f=>f.id===a.family_id)).filter(Boolean),r=results.find(r=>r.event_id===e.id);const opts=key=>'<option value="">اختر العائلة</option>'+selected.map(f=>`<option value="${f.id}" ${r?.[key]===f.id?'selected':''}>${esc(f.family)}</option>`).join('');return `<div class="panel" style="margin:12px 0"><b>${esc(e.name)} — ${esc(e.event_date)}</b><p class="muted">${selected.length}/8 عوائل</p><label>الفائز بالنهائي<select id="first_${e.id}">${opts('first_family_id')}</select></label><label>الخاسر أمام الفائز في النهائي<select id="second_${e.id}">${opts('second_family_id')}</select></label><button onclick="saveResult('${e.id}')">اعتماد النتيجة</button></div>`}).join('');
}
fetchAll();
