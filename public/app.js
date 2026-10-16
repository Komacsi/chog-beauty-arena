import {BrowserProvider,Contract,ContractFactory,formatUnits,parseUnits,toUtf8Bytes} from 'ethers';
import {sealBallot} from '../lib/timelock.mjs';
import {phase,DEMO_ARENA} from '../lib/commitments.mjs';
let config,state,signer,address='',holder=false,owner=false,busy=false;
const $=s=>document.querySelector(s);
const esc=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=v=>Number(formatUnits(BigInt(v || 0),18)).toLocaleString('en-US',{maximumFractionDigits:3});
const nft=id=>config.nfts.find(n=>n.tokenId===id);
const contract=()=>new Contract(config.arenaAddress,config.abi,signer);
async function api(path,body){const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',7000);}
async function run(fn){if(busy)return;busy=true;try{await fn();await refresh();}catch(e){toast(e.shortMessage || e.message);}finally{busy=false;}}
async function connect(){
  if(!window.ethereum)throw Error('Connect an EVM wallet. Demo mode does not require one.');
  const wallet=new BrowserProvider(window.ethereum);await wallet.send('eth_requestAccounts',[]);await wallet.send('wallet_switchEthereumChain',[{chainId:'0x8f'}]);signer=await wallet.getSigner();address=await signer.getAddress();
  holder=(await new Contract(config.collection,['function balanceOf(address) view returns(uint256)'],signer).balanceOf(address))>0n;
  owner=config.mode==='live' && (await contract().owner()).toLowerCase()===address.toLowerCase();$('#wallet').textContent=address.slice(0,6)+'…'+address.slice(-4);await refresh();
}
async function refresh(){
  state=await api('state');
  if(config.mode==='live' && address){
    if(state.round){const e=await contract().entries(state.round.id,address);state.entry=e.committed?{committed:true,revealed:e.revealed,amount:e.amount.toString()}:null;}
    state.claims=[];for(const r of state.history){const p=await contract().payoutBreakdown(r.id,address);if(p.amount>0n)state.claims.push({id:r.id,gross:p.gross.toString(),fee:p.fee.toString(),amount:p.amount.toString()});}
  }
  render();
}
function clock(){
  const r=state?.round;if(!r)return;const p=phase(r),target=p==='commit'?r.endsAt:p==='reveal' || p==='waiting'?r.revealEndsAt:r.endsAt;
  const seconds=Math.max(0,Math.ceil((target-Date.now())/1000));const t=$('#countdown');if(t)t.textContent=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function card(token,side){
  if(!token)return '<div class="empty">NFT not loaded.</div>';
  const r=state.round,canStake=config.mode==='demo'?state.account.holder:!address || holder;
  const closed=phase(r)!=='commit' || Boolean(state.entry);
  const tier=token.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis';
  return `<article class="nft-card"><div class="art-wrap"><img src="${esc(token.image)}" alt="${esc(token.name)}"><span class="art-tag">CONTENDER ${side?'B':'A'}</span></div><div class="card-info"><div class="name-row"><div><h2>${esc(token.name)}</h2><div class="token-id">Token ID ${token.tokenId} · Chog Genesis</div></div><span class="trait">${esc(tier)}</span></div><div class="stats"><div><small>VOTES</small><strong>${r.settled?(side?r.votesB:r.votesA):'Sealed'}</strong></div><div><small>SIDE POOL</small><strong>${r.settled?money(side?r.poolB:r.poolA)+' CHOG':'Sealed'}</strong></div><div><small>WINS</small><strong>${state.points[token.tokenId] || 0}</strong></div></div><button class="vote-btn" data-side="${side}" ${closed || !canStake?'disabled':''}>${state.entry?'Choice encrypted':phase(r)!=='commit'?'Betting closed':'Participate without stake'}</button></div></article>`;
}
function board(){
  const q=$('#search').value.toLowerCase(),rows=config.nfts.slice().sort((a,b)=>(state.points[b.tokenId] || 0)-(state.points[a.tokenId] || 0) || a.tokenId-b.tokenId).map((n,i)=>({...n,rank:i+1})).filter(n=>n.name.toLowerCase().includes(q) || String(n.tokenId).includes(q));
  $('#board').innerHTML=`<table><thead><tr><th>RANK</th><th>CONTENDER</th><th>TOKEN ID</th><th>POINTS</th><th>TRAIT</th><th></th></tr></thead><tbody>${rows.map(n=>`<tr><td class="rank">${n.rank}</td><td><div class="nft-cell"><img src="${esc(n.image)}" alt="${esc(n.name)}" loading="lazy"><strong>${esc(n.name)}</strong></div></td><td>#${n.tokenId}</td><td class="score">${state.points[n.tokenId] || 0}</td><td>${esc(n.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis')}</td><td><a href="https://opensea.io/item/monad/${config.collection}/${n.tokenId}" target="_blank" rel="noreferrer">↗</a></td></tr>`).join('') || '<tr><td colspan="6">No matching NFTs</td></tr>'}</tbody></table>`;
}
function render(){
  const values={};for(const e of document.querySelectorAll('input,select'))if(e.id)values[e.id]=e.value;
  $('#mode').innerHTML=config.mode==='demo'?`<strong>DEMO MODE</strong> Fictional CHOG · ${config.demoFastRounds?'30-second test rounds':'24-hour rounds'} · choices encrypted until betting closes`:'<strong>LIVE · MONAD</strong> Choices encrypted until betting closes · wallet addresses and stake amounts are public';
  $('#arena-link').classList.toggle('active',location.pathname==='/');$('#leader-link').classList.toggle('active',location.pathname==='/leaderboard');const content=$('#content');
  if(location.pathname==='/leaderboard'){
    content.innerHTML=`<div class="board-top"><div><div class="eyebrow">THE COMMUNITY HAS SPOKEN</div><h1>The beauty <em>leaderboard.</em></h1><p class="intro">One win. One point. ${config.nfts.length} prototype NFTs.</p></div><input id="search" aria-label="Search NFTs" placeholder="Search name or token ID…" value="${esc(values.search || '')}"></div><div class="board" id="board"></div>`;$('#search').oninput=board;board();return;
  }
  if(location.pathname==='/setup'){
    content.innerHTML=`<section class="setup"><div class="eyebrow">ENCRYPTED ARENA SETUP</div><h1>Launch your <em>arena.</em></h1><p class="intro">Deploy the new time-encrypted contract on Monad. A separate funded keeper process automatically opens choices after closing. Deploying costs MON gas.</p><p class="intro">Treasury: ${esc(config.treasury)}<br>1% deducted after calculating each winning payout. Refunds have no fee.</p><button id="deploy">Deploy contract with wallet</button><div id="deployment-result"></div></section>`;
    $('#deploy').onclick=()=>run(async()=>{if(!signer)await connect();const a=await api('deployment'),d=await new ContractFactory(a.abi,a.bytecode,signer).deploy(config.token,config.collection,config.treasury);const receipt=await d.deploymentTransaction().wait();sessionStorage.setItem('deployed-arena',JSON.stringify({address:await d.getAddress(),block:receipt.blockNumber}));toast('Contract deployed; configure and run the keeper.');});
    const saved=sessionStorage.getItem('deployed-arena');if(saved){try{const d=JSON.parse(saved);$('#deployment-result').innerHTML=`<pre>ARENA_CONTRACT_ADDRESS=${esc(d.address)}\nKEEPER_FROM_BLOCK=${d.block}</pre><p class="intro">Configure a separate gas-funded keeper wallet locally and run npm run keeper. Never share its private key.</p>`;}catch{}}
    return;
  }
  const r=state.round,p=phase(r);
  content.innerHTML=`<section class="hero"><div><div class="eyebrow">THE SEALED CHOG SHOWDOWN</div><h1>Your choice. <em>Under wraps.</em></h1><p class="intro">Pick your Chog. Your choice is encrypted in your browser.<br>After betting closes, choices open automatically.</p></div>${r?`<div class="timer"><small>${p==='commit'?'BETTING CLOSES IN':'AUTOMATIC OPENING'}</small><strong id="countdown">…</strong></div>`:''}</section>`;
  if(!r)content.insertAdjacentHTML('beforeend','<div class="empty">The contract owner can start the first round.</div>');
  else{
    content.insertAdjacentHTML('beforeend',`<div class="round-bar"><span><span class="live-dot"></span>ROUND #${r.id} · ${p==='commit'?'SEALED BETTING':p==='legacy'?'LEGACY ROUND':p==='settlement'?'FINALIZING':'AUTOMATIC OPENING'}</span><span>${r.committedCount ?? 0} participants · ${money(r.totalCommitted)} CHOG deposited</span></div><section class="battle">${card(nft(r.nftA),0)}<div class="versus">VS</div>${card(nft(r.nftB),1)}</section><p class="vote-note">One wallet = one vote. During betting, the chosen side is encrypted; addresses and stake amounts remain public.</p><section class="bet-panel"><div><h3>Seal your choice.</h3><p>Holders choose participation with or without a stake. Non-holders must stake CHOG. Only stakers receive payouts.<br>Your stake + share of the opposing bank is calculated first; then 1% is deducted. No fees on refunds.<br>No second reveal action is required from you.</p></div><div class="bet-controls"><div class="field"><label for="side">YOUR CONTENDER</label><select id="side"><option value="0">${esc(nft(r.nftA)?.name || 'A')}</option><option value="1">${esc(nft(r.nftB)?.name || 'B')}</option></select></div><div class="field"><label for="amount">STAKE · CHOG</label><input id="amount" type="number" min="0" step="any" value="10" inputmode="decimal"></div><button id="stake" ${state.entry || p!=='commit'?'disabled':''}>Seal stake & choice ↗</button></div></section><div class="utility-row"><span>${config.mode==='demo'?'Demo balance: '+money(state.account.balance)+' CHOG':address?(holder?'Holder · stake optional':'Non-holder · stake required'):'Connect wallet to participate'}</span>${config.mode==='demo'?'<div class="role"><label for="role">Demo role</label><select id="role"><option value="holder">NFT holder</option><option value="visitor">Non-holder</option></select><button id="cancel">Cancel demo & refund</button></div>':'<label class="role">Owned NFT token ID (if no stake)<input id="holder-id" type="number" min="1" placeholder="Token ID"></label>'}</div>`);
    if(p!=='commit')content.insertAdjacentHTML('beforeend',`<p class="vote-note">${r.keeperStatus || 'Betting is closed. The keeper opens encrypted choices after their scheduled unlock time. If opening is incomplete at the deadline, the round is cancelled and stakes are refunded in full.'}</p>`);
    for(const b of document.querySelectorAll('[data-side]'))b.onclick=()=>run(()=>cast(Number(b.dataset.side),'0'));
    $('#stake').onclick=()=>run(()=>cast(Number($('#side').value),$('#amount').value));
    if(config.mode==='demo'){$('#role').value=state.account.holder?'holder':'visitor';$('#role').onchange=()=>run(()=>api('demo/role',{holder:$('#role').value==='holder'}));$('#cancel').onclick=()=>run(()=>api('demo/cancel',{}));}
  }
  if(config.mode==='live' && owner && (!r || r.settled)){
    content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="start-round">Start next random pair</button></div>');$('#start-round').onclick=()=>run(async()=>{const pair=await api('pair');await(await contract().startRound(pair.a,pair.b)).wait();});
  }
  if(config.mode==='live' && address.toLowerCase()===config.treasury.toLowerCase()){
    content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="fees">Withdraw developer fees</button></div>');$('#fees').onclick=()=>run(async()=>{await(await contract().withdrawFees()).wait();});
  }
  content.insertAdjacentHTML('beforeend','<section class="info-grid"><div><strong>01 · Encrypted locally</strong><p>Your choice is sealed for a future drand beacon. Our server does not hold the decryption key.</p></div><div><strong>02 · Automatic opening</strong><p>After betting closes, the keeper decrypts and submits matching reveals. No second wallet action from you.</p></div><div><strong>03 · Claim your payout</strong><p>Gross payout first, then a 1% fee. Ties, one-sided pools and cancelled rounds return stakes in full.</p></div></section>');
  if(state.claims?.length){content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id} · ${money(c.gross)} − ${money(c.fee)} fee = ${money(c.amount)} CHOG</span><button data-claim="${c.id}">Claim reward</button></div>`).join('')}</section>`);for(const b of document.querySelectorAll('[data-claim]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.claim);if(config.mode==='demo')await api('claim',{id});else await(await contract().claim(id)).wait();toast('Reward claimed');});}
  if(state.history.length)content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Recent contests</h3>${state.history.slice().reverse().slice(0,8).map(x=>`<div class="history-item"><span>Round #${x.id} · ${esc(nft(x.nftA)?.name || x.nftA)} vs ${esc(nft(x.nftB)?.name || x.nftB)}</span><strong>${x.cancelled?'Cancelled · full refund':x.winner===2?'Tie · full refund':esc(nft(x.winner===0?x.nftA:x.nftB)?.name || 'Winner')+' +1'+(x.refund?' · Full refund':'')}</strong></div>`).join('')}</section>`);
  for(const [id,value]of Object.entries(values)){const e=document.getElementById(id);if(e && id!=='role')e.value=value;}clock();
}
async function cast(side,amountText){
  const r=state.round;if(phase(r)!=='commit')throw Error('Betting is closed');const amount=parseUnits(amountText || '0',18);if(amount<0n)throw Error('Stake must not be negative');
  if(config.mode==='live' && !signer)await connect();
  const account=config.mode==='demo'?state.account.address:address;
  const hasNFT=config.mode==='demo'?state.account.holder:holder;
  const holderId=amount===0n?Number($('#holder-id')?.value || 0):0;
  if(amount===0n && !hasNFT)throw Error('Non-holders must stake CHOG to participate');
  if(config.mode==='live' && amount===0n && (!Number.isSafeInteger(holderId) || holderId<1))throw Error('Enter a contract token ID you own, or place a stake');
  toast('Encrypting your choice locally…');
  const sealed=await sealBallot({arena:config.arenaAddress || DEMO_ARENA,chainId:config.chainId,roundId:r.id,account,side,tokenId:side===0?r.nftA:r.nftB,amount:amount.toString()},r.beaconRound);
  if(config.mode==='demo'){await api('commit',{...sealed,amount:amountText});toast('Choice encrypted. It will open automatically after closing.');return;}
  if(amount>0n){const token=new Contract(config.token,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],signer);if(await token.allowance(address,config.arenaAddress)<amount){toast('Approve the exact CHOG stake');await(await token.approve(config.arenaAddress,amount)).wait();}}
  toast('Confirm encrypted participation in your wallet');await(await contract().commitVote(r.id,sealed.commitment,amount,holderId,toUtf8Bytes(sealed.sealedChoice))).wait();toast('Encrypted choice recorded. The keeper handles opening.');
}
$('#wallet').onclick=()=>run(connect);
window.ethereum?.on?.('accountsChanged',()=>{address='';signer=null;holder=false;owner=false;$('#wallet').textContent='Connect wallet ↗';run(refresh);});window.ethereum?.on?.('chainChanged',()=>location.reload());
try{config=await api('config');await refresh();setInterval(()=>{if(!busy && !['INPUT','SELECT'].includes(document.activeElement.tagName))refresh().catch(e=>toast(e.message));},10000);setInterval(clock,1000);}catch(e){$('#content').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
