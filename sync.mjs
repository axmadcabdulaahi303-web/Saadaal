import {initializeApp,cert} from 'firebase-admin/app';
import {getFirestore,Timestamp} from 'firebase-admin/firestore';

const KEY=process.env.API_FOOTBALL_KEY;
initializeApp({credential:cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))});
const db=getFirestore();

const SEASON=2026, MAX=10, START_GW=1;
const LEAGUES={39:'Premier League',140:'La Liga',135:'Serie A',2:'Champions League',3:'Europa League'};
const BIG=['arsenal','chelsea','liverpool','manchester city','manchester united','tottenham','newcastle','aston villa','west ham','brighton',
'barcelona','real madrid','atletico madrid','sevilla','villarreal','athletic club','real sociedad',
'bayern','dortmund','leverkusen','leipzig','paris saint germain','marseille','monaco',
'inter','ac milan','juventus','napoli','roma','lazio','atalanta','fiorentina',
'benfica','porto','sporting cp','ajax','psv','celtic','galatasaray','fenerbahce'];
const FIX={'Tottenham':'Tottenham Hotspur','Newcastle':'Newcastle United','Paris Saint Germain':'Paris Saint-Germain','Inter':'Inter Milan','Atletico Madrid':'Atlético Madrid','Bayern München':'Bayern Munich','AS Roma':'Roma'};
const CODE={'Manchester City':'MCI','Manchester United':'MUN','Tottenham Hotspur':'TOT','Newcastle United':'NEW','Aston Villa':'AVL','Arsenal':'ARS','Chelsea':'CHE','Liverpool':'LIV','Everton':'EVE','Brighton':'BHA','Bournemouth':'BOU','Real Madrid':'RMA','Barcelona':'BAR','Atlético Madrid':'ATM','Paris Saint-Germain':'PSG','Bayern Munich':'BAY','Inter Milan':'INT','AC Milan':'MIL','Juventus':'JUV','Napoli':'NAP','Roma':'ROM'};
const fix=n=>FIX[n]||n;
const code=n=>CODE[n]||n.slice(0,3).toUpperCase();
const isBig=n=>BIG.some(b=>n.toLowerCase().includes(b));

async function api(path){
  const r=await fetch('https://v3.football.api-sports.io'+path,{headers:{'x-apisports-key':KEY}});
  const j=await r.json();
  const e=j.errors;
  if(e&&(Array.isArray(e)?e.length:Object.keys(e).length))throw new Error(path+' -> '+JSON.stringify(e));
  return j.response||[];
}

const day=864e5, now=new Date();
// Todobaadka waa Jimce 00:00 ilaa Khamiis (UTC)
const dow=now.getUTCDay();
const start=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()-((dow-5+7)%7));
const iso=t=>new Date(t).toISOString().slice(0,10);

const stRef=db.doc('meta/state');
const st=(await stRef.get()).data()||{};
const gwStart=st.gwStart||start, startGw=st.startGw??START_GW;
if(!st.gwStart)await stRef.set({gwStart,startGw},{merge:true});
const week='GW'+(startGw+Math.round((start-gwStart)/(7*day)));

// 1) Ciyaaraha todobaadkan
let cand=[];
for(const [id,name] of Object.entries(LEAGUES)){
  const list=await api(`/fixtures?league=${id}&season=${SEASON}&from=${iso(start)}&to=${iso(start+6*day)}`);
  for(const f of list){
    const h=fix(f.teams.home.name),a=fix(f.teams.away.name);
    const n=[h,a].filter(isBig).length;
    if(!n)continue;
    cand.push({id:String(f.fixture.id),home:h,away:a,homeCrest:f.teams.home.logo,awayCrest:f.teams.away.logo,
      hc:code(h),ac:code(a),league:name,kickoff:Timestamp.fromDate(new Date(f.fixture.date)),n});
  }
}
const ex=(await db.collection('fixtures').where('week','==',week).get()).docs.map(d=>d.id);
cand.sort((a,b)=>b.n-a.n||a.kickoff.toMillis()-b.kickoff.toMillis());
const pick=cand.filter(c=>ex.includes(c.id));
for(const c of cand){if(pick.length>=MAX)break;if(!pick.includes(c))pick.push(c)}
for(const c of pick){
  const {n,...d}=c;const base={...d,week};
  if(!ex.includes(c.id))Object.assign(base,{done:false,hs:null,as:null});
  await db.doc('fixtures/'+c.id).set(base,{merge:true});
}
console.log(week,'- ciyaaro la kaydiyay:',pick.length);

// 2) Natiijooyinka
const open=(await db.collection('fixtures').where('done','==',false).get()).docs
  .filter(d=>d.data().kickoff.toMillis()<Date.now()-100*60000).map(d=>d.id);
let fin=0;
for(let i=0;i<open.length;i+=20){
  const r=await api('/fixtures?ids='+open.slice(i,i+20).join('-'));
  for(const f of r){
    if(['FT','AET','PEN'].includes(f.fixture.status.short)){
      await db.doc('fixtures/'+f.fixture.id).update({done:true,hs:f.score.fulltime.home,as:f.score.fulltime.away});fin++;
    }
  }
}
console.log('natiijooyin la dhammeeyay:',fin);
