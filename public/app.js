import {BrowserProvider,Contract,ContractFactory,formatUnits,parseUnits,toUtf8Bytes} from 'ethers';
import {sealBallot} from '../lib/timelock.mjs';
import {phase,DEMO_ARENA} from '../lib/commitments.mjs';
import {leaderboard} from '../lib/leaderboard.mjs';
let config,state,signer,address='',holder=false,busy=false,owned=[],displayedPhase=null;
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
  $('#wallet').textContent=address.slice(0,6)+'…'+address.slice(-4);await refresh();
}
async function refresh(){
  const selected=new URLSearchParams(location.search).get('round');
  state=await api('state?round='+encodeURIComponent(selected || '')+(busy?'&fresh=1':''));
  owned=config.mode==='demo'?state.ownedTokens:[];
  if(config.mode==='live' && address){
    const collection=new Contract(config.collection,['function balanceOf(address) view returns(uint256)','function ownerOf(uint256) view returns(address)'],signer);
    holder=(await collection.balanceOf(address))>0n;
    const ownership=await Promise.allSettled(config.nfts.map(async n=>({tokenId:n.tokenId,owner:await collection.ownerOf(n.tokenId)})));
    owned=ownership.filter(x=>x.status==='fulfilled' && x.value.owner.toLowerCase()===address.toLowerCase()).map(x=>x.value.tokenId);
    if(state.round){const e=await contract().entries(state.round.id,address);state.entry=e.committed?{committed:true,revealed:e.revealed,amount:e.amount.toString()}:null;}
    state.claims=[];for(const r of state.history){const p=await contract().payoutBreakdown(r.id,address);if(p.amount>0n)state.claims.push({id:r.id,gross:p.gross.toString(),fee:p.fee.toString(),amount:p.amount.toString()});}
  }
  render();
}
const accountAddress=()=>config.mode==='demo'?state.account.address:address;
const sameAddress=(a,b)=>Boolean(a && b && a.toLowerCase()===b.toLowerCase());
function occupied(id){return state.challenges.some(c=>c.tokenId===id) || state.rounds.some(r=>r.nftA===id || r.nftB===id);}
function options(ids){return ids.map(id=>`<option value="${id}">${esc(nft(id)?.name || 'CHOG')}</option>`).join('');}
function demoWallet(){return config.mode==='demo'?`<label class="role">Demo wallet<select id="demo-wallet"><option value="alice">Holder A</option><option value="bob">Holder B</option><option value="visitor">Non-holder</option></select></label>`:'';}
function bindDemoWallet(){if($('#demo-wallet')){$('#demo-wallet').value=state.persona;$('#demo-wallet').onchange=()=>run(()=>api('demo/wallet',{persona:$('#demo-wallet').value}));}}
async function createChallenge(tokenId){
  if(config.mode==='live' && !signer)await connect();
  if(config.mode==='demo')await api('challenges/create',{tokenId});else await(await contract().createChallenge(tokenId)).wait();
  toast('Battle request created. The 24-hour clock starts when another holder accepts.');
}
async function cancelChallenge(id){if(config.mode==='demo')await api('challenges/cancel',{id});else await(await contract().cancelChallenge(id)).wait();toast('Request cancelled. The NFT is available again.');}
function requests(list){
  const available=owned.filter(id=>!occupied(id));
  return list.length?`<div class="request-grid">${list.map(c=>{const n=nft(c.tokenId),mine=sameAddress(c.creator,accountAddress());return `<article class="request-card"><img src="${esc(n?.image || '/nfts/'+c.tokenId+'.webp')}" alt="${esc(n?.name || 'Chog')}"><div><span class="eyebrow">REQUEST #${c.id} · ${c.valid?'WAITING FOR OPPONENT':'OWNERSHIP CHANGED'}</span><h3>${esc(n?.name || 'Chog')}</h3><p>By ${esc(c.creator.slice(0,6)+'…'+c.creator.slice(-4))}</p>${mine || !c.valid?`<button data-cancel="${c.id}">${mine?'Cancel request':'Remove stale request'}</button>`:`<label for="accept-nft-${c.id}">Choose your NFT</label><select id="accept-nft-${c.id}" ${!available.length?'disabled':''}>${available.length?options(available):'<option>No available owned NFT</option>'}</select><button data-accept="${c.id}" ${!available.length?'disabled':''}>Accept & start 24h battle ↗</button>`}</div></article>`;}).join('')}</div>`:'<div class="empty">No open requests yet. Create one from your profile.</div>';
}
function bindRequests(){
  for(const b of document.querySelectorAll('[data-cancel]'))b.onclick=()=>run(()=>cancelChallenge(Number(b.dataset.cancel)));
  for(const b of document.querySelectorAll('[data-accept]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.accept),tokenId=Number($('#accept-nft-'+id).value);if(config.mode==='demo')await api('challenges/accept',{id,tokenId});else await(await contract().acceptChallenge(id,tokenId)).wait();toast('Battle started. Voting and stakes are now open for 24 hours.');});
}
function outcome(r){return r.cancelled?'Cancelled':r.winner===2?'Draw':(nft(r.winner===0?r.nftA:r.nftB)?.name || 'NFT')+' won!';}
function matches(list){return list.length?`<div class="match-list">${list.map(r=>`<a class="match-row" href="/?round=${r.id}"><div class="match-art">${[r.nftA,r.nftB].map(id=>`<img src="${esc(nft(id)?.image || '/nfts/'+id+'.webp')}" alt="${esc(nft(id)?.name || 'Chog')}">`).join('')}</div><div><strong>${esc(nft(r.nftA)?.name || 'Chog')} vs ${esc(nft(r.nftB)?.name || 'Chog')}</strong><p>Round #${r.id} · ${r.settled?esc(outcome(r)):phase(r)==='commit'?'Voting & stakes open':'Automatic opening'} · ${r.committedCount || 0} participants</p></div><span>View battle ↗</span></a>`).join('')}</div>`:'<div class="empty">No active battles. Accept a request to start one.</div>';}
function rewards(){
  if(!state.claims?.length)return;
  $('#content').insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id} · ${money(c.gross)} − ${money(c.fee)} fee = ${money(c.amount)} CHOG</span><button data-claim="${c.id}">Claim reward</button></div>`).join('')}</section>`);
  for(const b of document.querySelectorAll('[data-claim]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.claim);if(config.mode==='demo')await api('claim',{id});else await(await contract().claim(id)).wait();toast('Reward claimed');});
}
function renderLobby(){
  $('#content').innerHTML=`<section class="hero"><div><div class="eyebrow">HOLDER VS HOLDER</div><h1>Your Chog.<br><em>Your challenge.</em></h1><p class="intro">Create a request with your NFT. Another holder brings theirs.<br>Once accepted, the community has 24 hours to vote and stake.</p></div><a class="button-link" href="/profile">Create a battle ↗</a></section><div class="utility-row"><span>One NFT · one open request or active battle at a time</span>${demoWallet()}</div><section class="lobby-section"><div class="section-title"><h2>Open battle requests</h2><span>${state.challenges.length} waiting</span></div>${requests(state.challenges)}</section><section class="lobby-section"><div class="section-title"><h2>Active battles</h2><span>${state.rounds.length} ongoing</span></div>${matches(state.rounds)}</section>${state.history.length?`<section class="lobby-section"><h2>Recent contests</h2>${matches(state.history.slice(-8).reverse())}</section>`:''}`;
  bindRequests();bindDemoWallet();rewards();
}
function renderProfile(){
  const available=owned.filter(id=>!occupied(id)),mine=state.challenges.filter(c=>sameAddress(c.creator,accountAddress())),myIds=new Set(owned);
  $('#content').innerHTML=`<section class="hero"><div><div class="eyebrow">YOUR PROFILE</div><h1>Bring your <em>Chog.</em></h1><p class="intro">${accountAddress()?esc(accountAddress()):'Connect your wallet to see your Chog NFTs.'}</p></div>${demoWallet()}</section><p class="vote-note">Prototype: only the 10 imported NFTs are displayed. Ownership is checked again by the contract when creating and accepting a request. NFTs stay in their wallets.</p><section class="create-panel"><h2>Create a battle request</h2><p>Choose an available NFT you own to create a request. Voting has not started yet. Only a different holder accepting this request with their NFT starts the 24-hour battle.</p><div class="bet-controls"><div class="field"><label for="create-nft">YOUR AVAILABLE NFT</label><select id="create-nft" ${!available.length?'disabled':''}>${available.length?options(available):'<option>No available owned NFT</option>'}</select></div><button id="create-battle" ${!available.length?'disabled':''}>Confirm & create request ↗</button></div></section><section class="lobby-section"><h2>Your NFTs <span class="muted">(${owned.length})</span></h2>${owned.length?`<div class="owned-grid">${owned.map(id=>{const n=nft(id);return `<article class="owned-card"><img src="${esc(n?.image)}" alt="${esc(n?.name)}"><h3>${esc(n?.name)}</h3><span class="status-pill">${occupied(id)?'In a request or battle':'Available'}</span></article>`;}).join('')}</div>`:'<div class="empty">No imported Chog NFTs in this wallet. Non-holders can vote by staking in an active battle.</div>'}</section><section class="lobby-section"><h2>Your open requests</h2>${requests(mine)}</section><section class="lobby-section"><h2>Battles with your NFTs</h2>${matches(state.rounds.filter(r=>myIds.has(r.nftA) || myIds.has(r.nftB)))}</section>`;
  $('#create-battle').onclick=()=>run(()=>createChallenge(Number($('#create-nft').value)));bindRequests();bindDemoWallet();rewards();
}
function clock(){
  const r=state?.round;if(!r)return;const p=phase(r),target=p==='commit'?r.endsAt:p==='reveal' || p==='waiting'?r.revealEndsAt:r.endsAt;
  // Close controls at the deadline even while a participant is focused in an input.
  if(location.pathname==='/' && new URLSearchParams(location.search).has('round') && p!==displayedPhase){render();return;}
  const seconds=Math.max(0,Math.ceil((target-Date.now())/1000));const t=$('#countdown');if(t)t.textContent=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function resultBanner(r){
  let kind='opening',title='Waiting for the result',description='Voting and staking are closed. Choices open automatically; the final result will appear here.',visual='<span class="result-symbol" aria-hidden="true">…</span>';
  if(r.settled){
    if(r.cancelled){kind='cancelled';title='Round cancelled';description='';visual='<span class="result-symbol" aria-hidden="true">↩</span>';}
    else if(r.winner===2){kind='draw';title="Draw";description=`${r.votesA}–${r.votesB} votes`;visual='<span class="result-symbol" aria-hidden="true">=</span>';}
    else{kind='winner';const winner=nft(r.winner===0?r.nftA:r.nftB),votes=r.winner===0?[r.votesA,r.votesB]:[r.votesB,r.votesA];title=esc(winner?.name || 'Chog')+' won!';description=`${votes[0]}–${votes[1]} votes`;if(winner)visual=`<img src="${esc(winner.image)}" alt="${esc(winner.name)}" width="88" height="88">`;}
  }
  return `<section class="round-result result-${kind}" aria-labelledby="round-result-title"><div class="result-visual">${visual}</div><div><div class="eyebrow">ROUND #${r.id} · ${r.settled?'FINAL RESULT':'BETTING CLOSED'}</div><h1 id="round-result-title">${title}</h1>${description?`<p>${description}</p>`:''}<a class="result-link" href="/leaderboard">View leaderboard ↗</a></div></section>`;
}
function card(token,side){
  if(!token)return '<div class="empty">NFT not loaded.</div>';
  const r=state.round,canStake=config.mode==='demo'?state.account.holder:!address || holder;
  const closed=phase(r)!=='commit' || Boolean(state.entry);
  const tier=token.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis';
  return `<article class="nft-card"><div class="art-wrap"><img src="${esc(token.image)}" alt="${esc(token.name)}"><span class="art-tag">CONTENDER ${side?'B':'A'}</span></div><div class="card-info"><div class="name-row"><div><h2>${esc(token.name)}</h2><div class="collection-label">Chog Genesis</div></div><span class="trait">${esc(tier)}</span></div><div class="stats"><div><small>VOTES</small><strong>${r.settled?(side?r.votesB:r.votesA):'Sealed'}</strong></div><div><small>SIDE POOL</small><strong>${r.settled?money(side?r.poolB:r.poolA)+' CHOG':'Sealed'}</strong></div></div>${phase(r)==='commit'?`<button class="vote-btn" data-side="${side}" ${closed || !canStake?'disabled':''}>${state.entry?'Choice encrypted':'Participate without stake'}</button>`:''}</div></article>`;
}
function board(){
  const q=$('#search').value.toLowerCase(),rows=leaderboard(config.nfts,state.points,state.losses,state.draws).filter(n=>n.name.toLowerCase().includes(q) || String(n.tokenId).includes(q));
  $('#board').innerHTML=`<table><thead><tr><th>RANK</th><th>NFT</th><th>WINS</th><th>LOSSES</th><th>DRAWS</th><th></th></tr></thead><tbody>${rows.map(n=>`<tr><td class="rank">${n.rank}</td><td><div class="nft-cell"><img src="${esc(n.image)}" alt="${esc(n.name)}" width="48" height="48" loading="lazy"><div><strong>${esc(n.name)}</strong></div></div></td><td class="score">${n.wins}</td><td class="score">${n.losses}</td><td class="score">${n.draws}</td><td><a href="https://opensea.io/item/monad/${config.collection}/${n.tokenId}" target="_blank" rel="noreferrer" aria-label="View ${esc(n.name)} on OpenSea">↗</a></td></tr>`).join('') || '<tr><td colspan="6">No results yet. NFTs appear after a win, loss or qualifying draw.</td></tr>'}</tbody></table>`;
}
function render(){
  const values={};for(const e of document.querySelectorAll('input,select'))if(e.id)values[e.id]=e.value;
  if(config.mode==='demo')$('#wallet').textContent='Demo profile ↗';
  $('#mode').innerHTML=config.mode==='demo'?`<strong>DEMO MODE</strong> Fictional CHOG · ${config.demoFastRounds?'30-second test rounds':'24-hour rounds'} · choices encrypted until betting closes`:'<strong>LIVE · MONAD</strong> Choices encrypted until betting closes · wallet addresses and stake amounts are public';
  $('#arena-link').classList.toggle('active',location.pathname==='/');$('#leader-link').classList.toggle('active',location.pathname==='/leaderboard');$('#profile-link').classList.toggle('active',location.pathname==='/profile');const content=$('#content');
  if(location.pathname==='/profile'){renderProfile();return;}
  if(location.pathname==='/' && !new URLSearchParams(location.search).has('round')){renderLobby();return;}
  if(location.pathname==='/leaderboard'){
    content.innerHTML=`<div class="board-top"><div><div class="eyebrow">THE COMMUNITY HAS SPOKEN</div><h1>The beauty <em>leaderboard.</em></h1><p class="intro">NFTs with a 0 - 0 record are hidden. Cancelled battles are not counted.<br>Draws count only when at least two votes were cast.</p></div><input id="search" aria-label="Search NFTs" placeholder="Search name or token ID…" value="${esc(values.search || '')}"></div><div class="board" id="board"></div>`;$('#search').oninput=board;board();return;
  }
  if(location.pathname==='/setup'){
    content.innerHTML=`<section class="setup"><div class="eyebrow">ENCRYPTED ARENA SETUP</div><h1>Launch your <em>arena.</em></h1><p class="intro">Deploy the new time-encrypted contract on Monad. A separate funded keeper process automatically opens choices after closing. Deploying costs MON gas.</p><p class="intro">Treasury: ${esc(config.treasury)}<br>1% deducted after calculating each winning payout. Refunds have no fee.</p><button id="deploy">Deploy contract with wallet</button><div id="deployment-result"></div></section>`;
    $('#deploy').onclick=()=>run(async()=>{if(!signer)await connect();const a=await api('deployment'),d=await new ContractFactory(a.abi,a.bytecode,signer).deploy(config.token,config.collection,config.treasury);const receipt=await d.deploymentTransaction().wait();sessionStorage.setItem('deployed-arena',JSON.stringify({address:await d.getAddress(),block:receipt.blockNumber}));toast('Contract deployed; configure and run the keeper.');});
    const saved=sessionStorage.getItem('deployed-arena');if(saved){try{const d=JSON.parse(saved);$('#deployment-result').innerHTML=`<pre>ARENA_CONTRACT_ADDRESS=${esc(d.address)}\nKEEPER_FROM_BLOCK=${d.block}</pre><p class="intro">Configure a separate gas-funded keeper wallet locally and run npm run keeper. Never share its private key.</p>`;}catch{}}
    return;
  }
  const r=state.round,p=phase(r);displayedPhase=p;
  content.innerHTML=r && p!=='commit'?resultBanner(r):`<section class="hero"><div><div class="eyebrow">THE SEALED CHOG SHOWDOWN</div><h1>Your choice. <em>Under wraps.</em></h1><p class="intro">Pick your Chog. Your choice is encrypted in your browser.<br>After betting closes, choices open automatically.</p></div>${r && !r.settled?`<div class="timer"><small>${p==='commit'?'BETTING CLOSES IN':'AUTOMATIC OPENING'}</small><strong id="countdown">…</strong></div>`:''}</section>`;
  if(!r)content.insertAdjacentHTML('beforeend','<div class="empty">Battle not found. <a href="/">Browse battle requests ↗</a></div>');
  else{
    content.insertAdjacentHTML('beforeend',`<div class="round-bar"><span><span class="live-dot"></span>ROUND #${r.id} · ${r.settled?'COMPLETED':p==='commit'?'SEALED BETTING':p==='legacy'?'LEGACY ROUND':p==='settlement'?'FINALIZING':'AUTOMATIC OPENING'}</span><span>${r.committedCount ?? 0} participants · ${money(r.totalCommitted)} CHOG deposited</span></div><section class="battle">${card(nft(r.nftA),0)}<div class="versus">VS</div>${card(nft(r.nftB),1)}</section>${p==='commit'?`<p class="vote-note">One wallet = one vote. During betting, the chosen side is encrypted; addresses and stake amounts remain public.</p><section class="bet-panel"><div><h3>Seal your choice.</h3><p>Holders choose participation with or without a stake. Non-holders must stake CHOG. Only stakers receive payouts.<br>Your stake + share of the opposing bank is calculated first; then 1% is deducted. No fees on refunds.<br>No second reveal action is required from you.</p></div><div class="bet-controls"><div class="field"><label for="side">YOUR CONTENDER</label><select id="side"><option value="0">${esc(nft(r.nftA)?.name || 'A')}</option><option value="1">${esc(nft(r.nftB)?.name || 'B')}</option></select></div><div class="field"><label for="amount">STAKE · CHOG</label><input id="amount" type="number" min="0" step="any" value="10" inputmode="decimal"></div><button id="stake" ${state.entry || p!=='commit'?'disabled':''}>Seal stake & choice ↗</button></div></section>`:''}<div class="utility-row"><span>${config.mode==='demo'?'Demo balance: '+money(state.account.balance)+' CHOG':address?(holder?'Holder · stake optional':'Non-holder · stake required'):'Connect wallet to participate'}</span>${config.mode==='demo'?demoWallet():''}</div>`);
    for(const b of document.querySelectorAll('[data-side]'))b.onclick=()=>run(()=>cast(Number(b.dataset.side),'0'));
    if($('#stake'))$('#stake').onclick=()=>run(()=>cast(Number($('#side').value),$('#amount').value));
    if(config.mode==='demo')bindDemoWallet();
  }
  if(config.mode==='live' && address.toLowerCase()===config.treasury.toLowerCase()){
    content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="fees">Withdraw developer fees</button></div>');$('#fees').onclick=()=>run(async()=>{await(await contract().withdrawFees()).wait();});
  }
  if(p==='commit')content.insertAdjacentHTML('beforeend','<section class="info-grid"><div><strong>01 · Encrypted locally</strong><p>Your choice is sealed for a future drand beacon. Our server does not hold the decryption key.</p></div><div><strong>02 · Automatic opening</strong><p>After betting closes, the keeper decrypts and submits matching reveals. No second wallet action from you.</p></div><div><strong>03 · Claim your payout</strong><p>Gross payout first, then a 1% fee. Draws, one-sided pools and cancelled rounds return stakes in full.</p></div></section>');
  if(state.claims?.length){content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id} · ${money(c.gross)} − ${money(c.fee)} fee = ${money(c.amount)} CHOG</span><button data-claim="${c.id}">Claim reward</button></div>`).join('')}</section>`);for(const b of document.querySelectorAll('[data-claim]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.claim);if(config.mode==='demo')await api('claim',{id});else await(await contract().claim(id)).wait();toast('Reward claimed');});}
  if(state.history.length)content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Recent contests</h3>${state.history.slice().reverse().slice(0,8).map(x=>`<div class="history-item"><span>Round #${x.id} · ${esc(nft(x.nftA)?.name || 'Chog')} vs ${esc(nft(x.nftB)?.name || 'Chog')}</span><strong>${esc(outcome(x))}</strong></div>`).join('')}</section>`);
  for(const [id,value]of Object.entries(values)){const e=document.getElementById(id);if(e && id!=='role')e.value=value;}clock();
}
async function cast(side,amountText){
  const r=state.round;if(phase(r)!=='commit')throw Error('Betting is closed');const amount=parseUnits(amountText || '0',18);if(amount<0n)throw Error('Stake must not be negative');
  if(config.mode==='live' && !signer)await connect();
  const account=config.mode==='demo'?state.account.address:address;
  const hasNFT=config.mode==='demo'?state.account.holder:holder;
  const holderId=amount===0n?Number(owned[0]):0;
  if(amount===0n && !hasNFT)throw Error('Non-holders must stake CHOG to participate');
  if(config.mode==='live' && amount===0n && (!Number.isSafeInteger(holderId) || holderId<1))throw Error('No owned Chog is available in the imported prototype collection. Please place a stake or use a wallet with an imported Chog.');
  toast('Encrypting your choice locally…');
  const sealed=await sealBallot({arena:config.arenaAddress || DEMO_ARENA,chainId:config.chainId,roundId:r.id,account,side,tokenId:side===0?r.nftA:r.nftB,amount:amount.toString()},r.beaconRound);
  if(config.mode==='demo'){await api('commit',{...sealed,amount:amountText,roundId:r.id});toast('Choice encrypted. It will open automatically after closing.');return;}
  if(amount>0n){const token=new Contract(config.token,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],signer);if(await token.allowance(address,config.arenaAddress)<amount){toast('Approve the exact CHOG stake');await(await token.approve(config.arenaAddress,amount)).wait();}}
  toast('Confirm encrypted participation in your wallet');await(await contract().commitVote(r.id,sealed.commitment,amount,holderId,toUtf8Bytes(sealed.sealedChoice))).wait();toast('Encrypted choice recorded. The keeper handles opening.');
}
$('#wallet').onclick=()=>config.mode==='demo'?location.assign('/profile'):run(connect);
window.ethereum?.on?.('accountsChanged',()=>{address='';signer=null;holder=false;owned=[];$('#wallet').textContent='Connect wallet ↗';run(refresh);});window.ethereum?.on?.('chainChanged',()=>location.reload());
try{config=await api('config');await refresh();setInterval(()=>{if(!busy && !['INPUT','SELECT'].includes(document.activeElement.tagName))refresh().catch(e=>toast(e.message));},10000);setInterval(clock,1000);}catch(e){$('#content').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
