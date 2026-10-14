import {BrowserProvider,Contract,ContractFactory,formatUnits,parseUnits} from 'ethers';
let config,state,wallet,signer,address='',holder=false,owner=false,busy=false;
const $=selector=>document.querySelector(selector);
const esc=value=>String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const short=value=>value.slice(0,6)+'…'+value.slice(-4);
const money=value=>Number(formatUnits(BigInt(value || 0),18)).toLocaleString('en-US',{maximumFractionDigits:3});
const nft=id=>config.nfts.find(n=>n.tokenId===id);
const contract=()=>new Contract(config.arenaAddress,config.abi,signer);
async function api(path,body){
  const response=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw new Error(data.error);return data;
}
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',6500);}
async function run(action){if(busy)return;busy=true;try{await action();await refresh();}catch(error){toast(error.shortMessage || error.message);}finally{busy=false;}}
async function connect(){
  if(!window.ethereum)throw new Error('Install an EVM wallet such as MetaMask to connect. Demo mode works without a wallet.');
  wallet=new BrowserProvider(window.ethereum);await wallet.send('eth_requestAccounts',[]);
  await wallet.send('wallet_switchEthereumChain',[{chainId:'0x8f'}]);
  signer=await wallet.getSigner();address=await signer.getAddress();
  const collection=new Contract(config.collection,['function balanceOf(address) view returns(uint256)'],signer);
  holder=(await collection.balanceOf(address))>0n;
  owner=config.mode==='live' && (await contract().owner()).toLowerCase()===address.toLowerCase();
  $('#wallet').textContent=short(address); await refresh();
}
async function refresh(){
  state=await api('state');
  if(config.mode==='live' && address){
    if(state.round){const entry=await contract().entries(state.round.id,address);state.entry=entry.voted?{side:Number(entry.side),amount:entry.amount.toString()}:null;}
    state.claims=[];
    for(const round of state.history){const amount=await contract().payout(round.id,address);if(amount>0n)state.claims.push({id:round.id,amount:amount.toString()});}
  }
  render();
}
function timer(){const remaining=Math.max(0,Math.ceil(((state?.round?.endsAt || 0)-Date.now())/1000));const h=Math.floor(remaining/3600),m=Math.floor(remaining%3600/60),s=remaining%60;const el=$('#countdown');if(el)el.textContent=[h,m,s].map(x=>String(x).padStart(2,'0')).join(':');}
function card(token,side){
  if(!token)return '<div class="empty">NFT not in the current sample.</div>';
  const votes=side===0?state.round.votesA:state.round.votesB,pool=side===0?state.round.poolA:state.round.poolB;
  const tier=token.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis';
  const closed=state.round.settled || Date.now()>=state.round.endsAt;
  return `<article class="nft-card"><div class="art-wrap"><img src="${esc(token.image)}" alt="${esc(token.name)}"><span class="art-tag">CONTENDER ${side===0?'A':'B'}</span></div><div class="card-info"><div class="name-row"><div><h2>${esc(token.name)}</h2><div class="token-id">Token ID ${token.tokenId} · Chog Genesis</div></div><span class="trait">${esc(tier)}</span></div><div class="stats"><div><small>COMMUNITY VOTES</small><strong>${votes}</strong></div><div><small>STAKE POOL</small><strong>${money(pool)} <small>CHOG</small></strong></div><div><small>WINS</small><strong>${state.points[token.tokenId] || 0}</strong></div></div><button class="vote-btn" data-vote="${side}" ${state.entry || closed?'disabled':''}>${state.entry?state.entry.side===side?'✓ Your choice':'Vote locked':closed?'Voting closed':'♡ Vote for '+esc(token.name)}</button></div></article>`;
}
function render(){
  const values={};for(const el of document.querySelectorAll('input,select'))if(el.id)values[el.id]=el.value;
  $('#mode').innerHTML=config.mode==='demo'?'<strong>DEMO MODE</strong> Fictional CHOG balances. No real tokens are transferred.':'<strong>LIVE · MONAD</strong> Wallet transactions use real CHOG. Network gas fees apply.';
  $('#arena-link').classList.toggle('active',location.pathname==='/');$('#leader-link').classList.toggle('active',location.pathname==='/leaderboard');
  const content=$('#content');
  if(location.pathname==='/setup'){content.innerHTML=`<section class="setup"><div class="eyebrow">CONTRACT SETUP</div><h1>Launch your <em>arena.</em></h1><p class="intro">Deploy BeautyArena on Monad with your connected wallet. Deployment costs MON gas. This action creates the contract; it does not start voting.</p><p class="intro">NFT: ${esc(config.collection)}<br>CHOG: ${esc(config.token)}<br>Fee recipient: ${esc(config.treasury)}<br>Fee: 2.5% of the entire pool, including refunds.</p><button id="deploy">Deploy contract with wallet</button><a href="/">Back to arena</a><div id="deployment-result"></div></section>`;$('#deploy').onclick=()=>run(async()=>{if(!signer)await connect();const artifact=await api('deployment');toast('Confirm deployment in your wallet');const factory=new ContractFactory(artifact.abi,artifact.bytecode,signer);const deployed=await factory.deploy(config.token,config.collection,config.treasury);await deployed.waitForDeployment();const result=await deployed.getAddress();sessionStorage.setItem('deployed-arena',result);toast('Deployed: '+result);});const deployed=sessionStorage.getItem('deployed-arena');if(deployed)$('#deployment-result').innerHTML=`<p class="intro">Set this in .env, restart the server, and start the first round:</p><pre>ARENA_CONTRACT_ADDRESS=${esc(deployed)}</pre>`;return;}
  if(location.pathname==='/leaderboard'){
    content.innerHTML=`<div class="board-top"><div><div class="eyebrow">THE COMMUNITY HAS SPOKEN</div><h1>The beauty <em>leaderboard.</em></h1><p class="intro">One win. One point. Every Chog has a shot at the crown.<br>${config.nfts.length} NFTs loaded for the prototype · full collection: 1,969</p></div><input id="search" aria-label="Search NFTs" placeholder="Search name or token ID…" value="${esc(values.search || '')}"></div><div class="board" id="board"></div><p class="vote-note">Scores increase only after a completed 24-hour round. Ties award no points.</p>`;
    $('#search').oninput=board;board();return;
  }
  const round=state.round;
  content.innerHTML=`<section class="hero"><div><div class="eyebrow">THE DAILY CHOG SHOWDOWN</div><h1>Who wears it <em>better?</em></h1><p class="intro">Two Chogs enter. You choose who takes the crown.<br>Vote with your NFT, or back your favourite with CHOG.</p></div>${round?'<div class="timer"><small>ROUND ENDS IN</small><strong id="countdown">24:00:00</strong></div>':''}</section>`;
  if(!round){content.insertAdjacentHTML('beforeend','<div class="empty">No active round. The contract owner can start the first contest.</div>');}else{
    content.insertAdjacentHTML('beforeend',`<div class="round-bar"><span><span class="live-dot"></span>ROUND #${round.id} · 24-HOUR CONTEST</span><span>${round.votesA+round.votesB} votes · ${money(BigInt(round.poolA)+BigInt(round.poolB))} CHOG pooled</span></div><section class="battle">${card(nft(round.nftA),0)}<div class="versus">VS</div>${card(nft(round.nftB),1)}</section><p class="vote-note">One wallet = one vote. Your stake changes your potential reward, never your voting power.</p><section class="bet-panel"><div><h3>Back your favourite.</h3><p>Winners share the pool in proportion to their stake, after a 2.5% fee. NFT holders can vote with zero stake. Everyone else needs a stake.<br>Voting and staking happen together; you cannot switch sides or add a stake after voting.</p></div><div class="bet-controls"><div class="field"><label for="side">YOUR CONTENDER</label><select id="side"><option value="0">${esc(nft(round.nftA)?.name || 'A')}</option><option value="1">${esc(nft(round.nftB)?.name || 'B')}</option></select></div><div class="field"><label for="amount">STAKE · CHOG</label><input id="amount" type="number" min="0" step="any" value="${esc(values.amount || '10')}" inputmode="decimal"></div><button id="stake" ${state.entry || Date.now()>=round.endsAt || round.settled?'disabled':''}>Stake & vote ↗</button></div></section>`);
    const isHolder=config.mode==='demo'?state.account.holder:holder;
    content.insertAdjacentHTML('beforeend',`<div class="utility-row"><span>${config.mode==='demo'?'Demo balance: '+money(state.account.balance)+' CHOG':address?(isHolder?'Chog holder · free vote available':'No Chog NFT · stake to vote'):'Connect your wallet to vote'}</span>${config.mode==='demo'?'<div class="role"><label for="role">Demo role</label><select id="role"><option value="holder">NFT holder</option><option value="visitor">Non-holder</option></select><button id="finish">Finish demo round</button></div>':'<label class="role">Your NFT token ID (free vote)<input id="holder-id" type="number" min="1" placeholder="Token ID"></label>'}</div>`);
    if(config.mode==='demo'){$('#role').value=state.account.holder?'holder':'visitor';$('#role').onchange=()=>run(()=>api('demo/role',{holder:$('#role').value==='holder'}));$('#finish').onclick=()=>run(()=>api('demo/finish',{}));}
    for(const button of document.querySelectorAll('[data-vote]'))button.onclick=()=>run(()=>cast(Number(button.dataset.vote),'0'));
    $('#stake').onclick=()=>run(()=>cast(Number($('#side').value),$('#amount').value));
  }
  if(config.mode==='live' && address){
    if(round && !round.settled && Date.now()>=round.endsAt)content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="settle">Settle finished round</button></div>');
    if(owner && (!round || round.settled))content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="start-round">Start next random pair</button></div>');
    if(address.toLowerCase()===config.treasury.toLowerCase())content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="fees">Withdraw developer fees</button></div>');
    if($('#settle'))$('#settle').onclick=()=>run(async()=>{await(await contract().settle(round.id)).wait();toast('Round settled');});
    if($('#start-round'))$('#start-round').onclick=()=>run(async()=>{const pair=await api('pair');await(await contract().startRound(pair.a,pair.b)).wait();toast('Round started');});
    if($('#fees'))$('#fees').onclick=()=>run(async()=>{await(await contract().withdrawFees()).wait();toast('Fees withdrawn');});
  }
  content.insertAdjacentHTML('beforeend',`<section class="info-grid"><div><strong>01 · Pick your Chog</strong><p>Every contest runs for 24 hours. Choose a side once; every wallet gets one vote.</p></div><div><strong>02 · Make it count</strong><p>Holders can vote without staking. Stake CHOG to receive a share if your contender wins.</p></div><div><strong>03 · Claim your share</strong><p>A 2.5% fee applies to every pool. Ties or no winning stakes return the remaining pool to stakers.</p></div></section>`);
  if(state.claims?.length)content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id} · ${money(c.amount)} CHOG</span><button data-claim="${c.id}">Claim reward</button></div>`).join('')}</section>`);
  if(state.history.length)content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Recent contests</h3>${state.history.slice().reverse().slice(0,8).map(r=>`<div class="history-item"><span>Round #${r.id} · ${esc(nft(r.nftA)?.name || r.nftA)} vs ${esc(nft(r.nftB)?.name || r.nftB)}</span><strong>${r.winner===2?'Tie':esc(nft(r.winner===0?r.nftA:r.nftB)?.name || 'Winner')+' +1'}${r.refund?' · Refund −2.5%':''}</strong></div>`).join('')}</section>`);
  for(const button of document.querySelectorAll('[data-claim]'))button.onclick=()=>run(async()=>{const id=Number(button.dataset.claim);if(config.mode==='demo')await api('claim',{id});else await(await contract().claim(id)).wait();toast('Reward claimed');});
  for(const [id,value]of Object.entries(values)){const el=document.getElementById(id);if(el && id!=='role')el.value=value;}
  timer();
}
function board(){
  const query=$('#search').value.toLowerCase();
  const rows=config.nfts.slice().sort((a,b)=>(state.points[b.tokenId] || 0)-(state.points[a.tokenId] || 0) || a.tokenId-b.tokenId).map((token,index)=>({...token,rank:index+1})).filter(n=>n.name.toLowerCase().includes(query) || String(n.tokenId).includes(query));
  $('#board').innerHTML=`<table><thead><tr><th>RANK</th><th>CONTENDER</th><th>TOKEN ID</th><th>POINTS</th><th>TRAIT</th><th></th></tr></thead><tbody>${rows.map(n=>`<tr><td class="rank">${n.rank<=3?'✦ ':''}${n.rank}</td><td><div class="nft-cell"><img src="${esc(n.image)}" alt="${esc(n.name)}" loading="lazy"><strong>${esc(n.name)}</strong></div></td><td>#${n.tokenId}</td><td class="score">${state.points[n.tokenId] || 0}</td><td>${esc(n.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis')}</td><td><a href="https://opensea.io/item/monad/${config.collection}/${n.tokenId}" target="_blank" rel="noreferrer" aria-label="View ${esc(n.name)} on OpenSea">↗</a></td></tr>`).join('') || '<tr><td colspan="6">No matching NFTs</td></tr>'}</tbody></table>`;
}
async function cast(side,amountText){
  const amount=parseUnits(amountText || '0',18);if(amount<0n)throw new Error('Stake must be non-negative');
  if(config.mode==='demo'){await api('vote',{side,amount:amountText});toast('Demo vote recorded');return;}
  if(!signer)await connect();
  const holderTokenId=amount===0n?Number($('#holder-id')?.value):0;
  if(amount===0n && (!holder || !Number.isSafeInteger(holderTokenId) || holderTokenId<1))throw new Error('Enter a token ID you own for a free vote, or place a stake.');
  if(amount>0n){const token=new Contract(config.token,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],signer);if(await token.allowance(address,config.arenaAddress)<amount){toast('Approve the exact CHOG stake in your wallet');await(await token.approve(config.arenaAddress,amount)).wait();}}
  toast('Confirm your vote in your wallet');await(await contract().vote(state.round.id,side,amount,holderTokenId)).wait();toast('Vote confirmed on Monad');
}
$('#wallet').onclick=()=>run(connect);
if(window.ethereum){window.ethereum.on?.('accountsChanged',()=>{address='';signer=null;holder=false;owner=false;$('#wallet').textContent='Connect wallet ↗';run(refresh);});window.ethereum.on?.('chainChanged',()=>location.reload());}
try{config=await api('config');await refresh();setInterval(()=>{if(!busy && !['INPUT','SELECT'].includes(document.activeElement.tagName))refresh().catch(error=>toast(error.message));},10000);setInterval(timer,1000);}catch(error){$('#content').innerHTML='<div class="empty">'+esc(error.message)+'</div>';}
