import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';

initializeApp({credential:cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=getFirestore();

const MAX=10, START_GW=1;
const LEAGUES={'eng.1':'Premier League','esp.1':'La Liga','ita.1':'Serie A','uefa.champions':'Champions League','uefa.europa':'Europa League'};
const BIG=['arsenal','chelsea','liverpool','manchester city','manchester united','tottenham','newcastle','aston villa','west ham','brighton',
'barcelona','real madrid','atletico madrid','sevilla','villarreal','athletic club','real sociedad',
'bayern','dortmund','leverkusen','leipzig','paris saint germain','marseille','monaco',
'inter','ac milan','juventus','napoli','roma','lazio','atalanta','fiorentina',
'benfica','porto','sporting cp','ajax','psv','celtic','galatasaray','fenerbahce'];
const FIX={'Internazionale':'Inter Milan','Atlético Madrid':'Atlético Madrid','Bayern München':'Bayern Munich','AS Roma':'Roma'};
const norm=s=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/-/g,' ');
const isBig=n=>BIG.some(b=>norm(n).includes(b));
const fix=n=>FIX[n]||n;

const day=864e5, now=new Date();
// Todobaadka waa Jimce 00:00 ilaa Khamiis (UTC)
const dow=now.getUTCDay();
const start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((dow-5+7)%7));
const end=start+7*day;
const ymd=t=>new Date(t).toISOString().slice(0,10).replace(/-/g,'');

const stRef=db.doc('meta/state');
const st=(await stRef.get()).data()||{};
const gwStart=st.gwStart||start, startGw=st.startGw??START_GW;
if(!st.gwStart)await stRef.set({gwStart,startGw},{merge:true});
const week='GW'+(startGw+Math.round((start-gwStart)/(7*day)));

const all=new Map();
let okLeagues=0;
for(const [slug,name] of Object.entries(LEAGUES)){
  try{
    const url=`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard?dates=${ymd(start-7*day)}-${ymd(end-day)}&limit=400`;
    const r=await fetch(url);
    if(!r.ok)throw new Error('HTTP '+r.status);
    const j=await r.json();
    for(const e of j.events||[]){
      const c=e.competitions?.[0];if(!c)continue;
      const h=c.competitors.find(x=>x.homeAway==='home'),a=c.competitors.find(x=>x.homeAway==='away');
      if(!h||!a)continue;
      all.set(String(e.id),{id:String(e.id),home:fix(h.team.displayName),away:fix(a.team.displayName),
        homeCrest:h.team.logo||'',awayCrest:a.team.logo||'',hc:h.team.abbreviation||'',ac:a.team.abbreviation||'',
        league:name,ms:new Date(e.date).getTime(),done:e.status?.type?.completed===true,
        hs:parseInt(h.score),as:parseInt(a.score)});
    }
    okLeagues++;console.log(name,'OK',(j.events||[]).length);
  }catch(err){console.log(name,'ERROR',err.message)}
}
if(!okLeagues)throw new Error('Ma jiro horyaal la soo qaadi karay');

// 1) Ciyaaraha todobaadkan (kooxaha waaweyn)
const cand=[...all.values()].filter(f=>f.ms>=start&&f.ms<end)
  .map(f=>({...f,n:[f.home,f.away].filter(isBig).length})).filter(f=>f.n);
cand.sort((a,b)=>b.n-a.n||a.ms-b.ms);
const ex=(await db.collection('fixtures').where('week','==',week).get()).docs.map(d=>d.id);
const pick=cand.filter(c=>ex.includes(c.id));
for(const c of cand){if(pick.length>=MAX)break;if(!pick.includes(c))pick.push(c)}
for(const c of pick){
  const base={home:c.home,away:c.away,homeCrest:c.homeCrest,awayCrest:c.awayCrest,hc:c.hc,ac:c.ac,
    league:c.league,kickoff:Timestamp.fromMillis(c.ms),week};
  if(!ex.includes(c.id))Object.assign(base,{done:false,hs:null,as:null});
  await db.doc('fixtures/'+c.id).set(base,{merge:true});
}
console.log(week,'- ciyaaro la kaydiyay:',pick.length);

// 2) Natiijooyinka
const open=(await db.collection('fixtures').where('done','==',false).get()).docs;
let fin=0;
for(const d of open){
  const f=all.get(d.id);
  if(f&&f.done&&Number.isFinite(f.hs)&&Number.isFinite(f.as)){await d.ref.update({done:true,hs:f.hs,as:f.as});fin++}
}
console.log('natiijooyin la dhammeeyay:',fin);
