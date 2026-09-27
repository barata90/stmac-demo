/* STMAC numerical core.
 * Shared by the Web Worker (assets/js/stmac-worker.js) and by the main-thread fallback
 * that runs when workers are unavailable (for example index.html opened from disk in
 * Chrome). The solver functions are the ones the page has always used; only the grid
 * variables (T, DOY0, ...) are now set through setGrid() instead of page globals.
 * No DOM access in this file. */
(function (root) {
'use strict';

/* ================= RNG ================= */
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;}}

/* ================= constants ================= */
/* Station order = column order of the 1999 NLR parquet. Identities verified
   by solar-noon inference from the data itself; coordinates approximate. */
const STATIONS=[
 {code:'sv',name:'Solar Village',lat:24.91,lon:46.41},
 {code:'sk',name:'Sakakah (Al-Jouf)',lat:29.97,lon:40.10},
 {code:'gs',name:'Gassim',lat:26.31,lon:43.77},
 {code:'jn',name:'Jeddah',lat:21.66,lon:39.17},
 {code:'ah',name:'Al-Ahsa',lat:25.30,lon:49.48},
 {code:'qa',name:'Qaisumah',lat:28.32,lon:46.13},
 {code:'ma',name:'Madinah',lat:24.55,lon:39.70},
 {code:'ab',name:'Abha',lat:18.23,lon:42.66},
 {code:'wd',name:'Wadi Al-Dawasir',lat:20.50,lon:44.90},
 {code:'sh',name:'Sharurah',lat:17.47,lon:47.11},
 {code:'gn',name:'Gizan',lat:16.90,lon:42.58}];
const N=11, SPD=288, TZ=3; /* timestamps are Saudi local clock (UTC+3) */
let DAYS=70, T=SPD*DAYS, DOY0=295, START_UTC=Date.UTC(1999,9,22);
const SYN={DAYS:30, DOY0:74, START:Date.UTC(1999,2,15)};
const REALMETA={DAYS:70, DOY0:295, START:Date.UTC(1999,9,22),
  label:'Oct 22 – Dec 30, 1999', fillPct:0.87};
const BLOCKS=[{lab:'30 min',s:6},{lab:'2 h',s:24},{lab:'6 h',s:72},{lab:'12 h',s:144},
              {lab:'1 day',s:288},{lab:'3 days',s:864},{lab:'7 days',s:2016}];
const AT=10.0;                    /* smoothing weight of the pure-temporal baseline */
/* STMAC weights: ratio r and ridge g, selected once by block cross-validation
   on observed cells of the full 1999 record (Section IV-D of the paper) */
const R_RATIO=1000, RIDGE=3, MDV_WIN=15;
const GRAPH_K=3, GRAPH_SIGMA=300; /* k-NN graph, Gaussian weights (km) */
/* Scored cells: unobserved cells at clock hours 8 to 16 inclusive (08:00-16:55 local time),
   the DAYTIME mask of the analysis notebooks; the paper writes "between 08:00 and 16:00". */
const EVAL_H0=8, EVAL_H1=16;
const DAY_CS=20;                  /* clear-sky GHI above this counts as daylight (display only) */
/* longitude sheaf: shifts are measured from the network-mean longitude (Section III-B) */
const LON_MEAN=STATIONS.reduce((a,s)=>a+s.lon,0)/STATIONS.length;
/* ablation S0 of Table I: the joint solver without prior (C = 0, g = 0, r = 10) */
const S0_R=10, S0_G=0;

function setGrid(days,doy0,startUTC){DAYS=days;T=SPD*DAYS;DOY0=doy0;START_UTC=startUTC;}
function grid(){return {DAYS,T,DOY0,START_UTC};}
/* delta_v = (lambda_v - mean lambda)/(15 deg/h): exact value in minutes, and the whole
   5-minute samples this page shifts by (the reference implementation shifts fractionally by FFT) */
function lonShiftMin(v){return (STATIONS[v].lon-LON_MEAN)*4;}
function lonShift(v){return Math.round((STATIONS[v].lon-LON_MEAN)/15*12);}
const evalHour=i=>{const h=Math.floor((i%SPD)*5/60);return h>=EVAL_H0&&h<=EVAL_H1;};
let EVAL=null,EVAL_T=0;
function evalMask(){if(EVAL_T!==T){EVAL=new Uint8Array(T);for(let i=0;i<T;i++)EVAL[i]=evalHour(i)?1:0;EVAL_T=T;}return EVAL;}

/* ================= physics: clear sky + clouds ================= */
function clearSky(v,i){
  const st=STATIONS[v];
  const n=DOY0+Math.floor(i/SPD);
  const decl=23.45*Math.sin(2*Math.PI*(284+n)/365)*Math.PI/180;
  const hClk=(i%SPD)*5/60;
  const H=(15*(hClk-TZ+st.lon/15-12))*Math.PI/180;
  const phi=st.lat*Math.PI/180;
  const cz=Math.sin(phi)*Math.sin(decl)+Math.cos(phi)*Math.cos(decl)*Math.cos(H);
  return cz<=0?0:1080*Math.pow(cz,1.15);
}
function hav(la1,lo1,la2,lo2){const R=6371,p=Math.PI/180;
 const a=Math.sin((la2-la1)*p/2)**2+Math.cos(la1*p)*Math.cos(la2*p)*Math.sin((lo2-lo1)*p/2)**2;
 return 2*R*Math.asin(Math.sqrt(a));}
function genData(seed){
  const rng0=mulberry32(seed);const ev=[];
  for(let k=0;k<12;k++){
    ev.push({tc:rng0()*T,sigT:(SPD/8)+rng0()*SPD*1.2,lat0:16+rng0()*15,lon0:36+rng0()*14,
             r:150+rng0()*450,depth:0.25+rng0()*0.6,vLon:(rng0()-0.5)*8/T*SPD});
  }
  const rng=mulberry32(seed^0x9e37);
  const U=[],CS=[];
  for(let v=0;v<N;v++){
    const u=new Float64Array(T),cs=new Float64Array(T);let ar=0;
    for(let i=0;i<T;i++){
      const c=clearSky(v,i);cs[i]=c;
      let att=1;
      for(const e of ev){
        const lonNow=e.lon0+e.vLon*(i-e.tc)/SPD;
        const d=hav(STATIONS[v].lat,STATIONS[v].lon,e.lat0,lonNow);
        att-=e.depth*Math.exp(-(d*d)/(2*e.r*e.r))*Math.exp(-((i-e.tc)*(i-e.tc))/(2*e.sigT*e.sigT));
      }
      att=Math.max(0.07,Math.min(1,att));
      ar=0.95*ar+0.05*(rng()*2-1);
      u[i]=Math.max(0,c*att*(1+0.04*ar)+(c>5?(rng()*2-1)*6:0));
    }
    U.push(u);CS.push(cs);
  }
  return {U,CS};
}
function computeCS(){const CS=[];for(let v=0;v<N;v++){const cs=new Float64Array(T);
  for(let i=0;i<T;i++)cs[i]=clearSky(v,i);CS.push(cs);}return CS;}
/* payload: see assets/data/nlr1999.js (int16 LE, station-major, delta-encoded along time) */
function decodeReal(payload){
  const bin=atob(payload.b64);
  const u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  const d16=new Int16Array(u8.buffer);
  const Tr=payload.days*SPD;
  if(d16.length!==N*Tr)throw new Error('NLR payload has '+d16.length+' samples, expected '+(N*Tr));
  const U=[];
  for(let v=0;v<N;v++){const u=new Float64Array(Tr);let acc=0;
    for(let i=0;i<Tr;i++){acc+=d16[v*Tr+i];u[i]=acc;}
    U.push(u);}
  return U;
}

/* ================= graph ================= */
function distMatrix(){
  const D=[];for(let i=0;i<N;i++)D.push(new Float64Array(N));
  for(let i=0;i<N;i++)for(let j=0;j<N;j++)D[i][j]=hav(STATIONS[i].lat,STATIONS[i].lon,STATIONS[j].lat,STATIONS[j].lon);
  return D;
}
function buildGraph(){
  const D=distMatrix(),W=[];
  for(let i=0;i<N;i++)W.push(new Float64Array(N));
  const k=GRAPH_K,sig=GRAPH_SIGMA;
  for(let i=0;i<N;i++){
    const idx=[...Array(N).keys()].filter(j=>j!==i).sort((a,b)=>D[i][a]-D[i][b]).slice(0,k);
    for(const j of idx)W[i][j]=Math.exp(-(D[i][j]*D[i][j])/(2*sig*sig));
  }
  for(let i=0;i<N;i++)for(let j=0;j<N;j++){const m=Math.max(W[i][j],W[j][i]);W[i][j]=m;W[j][i]=m;}
  const Lg=[];for(let i=0;i<N;i++)Lg.push(new Float64Array(N));
  for(let i=0;i<N;i++){let s=0;for(let j=0;j<N;j++){s+=W[i][j];Lg[i][j]=-W[i][j];}Lg[i][i]=s;}
  return {W,Lg,D};
}

/* ================= solvers ================= */
function tempSolve(target,w,at,out){
  const n=target.length;
  const a0=new Float64Array(n),a1=new Float64Array(n),a2=new Float64Array(n);
  for(let i=0;i<n;i++){let m=6;if(i===0||i===n-1)m=1;else if(i===1||i===n-2)m=5;a0[i]=w[i]+at*m+1e-9;}
  for(let i=0;i<n-1;i++){let s=-4;if(i===0||i===n-2)s=-2;a1[i]=at*s;}
  for(let i=0;i<n-2;i++)a2[i]=at;
  const m0=new Float64Array(n),m1=new Float64Array(n),m2=new Float64Array(n);
  for(let i=0;i<n;i++){
    const p2=i>=2?a2[i-2]/m0[i-2]:0;
    const p1=i>=1?(a1[i-1]-(i>=2?p2*m1[i-1]:0))/m0[i-1]:0;
    m2[i]=p2;m1[i]=p1;
    m0[i]=Math.sqrt(Math.max(a0[i]-p1*p1-p2*p2,1e-12));
  }
  const y=new Float64Array(n);
  for(let i=0;i<n;i++)y[i]=(w[i]*target[i]-(i>=1?m1[i]*y[i-1]:0)-(i>=2?m2[i]*y[i-2]:0))/m0[i];
  for(let i=n-1;i>=0;i--)out[i]=(y[i]-(i+1<n?m1[i+1]*out[i+1]:0)-(i+2<n?m2[i+2]*out[i+2]:0))/m0[i];
}
function shiftInt(src,s,dst){const n=src.length;s=((s%n)+n)%n;for(let i=0;i<n;i++)dst[i]=src[(i+s)%n];}
function buildBlockMask(blockLen,frac,seed){
  const rng=mulberry32(seed);
  const nb=Math.max(1,Math.ceil(frac*T/blockLen));
  const M=[];let removed=0;
  for(let v=0;v<N;v++){
    const m=new Uint8Array(T).fill(1);
    let placed=0,tries=0;const maxTries=Math.max(500,nb*80);
    while(placed<nb&&tries<maxTries){
      tries++;
      const s=Math.floor(rng()*(T-blockLen));
      let ok=true;
      for(let i=Math.max(0,s-1);i<Math.min(T,s+blockLen+1);i++)if(!m[i]){ok=false;break;}
      if(ok){for(let i=s;i<s+blockLen;i++)m[i]=0;placed++;}
    }
    for(let i=0;i<T;i++)if(!m[i])removed++;
    M.push(m);
  }
  return {M,frac:removed/(N*T),nb};
}
function pureTemporal(Z,M,at){
  const R=[];const w=new Float64Array(T);
  for(let v=0;v<N;v++){const out=new Float64Array(T);
    for(let i=0;i<T;i++)w[i]=M[v][i];
    tempSolve(Z[v],w,at,out);R.push(out);}
  return R;
}
/* ---- climatology prior: mean diurnal variation, observed cells only ---- */
function mdvPrior(Z,M,halfWin){
  const nd=Math.round(T/SPD),C=[];
  const psum=new Float64Array(nd+1),pcnt=new Float64Array(nd+1);
  for(let v=0;v<N;v++){
    const c=new Float64Array(T);
    for(let s=0;s<SPD;s++){
      psum[0]=0;pcnt[0]=0;
      for(let d=0;d<nd;d++){
        const i=d*SPD+s,obs=(i<T&&M[v][i]>0.5);
        psum[d+1]=psum[d]+(obs?Z[v][i]:0);
        pcnt[d+1]=pcnt[d]+(obs?1:0);
      }
      const tot=psum[nd],totc=pcnt[nd];
      for(let d=0;d<nd;d++){
        const lo=Math.max(0,d-halfWin),hi=Math.min(nd,d+halfWin+1);
        const sw=psum[hi]-psum[lo],cw=pcnt[hi]-pcnt[lo],i=d*SPD+s;
        if(i<T)c[i]=cw>0?sw/cw:(totc>0?tot/totc:0);
      }
    }
    C.push(c);
  }
  return C;
}
function climFill(Z,M,C){
  const R=[];
  for(let v=0;v<N;v++){const o=new Float64Array(T);
    for(let i=0;i<T;i++)o[i]=(M[v][i]>0.5)?Z[v][i]:C[v][i];R.push(o);}
  return R;
}
/* ---- second-difference operator L_t = D2' D2 (same coefficients as tempSolve) ---- */
function ltD(i,n){return (i===0||i===n-1)?1:((i===1||i===n-2)?5:6);}
function ltO(i,n){return (i===0||i===n-2)?-2:-4;}   /* entry (i,i+1) */
function sparseLg(Lg){
  const idx=[],val=[];
  for(let v=0;v<N;v++){const ii=[],vv=[];
    for(let w=0;w<N;w++)if(w!==v&&Lg[v][w]!==0){ii.push(w);vv.push(Lg[v][w]);}
    idx.push(ii);val.push(vv);}
  return {idx,val};
}
/* ---- STMAC: one exact sparse solve on departures from the station climatology.
   Unknowns are the unobserved cells ordered by (time, station); with that ordering the
   system K_mm x = -K_mo z_o (Eq. 6 of the paper) is banded with half-bandwidth < 2N,
   so a banded Cholesky factorisation solves it exactly in O(n * bandwidth^2). ---- */
function stmacJoint(Z,M,Lg,r,g,useShift,halfWin,noPrior){
  const del=STATIONS.map((s,v)=>lonShift(v));
  const C=noPrior?STATIONS.map(()=>new Float64Array(T)):mdvPrior(Z,M,halfWin);
  const A0=[],Mm=[];
  for(let v=0;v<N;v++){
    const a=new Float64Array(T),mf=new Float64Array(T);
    for(let i=0;i<T;i++){a[i]=(M[v][i]>0.5)?(Z[v][i]-C[v][i]):0;mf[i]=M[v][i];}
    if(useShift){
      const as=new Float64Array(T),ms=new Float64Array(T);
      shiftInt(a,-del[v],as);shiftInt(mf,-del[v],ms);
      A0.push(as);Mm.push(ms);
    }else{A0.push(a);Mm.push(mf);}
  }
  const SPG=sparseLg(Lg);
  /* index the unknowns */
  const idx=new Int32Array(N*T).fill(-1);
  const cellT=[],cellV=[];
  let n=0;
  for(let t=0;t<T;t++)for(let v=0;v<N;v++)if(Mm[v][t]<=0.5){idx[t*N+v]=n++;cellT.push(t);cellV.push(v);}
  if(n===0){
    const Rec=[];for(let v=0;v<N;v++){const o=new Float64Array(T);for(let i=0;i<T;i++)o[i]=Z[v][i];Rec.push(o);}
    return {R:Rec,C:C,n:0,bw:0};
  }
  /* bandwidth */
  let bw=0;
  for(let k=0;k<n;k++){
    const t=cellT[k],v=cellV[k];
    for(let dt=1;dt<=2;dt++){if(t-dt>=0){const j=idx[(t-dt)*N+v];if(j>=0&&k-j>bw)bw=k-j;}}
    const nb=SPG.idx[v];
    for(let q=0;q<nb.length;q++){const j=idx[t*N+nb[q]];if(j>=0&&j<k&&k-j>bw)bw=k-j;}
  }
  const W=bw+1;
  const AB=new Float64Array(n*W),b=new Float64Array(n);
  /* assemble lower band and right-hand side */
  for(let k=0;k<n;k++){
    const t=cellT[k],v=cellV[k];
    AB[k*W]=r*ltD(t,T)+Lg[v][v]+g;
    for(let dt=-2;dt<=2;dt++){
      if(dt===0)continue;
      const t2=t+dt;if(t2<0||t2>=T)continue;
      const c=(Math.abs(dt)===1)?r*ltO(Math.min(t,t2),T):r;
      const j=idx[t2*N+v];
      if(j>=0){if(j<k)AB[k*W+(k-j)]=c;}
      else b[k]-=c*A0[v][t2];
    }
    const nb=SPG.idx[v],nv=SPG.val[v];
    for(let q=0;q<nb.length;q++){
      const w=nb[q],c=nv[q],j=idx[t*N+w];
      if(j>=0){if(j<k)AB[k*W+(k-j)]=c;}
      else b[k]-=c*A0[w][t];
    }
  }
  /* banded Cholesky, in place: AB becomes L */
  for(let j=0;j<n;j++){
    const jW=j*W,kmin=Math.max(0,j-bw);
    let s=AB[jW];
    for(let k=kmin;k<j;k++){const l=AB[jW+(j-k)];s-=l*l;}
    if(s<=0)s=1e-12;
    const d=Math.sqrt(s);AB[jW]=d;
    const imax=Math.min(n-1,j+bw);
    for(let i=j+1;i<=imax;i++){
      const iW=i*W;
      let s2=AB[iW+(i-j)];
      const k0=Math.max(kmin,i-bw);
      for(let k=k0;k<j;k++)s2-=AB[iW+(i-k)]*AB[jW+(j-k)];
      AB[iW+(i-j)]=s2/d;
    }
  }
  /* forward: L y = b */
  const y=new Float64Array(n);
  for(let i=0;i<n;i++){
    const iW=i*W;let s=b[i];
    const k0=Math.max(0,i-bw);
    for(let k=k0;k<i;k++)s-=AB[iW+(i-k)]*y[k];
    y[i]=s/AB[iW];
  }
  /* backward: L' x = y */
  const x=new Float64Array(n);
  for(let i=n-1;i>=0;i--){
    let s=y[i];
    const imax=Math.min(n-1,i+bw);
    for(let k=i+1;k<=imax;k++)s-=AB[k*W+(k-i)]*x[k];
    x[i]=s/AB[i*W];
  }
  /* assemble the reconstruction */
  const Rec=[],tmp=new Float64Array(T);
  for(let v=0;v<N;v++){
    for(let i=0;i<T;i++){const k=idx[i*N+v];tmp[i]=(k>=0)?x[k]:A0[v][i];}
    const back=new Float64Array(T);
    if(useShift)shiftInt(tmp,del[v],back);else back.set(tmp);
    const o=new Float64Array(T);
    for(let i=0;i<T;i++)o[i]=back[i]+C[v][i];
    Rec.push(o);
  }
  return {R:Rec,C:C,n:n,bw:bw};
}

function rmseMasked(truth,rec,M){
  const E=evalMask();let s=0,c=0;
  for(let v=0;v<N;v++)for(let i=0;i<T;i++)
    if(!M[v][i]&&E[i]){const d=rec[v][i]-truth[v][i];s+=d*d;c++;}
  return c?Math.sqrt(s/c):NaN;
}
/* Same cell selection as rmseMasked, broken down per station, plus MAE and mean bias
   (reconstruction minus truth: positive = overestimate). */
function errorStats(truth,rec,M){
  const E=evalMask(),st=[];let S=0,A=0,B=0,C=0;
  for(let v=0;v<N;v++){
    let s=0,a=0,b=0,c=0;
    for(let i=0;i<T;i++)if(!M[v][i]&&E[i]){const d=rec[v][i]-truth[v][i];s+=d*d;a+=Math.abs(d);b+=d;c++;}
    st.push({rmse:c?Math.sqrt(s/c):NaN,mae:c?a/c:NaN,bias:c?b/c:NaN,n:c});
    S+=s;A+=a;B+=b;C+=c;
  }
  return {rmse:C?Math.sqrt(S/C):NaN,mae:C?A/C:NaN,bias:C?B/C:NaN,n:C,st};
}
/* Pearson correlation of departures from the (unmasked) climatology between every pair
   of stations, over cells that are daytime at both. "aligned" applies the same integer
   solar-time shift the longitude sheaf uses; "clock" compares at the same clock time. */
function pairCorrelations(U,CS){
  const all=[];for(let v=0;v<N;v++)all.push(new Uint8Array(T).fill(1));
  const Cl=mdvPrior(U,all,MDV_WIN);
  const dep=[],depS=[],day=[],dayS=[];
  for(let v=0;v<N;v++){
    const a=new Float64Array(T),dm=new Float64Array(T);
    const E=evalMask();
    for(let i=0;i<T;i++){a[i]=U[v][i]-Cl[v][i];dm[i]=E[i];}
    const as=new Float64Array(T),ds=new Float64Array(T);
    shiftInt(a,-lonShift(v),as);shiftInt(dm,-lonShift(v),ds);
    dep.push(a);day.push(dm);depS.push(as);dayS.push(ds);
  }
  function corr(x,y,mx,my){
    let n=0,sx=0,sy=0,sxx=0,syy=0,sxy=0;
    for(let i=0;i<T;i++)if(mx[i]&&my[i]){const a=x[i],b=y[i];n++;sx+=a;sy+=b;sxx+=a*a;syy+=b*b;sxy+=a*b;}
    if(n<3)return {r:NaN,n};
    const cov=sxy-sx*sy/n,vx=sxx-sx*sx/n,vy=syy-sy*sy/n;
    return {r:cov/Math.sqrt(vx*vy),n};
  }
  /* daily clear-sky index per station-day over the scoring hours, as the notebooks compute it
     (sum of GHI / sum of clear-sky GHI), here with the page's simple clear-sky model */
  const E=evalMask(),nd=Math.round(T/SPD),kd=[],ones=new Float64Array(nd).fill(1);
  for(let v=0;v<N;v++){const k=new Float64Array(nd);
    for(let d=0;d<nd;d++){let a=0,b=0;for(let s=0;s<SPD;s++){const i=d*SPD+s;if(E[i]){a+=U[v][i];b+=CS[v][i];}}k[d]=b>0?a/b:0;}
    kd.push(k);}
  const aligned=[],clock=[],nAligned=[],daily=[],raw=[];
  for(let i=0;i<N;i++){aligned.push(new Float64Array(N));clock.push(new Float64Array(N));nAligned.push(new Float64Array(N));daily.push(new Float64Array(N));raw.push(new Float64Array(N));}
  for(let i=0;i<N;i++){aligned[i][i]=1;clock[i][i]=1;daily[i][i]=1;raw[i][i]=1;
    for(let j=i+1;j<N;j++){
      const a=corr(depS[i],depS[j],dayS[i],dayS[j]),c=corr(dep[i],dep[j],day[i],day[j]);
      aligned[i][j]=aligned[j][i]=a.r;clock[i][j]=clock[j][i]=c.r;nAligned[i][j]=nAligned[j][i]=a.n;
      daily[i][j]=daily[j][i]=corr(kd[i],kd[j],ones,ones).r;
      raw[i][j]=raw[j][i]=corr(U[i],U[j],E,E).r;  /* raw GHI at equal clock time, scoring hours */
    }}
  return {aligned,clock,n:nAligned,daily,raw,kDaily:kd};
}

/* ================= engine: the message handler used by the worker and the fallback ===== */
/* loadRealPayload() must return (or resolve to) the object defined in assets/data/nlr1999.js */
function createEngine(loadRealPayload){
  const G=buildGraph();
  let ds=null,realU=null;
  const now=()=>(typeof performance!=='undefined'?performance.now():Date.now());
  function pack(R){const out=new Float64Array(N*T);for(let v=0;v<N;v++)out.set(R[v],v*T);return out;}
  function packMask(M){const out=new Uint8Array(N*T);for(let v=0;v<N;v++)out.set(M[v],v*T);return out;}
  async function load(p){
    const t0=now();
    if(p.kind==='real'){
      setGrid(REALMETA.DAYS,REALMETA.DOY0,REALMETA.START);
      if(!realU){const payload=await loadRealPayload();realU=decodeReal(payload);}
      ds={kind:'real',seed:p.seed,U:realU,CS:computeCS()};
    }else{
      setGrid(SYN.DAYS,SYN.DOY0,SYN.START);
      const d=genData(p.seed);ds={kind:'syn',seed:p.seed,U:d.U,CS:d.CS};
    }
    ds.key=p.kind+':'+p.seed;
    const out={key:ds.key,grid:grid(),ms:now()-t0};
    if(p.withArrays){
      out.U=pack(ds.U);out.CS=pack(ds.CS);
      const c=pairCorrelations(ds.U,ds.CS);
      out.corrAligned=c.aligned.map(r=>Array.from(r));out.corrClock=c.clock.map(r=>Array.from(r));
      out.corrN=c.n.map(r=>Array.from(r));out.corrDaily=c.daily.map(r=>Array.from(r));out.corrRaw=c.raw.map(r=>Array.from(r));
      out.kDaily=c.kDaily.map(r=>Array.from(r));
      out.transfer=[out.U.buffer,out.CS.buffer];
    }
    return out;
  }
  function ensure(p){if(!ds||ds.key!==p.dsKey)throw new Error('dataset '+p.dsKey+' not loaded (have '+(ds&&ds.key)+')');}
  function scenario(p){
    ensure(p);
    const U=ds.U,CS=ds.CS,tm={},t00=now();
    let t=now();
    const blk=BLOCKS[p.blockIdx].s;
    const {M,frac,nb}=buildBlockMask(blk,p.frac,p.maskSeed);tm.mask=now()-t;
    t=now();const stl=stmacJoint(U,M,G.Lg,p.r,p.g,true,MDV_WIN);tm.stl=now()-t;
    t=now();const pt=pureTemporal(U,M,AT);tm.pt=now()-t;
    t=now();const stt=stmacJoint(U,M,G.Lg,p.r,p.g,false,MDV_WIN);tm.stt=now()-t;
    t=now();const mdv=climFill(U,M,stl.C);tm.mdv=now()-t;
    t=now();const s0=stmacJoint(U,M,G.Lg,S0_R,S0_G,true,MDV_WIN,true);tm.s0=now()-t;
    t=now();
    const stats={PT:errorStats(U,pt,M),MDV:errorStats(U,mdv,M),STL:errorStats(U,stl.R,M),STT:errorStats(U,stt.R,M),S0:errorStats(U,s0.R,M)};
    tm.stats=now()-t;tm.total=now()-t00;
    const out={dsKey:ds.key,params:p,effFrac:frac,nb,n:stl.n,bw:stl.bw,ms:tm.stl,tm,
      rPT:rmseMasked(U,pt,M),rMDV:rmseMasked(U,mdv,M),rSTL:rmseMasked(U,stl.R,M),rSTT:rmseMasked(U,stt.R,M),rS0:rmseMasked(U,s0.R,M),
      stats,M:packMask(M),PT:pack(pt),MDV:pack(mdv),STL:pack(stl.R),STT:pack(stt.R),S0:pack(s0.R)};
    out.transfer=[out.M.buffer,out.PT.buffer,out.MDV.buffer,out.STL.buffer,out.STT.buffer,out.S0.buffer];
    return out;
  }
  function sweepBlock(p){
    ensure(p);
    const U=ds.U,CS=ds.CS,bl=BLOCKS[p.k],t0=now();
    const {M,frac}=buildBlockMask(bl.s,p.frac,p.maskSeed);
    const pt=rmseMasked(U,pureTemporal(U,M,AT),M);
    const jl=stmacJoint(U,M,G.Lg,p.r,p.g,true,MDV_WIN);
    const sl=rmseMasked(U,jl.R,M);
    const sT=rmseMasked(U,stmacJoint(U,M,G.Lg,p.r,p.g,false,MDV_WIN).R,M);
    const md=rmseMasked(U,climFill(U,M,jl.C),M);
    const s0=rmseMasked(U,stmacJoint(U,M,G.Lg,S0_R,S0_G,true,MDV_WIN,true).R,M);
    return {k:p.k,lab:bl.lab,pt,mdv:md,sl,st:sT,s0,frac,ms:now()-t0};
  }
  const ops={load,scenario,sweepBlock};
  return {
    handle:async function(msg){
      const op=ops[msg.op];
      if(!op)throw new Error('unknown op '+msg.op);
      return op(msg.p||{});
    }
  };
}

root.STMACCore={
  STATIONS,N,SPD,TZ,SYN,REALMETA,BLOCKS,AT,R_RATIO,RIDGE,MDV_WIN,GRAPH_K,GRAPH_SIGMA,DAY_CS,EVAL_H0,EVAL_H1,LON_MEAN,S0_R,S0_G,
  lonShiftMin,evalHour,evalMask,
  setGrid,grid,lonShift,mulberry32,clearSky,hav,genData,computeCS,decodeReal,distMatrix,buildGraph,
  tempSolve,shiftInt,buildBlockMask,pureTemporal,mdvPrior,climFill,stmacJoint,rmseMasked,errorStats,
  pairCorrelations,createEngine
};
})(typeof self!=='undefined'?self:this);
