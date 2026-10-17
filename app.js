const cfg=window.ZONE_CONFIG||{};
const configured=cfg.SUPABASE_URL?.startsWith('https://') && !cfg.SUPABASE_ANON_KEY?.startsWith('PASTE_');
const db=configured?window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY):null;
let admin=false, families=[],events=[],assignments=[],results=[];
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notify=s=>{$('feedback').textContent=s; $('feedback').hidden=false;};
function show(id){document.querySelectorAll('.section').forEach(x=>x.classList.toggle('active',x.id===id));window.scrollTo(0,0);}
async function fetchAll(){
 if(!db){notify('للتشغيل المشترك: اربط الموقع بمشروع Supabase عبر ملف config.js.');return;}
 try{
 const {data:session}=await db.auth.getSession();
 admin=!!session.session && (await db.rpc('is_zone_admin')).data===true;
 $('adminLogin').hidden=admin; $('adminTools').hidden=!admin;
 let {data:publicRows,error:pe}=await db.from('public_scoreboard').select('*').order('event_date');if(pe)throw pe;
 events=publicRows||[];
 if(admin){
 const [f,a,r]=await Promise.all([db.from('families').select('*').order('created_at'),db.from('assignments').select('*'),db.from('results').select('*')]);
 if(f.error||a.error||r.error)throw(f.error||a.error||r.error);
 families=f.data||[];assignments=a.data||[];results=r.data||[];
 }else{families=[];assignments=[];results=[];}
 render();
 }catch(e){notify('تعذر تحميل البيانات: '+e.message)}
}
$('registration').addEventListener('submit',async e=>{
 e.preventDefault();if(!db)return notify('الموقع لم يُربط بقاعدة البيانات بعد.');
 let f=new FormData(e.target),row={family:String(f.get('family')).trim(),family_id:String(f.get('familyId')).trim(),coordinator:String(f.get('coordinator')).trim(),coordinator_id:String(f.get('coordinatorId')).trim()};
 let {error}=await db.from('families').insert(row);
 if(error)return notify(error.code==='23505'?'آيدي العائلة مسجل مسبقًا.':'تعذر التسجيل: '+error.message);
 e.target.reset();notify('تم تسجيل العائلة بنجاح. انتظر توزيع المنظم للفعاليات.');show('home');
});
$('loginForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!db)return notify('أكمل إعداد Supabase أولًا.');
 let f=new FormData(e.target),{error}=await db.auth.signInWithPassword({email:String(f.get('email')),password:String(f.get('password'))});
 if(error)return notify('تعذر تسجيل الدخول: '+error.message);
 await fetchAll();if(!admin)notify('هذا الحساب لا يملك صلاحية الإدارة.');
});
async function logout(){await db?.auth.signOut();await fetchAll();}
$('eventForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!admin)return;
 let f=new FormData(e.target),{error}=await db.from('events').insert({name:String(f.get('name')).trim(),event_date:String(f.get('date'))});
 if(error)return notify(error.message);e.target.reset();await fetchAll();
});
async function assign(familyId,eventId){
 if(!admin||!eventId)return;
 if(assignments.filter(a=>a.event_id===eventId).length>=8)return notify('الفعالية مكتملة: الحد الأقصى 8 عوائل.');
 if(assignments.some(a=>a.event_id===eventId&&a.family_id===familyId))return;
 if(assignments.filter(a=>a.family_id===familyId).length>=2)return notify('استنفدت العائلة فرصتي المشاركة.');
 if(results.some(r=>r.first_family_id===familyId||r.second_family_id===familyId))return notify('العائلة متأهلة بالفعل ولا تحتاج مشاركة أخرى.');
 let {error}=await db.from('assignments').insert({family_id:familyId,event_id:eventId});
 if(error)return notify(error.message);await fetchAll();
}
async function unassign(familyId,eventId){
 if(!admin)return;
 if(results.some(r=>r.event_id===eventId&&(r.first_family_id===familyId||r.second_family_id===familyId)))return notify('لا يمكن إزالة عائلة لديها نتيجة مسجلة.');
 let {error}=await db.from('assignments').delete().eq('family_id',familyId).eq('event_id',eventId);
 if(error)return notify(error.message);await fetchAll();
}
async function saveResult(eventId){
 if(!admin)return;
 const first=$('first_'+eventId).value,second=$('second_'+eventId).value;
 if(!first||!second||first===second)return notify('اختر عائلتين مختلفتين للمركزين الأول والثاني.');
 if(!assignments.some(a=>a.event_id===eventId&&a.family_id===first)||!assignments.some(a=>a.event_id===eventId&&a.family_id===second))return notify('النتائج يجب أن تكون من العوائل الموزعة على الفعالية.');
 if(results.some(r=>r.event_id!==eventId&&[r.first_family_id,r.second_family_id].some(id=>id===first||id===second)))return notify('إحدى العائلتين متأهلة في فعالية سابقة.');
 let {error}=await db.from('results').upsert({event_id:eventId,first_family_id:first,second_family_id:second},{onConflict:'event_id'});
 if(error)return notify(error.message);notify('تم حفظ النتائج والتأهل.');await fetchAll();
}
function render(){
 $('registered').textContent=admin?families.length:'—';
 $('eventCount').textContent=events.length;
 $('qualified').textContent=events.filter(e=>e.first_family).length+events.filter(e=>e.second_family).length;
 $('eventList').innerHTML=events.map(e=>`<div class="panel" style="margin-bottom:12px"><h2>${esc(e.name)}</h2><p class="muted">${esc(e.event_date)}</p><p>الأول: ${esc(e.first_family||'لم يحدد')}</p><p>الثاني: ${esc(e.second_family||'لم يحدد')}</p></div>`).join('')||'<p class="muted">لم تُنشأ فعاليات بعد.</p>';
 const first=events.filter(e=>e.first_family),second=events.filter(e=>e.second_family);
 $('mainCount').textContent=first.length+' مقعد';$('secondCount').textContent=second.length+' مقعد';
 $('mainSeats').innerHTML=first.map((e,i)=>`<div class="team">${i+1}. ${esc(e.first_family)} <small>${esc(e.name)}</small></div>`).join('')||'<p class="muted">لا توجد نتائج بعد.</p>';
 $('secondSeats').innerHTML=second.map((e,i)=>`<div class="team">${i+1}. ${esc(e.second_family)} <small>${esc(e.name)}</small></div>`).join('')||'<p class="muted">لا توجد نتائج بعد.</p>';
 if(!admin)return;
 $('requests').innerHTML=families.map(t=>{
 const used=assignments.filter(a=>a.family_id===t.id);const hasQualified=results.some(r=>r.first_family_id===t.id||r.second_family_id===t.id);
 return `<div class="team"><div><b>${esc(t.family)}</b><br><small>آيدي العائلة: ${esc(t.family_id)} | المنسق: ${esc(t.coordinator)} (${esc(t.coordinator_id)})</small><br><small>الفرص المستخدمة: ${used.length}/2 ${hasQualified?'• متأهلة':''}</small><br><small>الفعاليات: ${used.map(a=>esc(events.find(e=>e.event_id===a.event_id)?.name||a.event_id)).join('، ')||'لم يوزع'}</small></div><div class="team-actions"><select id="assign_${t.id}"><option value="">اختر فعالية</option>${events.map(e=>`<option value="${e.event_id}">${esc(e.name)} — ${esc(e.event_date)} (${assignments.filter(a=>a.event_id===e.event_id).length}/8)</option>`).join('')}</select><button ${used.length>=2||hasQualified?'disabled':''} onclick="assign('${t.id}',document.getElementById('assign_${t.id}').value)">توزيع</button>${used.map(a=>`<button class="danger" onclick="unassign('${t.id}','${a.event_id}')">إزالة من ${esc(events.find(e=>e.event_id===a.event_id)?.name||'الفعالية')}</button>`).join('')}</div></div>`;
 }).join('')||'<p class="muted">لا توجد عوائل مسجلة.</p>';
 $('resultControls').innerHTML=events.map(e=>{
 let selected=assignments.filter(a=>a.event_id===e.event_id).map(a=>families.find(f=>f.id===a.family_id)).filter(Boolean);
 let r=results.find(r=>r.event_id===e.event_id);
 const opts=(key)=>'<option value="">اختر العائلة</option>'+selected.map(f=>`<option value="${f.id}" ${r?.[key]===f.id?'selected':''}>${esc(f.family)}</option>`).join('');
 return `<div class="panel" style="margin:12px 0"><b>${esc(e.name)} — ${esc(e.event_date)}</b><p class="muted">${selected.length} من 8 عوائل</p><label>المركز الأول<select id="first_${e.event_id}">${opts('first_family_id')}</select></label><label>المركز الثاني<select id="second_${e.event_id}">${opts('second_family_id')}</select></label><button onclick="saveResult('${e.event_id}')">حفظ النتائج</button></div>`;
 }).join('')||'<p class="muted">أنشئ فعالية أولًا.</p>';
}
fetchAll();
