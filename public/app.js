import {BrowserProvider,Contract,ContractFactory,formatUnits,parseUnits} from 'ethers';
import {formatTokenAmount} from '../lib/amounts.mjs';
import {sealBallot} from '../lib/timelock.mjs';
import {phase,DEMO_ARENA} from '../lib/commitments.mjs';
import {leaderboard} from '../lib/leaderboard.mjs';
import {validateGovernance} from '../lib/governance.mjs';
import {submitLiveBet,submitLiveHolderVotes} from '../lib/live-bet.mjs';
import {holderTokensHash,normalizeHolderTokens,MAX_HOLDER_BATCH} from '../lib/holder-ballots.mjs';
import {discoverOwnedChogs,ownershipAbi} from '../lib/wallet-nfts.mjs';
import {isRoundParticipant} from '../lib/voting-eligibility.mjs';
let config,state,signer,address='',holder=false,busy=false,owned=[],displayedPhase=null;
let walletEpoch=0,ownershipLoading=false,ownershipError='';
let claimWallet='',claimBefore=Number.MAX_SAFE_INTEGER,claimHasMore=false,claimLast=0;
const metadataQueue=[],metadataPending=new Set(),metadataFailed=new Set();let metadataWorkers=0,nftRenderTimer;
const nftSelections=new Map(),holderSelections=new Map();
const $=s=>document.querySelector(s);
const esc=v=>String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=formatTokenAmount;
function nft(id){
  if(!Number.isSafeInteger(id) || id<1 || id>1969)return;
  let record=config.nfts.find(n=>n.tokenId===id);
  if(!record){record={tokenId:id,name:'CHOG',image:'/nft-placeholder.svg',attributes:[],pending:true};config.nfts.push(record);}
  return record;
}
const battleWindow=()=>config.mode==='demo' && config.demoFastRounds?'2 minutes':'24 hours';
const battleLength=()=>config.mode==='demo' && config.demoFastRounds?'2-minute':'24-hour';
const contract=()=>new Contract(config.arenaAddress,config.abi,signer);
async function api(path,body){const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw Error(data.error);return data;}
function toast(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('#toast').style.display='none',7000);}
async function run(fn){if(busy)return;busy=true;try{await fn();}catch(e){toast(e.shortMessage || e.message);}finally{try{await refresh();}catch(e){toast(e.shortMessage || e.message);}busy=false;}}
function setWalletMenu(open){
  open=Boolean(open && address && config?.mode==='live');
  $('#wallet-menu').hidden=!open;$('#wallet').setAttribute('aria-expanded',String(open));
}
function clearWallet(){
  walletEpoch++;address='';signer=null;holder=false;owned=[];
  ownershipLoading=false;ownershipError='';
  claimWallet='';claimBefore=Number.MAX_SAFE_INTEGER;claimHasMore=false;claimLast=0;
  nftSelections.clear();holderSelections.clear();
  if(state){state.claims=[];state.betCount=0;state.usedNfts=[];}
  setWalletMenu(false);$('#wallet').textContent='Connect wallet';
  if(config && state)render();
}
async function connect(){
  if(!window.ethereum)throw Error('Connect an EVM wallet. Demo mode does not require one.');
  const wallet=new BrowserProvider(window.ethereum);await wallet.send('eth_requestAccounts',[]);await wallet.send('wallet_switchEthereumChain',[{chainId:'0x8f'}]);signer=await wallet.getSigner();address=await signer.getAddress();
  ownershipLoading=true;ownershipError='';render();
  $('#wallet').textContent=address.slice(0,6)+'…'+address.slice(-4);await refresh();
}
async function refresh(){
  const currentSigner=signer,currentAddress=address,currentEpoch=walletEpoch;
  const currentWallet=()=>currentEpoch===walletEpoch && signer===currentSigner && address===currentAddress;
  const selected=new URLSearchParams(location.search).get('round');
  const latest=await api('state?round='+encodeURIComponent(selected || '')+(busy?'&fresh=1':''));
  if(!currentWallet())return;state=latest;
  owned=config.mode==='demo'?state.ownedTokens:[];
  if(config.mode==='live' && address){
    try{
      const collection=new Contract(config.collection,ownershipAbi,currentSigner),blockTag=await currentSigner.provider.getBlockNumber();
      const {assertWallet}=capturedWallet(currentAddress);
      const found=await discoverOwnedChogs({collection,account:currentAddress,blockTag,assertWallet});
      if(!currentWallet())return;owned=found;holder=owned.length>0;ownershipError='';
    }catch(error){if(!currentWallet())return;owned=[];holder=false;ownershipError=error.shortMessage || error.message;}
    ownershipLoading=false;
    if(state.round){
      const readContract=new Contract(config.arenaAddress,config.abi,currentSigner),roundId=state.round.id,tokenIds=[...owned];
      const betCount=Number(await readContract.betCount(roundId,currentAddress));
      if(!currentWallet())return;
      const usage=await Promise.all(tokenIds.map(id=>readContract.unstakedVoteUsed(roundId,id)));
      if(!currentWallet())return;
      state.betCount=betCount;state.usedNfts=tokenIds.filter((_,i)=>usage[i]);
    }
    if(claimWallet!==currentAddress){claimWallet=currentAddress;claimBefore=Number.MAX_SAFE_INTEGER;}
    const page=await api('wallet-rounds?account='+encodeURIComponent(currentAddress)+'&before='+claimBefore);
    if(!currentWallet())return;
    claimHasMore=page.hasMore;claimLast=page.ids.at(-1)||0;
    const readContract=new Contract(config.arenaAddress,config.abi,currentSigner),claims=[];
    for(let offset=0;offset<page.ids.length;offset+=4){
      const batch=await Promise.all(page.ids.slice(offset,offset+4).map(async id=>({id,p:await readContract.payoutBreakdown(id,currentAddress)})));
      if(!currentWallet())return;for(const {id,p}of batch)if(p.amount>0n)claims.push({id,gross:p.gross.toString(),fee:p.fee.toString(),amount:p.amount.toString()});
    }
    state.claims=claims;
  }
  render();
}
function queueNftDetails(){
  const ids=new Set([...owned,...state.challenges.map(c=>c.tokenId),...state.rounds.flatMap(r=>[r.nftA,r.nftB]),...state.history.slice(-8).flatMap(r=>[r.nftA,r.nftB]),...(state.round?[state.round.nftA,state.round.nftB]:[])]);
  for(const totals of [state.points,state.losses,state.draws])for(const id of Object.keys(totals || {}))if(totals[id]>0)ids.add(Number(id));
  for(const id of ids){const record=nft(id);if(record?.pending && !metadataPending.has(id) && !metadataFailed.has(id)){metadataPending.add(id);metadataQueue.push(id);}}
  while(metadataWorkers<3 && metadataQueue.length)loadNftDetails();
}
async function loadNftDetails(){
  metadataWorkers++;
  try{while(metadataQueue.length){const id=metadataQueue.shift();
    try{const record=await api('nfts/'+id);if(record.tokenId!==id || typeof record.name!=='string' || !Array.isArray(record.attributes) || !/^\/(?:api\/nfts\/\d+\/image|nfts\/\d+\.(?:webp|png|jpg|gif))$/.test(record.image))throw Error('Invalid NFT details');Object.assign(nft(id),record,{pending:false});metadataFailed.delete(id);}
    catch{metadataFailed.add(id);}finally{metadataPending.delete(id);}
    clearTimeout(nftRenderTimer);nftRenderTimer=setTimeout(()=>{if(!busy && !document.querySelector('[data-picker-toggle][aria-expanded="true"]'))render();else updateNftStatus();},100);
  }}finally{metadataWorkers--;updateNftStatus();}
}
function updateNftStatus(){
  const failedImages=config.nfts.filter(n=>n.failedImage),hasErrors=metadataFailed.size || failedImages.length || ownershipError;
  let note=$('#nft-load-status');
  if(!ownershipLoading && !metadataPending.size && !hasErrors){note?.remove();return;}
  if(!note){note=document.createElement('div');note.id='nft-load-status';note.className='nft-load-status';note.setAttribute('aria-live','polite');const hero=$('.hero,.board-top,.round-result');if(hero)hero.insertAdjacentElement('afterend',note);else $('#content').append(note);}
  note.innerHTML=`<span>${ownershipLoading?'Finding your Chog NFTs…':ownershipError?'Your NFTs could not be loaded. Please retry.':hasErrors?'Some NFT details or images could not be loaded. Your NFTs remain available.':'Loading NFT details…'}</span>${hasErrors?'<button type="button" id="retry-nft-details">Retry</button>':''}`;
  if($('#retry-nft-details'))$('#retry-nft-details').onclick=()=>{metadataFailed.clear();for(const record of failedImages){record.image=record.failedImage;delete record.failedImage;}if(ownershipError)run(refresh);else{queueNftDetails();render();}};
}
function enhanceNftImages(){
  for(const img of document.querySelectorAll('main img')){
    img.onerror=()=>{const match=new URL(img.src,location.href).pathname.match(/^\/(?:api\/nfts\/|nfts\/)(\d+)(?:\/image|\.[a-z]+)$/),record=match?nft(Number(match[1])):null;img.onerror=null;if(record){record.failedImage=record.image;record.image='/nft-placeholder.svg';}img.src='/nft-placeholder.svg';updateNftStatus();};
  }
  queueNftDetails();updateNftStatus();
}
const accountAddress=()=>config.mode==='demo'?state.account.address:address;
const sameAddress=(a,b)=>Boolean(a && b && a.toLowerCase()===b.toLowerCase());
function occupied(id){return state.challenges.some(c=>c.tokenId===id) || state.rounds.some(r=>r.nftA===id || r.nftB===id);}
function selectionKey(id){return `${(accountAddress() || '').toLowerCase()}:${id}`;}
function selectedNft(id,available){
  const key=selectionKey(id),saved=nftSelections.get(key),value=available.includes(saved)?saved:available[0];
  nftSelections.set(key,value);return value;
}
function options(ids,selected=ids[0]){return ids.map(id=>`<option value="${id}" ${id===selected?'selected':''}>${esc(nft(id)?.name || 'CHOG')}</option>`).join('');}
function nftPicker(id,available){
  const selected=selectedNft(id,available),choice=nft(selected);
  return `<div class="nft-picker"><span class="picker-label" id="${id}-label">Choose your NFT</span><input type="hidden" id="${id}" value="${selected ?? ''}"><button type="button" class="nft-picker-toggle" data-picker-toggle="${id}" aria-labelledby="${id}-label ${id}-value" aria-haspopup="listbox" aria-expanded="false" aria-controls="${id}-options" ${!available.length?'disabled':''}>${choice?`<img loading="lazy" decoding="async" src="${esc(choice.image)}" alt="" width="36" height="36">`:''}<span id="${id}-value">${esc(choice?.name || 'No available owned NFT')}</span><span class="picker-chevron" aria-hidden="true">⌄</span></button><div class="nft-picker-options" id="${id}-options" role="listbox" aria-labelledby="${id}-label" hidden>${available.map(tokenId=>{const n=nft(tokenId);return `<button type="button" class="nft-picker-option" role="option" data-picker-id="${id}" data-picker-option="${tokenId}" aria-selected="${tokenId===selected}" tabindex="${tokenId===selected?'0':'-1'}"><img loading="lazy" decoding="async" src="${esc(n?.image)}" alt="" width="36" height="36"><span>${esc(n?.name || 'CHOG')}</span><span class="picker-check" aria-hidden="true">${tokenId===selected?'✓':''}</span></button>`;}).join('')}</div></div>`;
}
function closeNftPickers(restoreFocus=false){
  for(const toggle of document.querySelectorAll('[data-picker-toggle][aria-expanded="true"]')){
    toggle.setAttribute('aria-expanded','false');document.getElementById(toggle.getAttribute('aria-controls')).hidden=true;
    if(restoreFocus)toggle.focus();
  }
}
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.nft-picker'))closeNftPickers();});
function bindNftPickers(){
  for(const picker of document.querySelectorAll('.nft-picker')){
    const toggle=picker.querySelector('[data-picker-toggle]'),list=picker.querySelector('[role="listbox"]'),choices=[...picker.querySelectorAll('[role="option"]')];
    const open=()=>{closeNftPickers();toggle.setAttribute('aria-expanded','true');list.hidden=false;(choices.find(c=>c.getAttribute('aria-selected')==='true') || choices[0])?.focus();};
    toggle.onclick=()=>toggle.getAttribute('aria-expanded')==='true'?closeNftPickers():open();
    toggle.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open();}};
    picker.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();closeNftPickers(true);}
      else if(event.key==='Tab')closeNftPickers();
      else if(event.target.getAttribute('role')==='option' && ['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();const index=choices.indexOf(event.target),next=event.key==='Home'?0:event.key==='End'?choices.length-1:(index+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length;choices[next]?.focus();
      }
    };
    for(const choice of choices)choice.onclick=()=>{
      const tokenId=Number(choice.dataset.pickerOption),id=choice.dataset.pickerId,n=nft(tokenId);
      if(!owned.includes(tokenId) || occupied(tokenId))return;
      nftSelections.set(selectionKey(id),tokenId);document.getElementById(id).value=String(tokenId);
      toggle.querySelector('img').src=n.image;document.getElementById(id+'-value').textContent=n.name;
      for(const option of choices){const selected=option===choice;option.setAttribute('aria-selected',String(selected));option.tabIndex=selected?0:-1;option.querySelector('.picker-check').textContent=selected?'✓':'';}
      closeNftPickers(true);
    };
  }
}
function selectProfileNft(tokenId){
  if(!owned.includes(tokenId) || occupied(tokenId))return;
  nftSelections.set(selectionKey('create-nft'),tokenId);$('#create-nft').value=String(tokenId);
  for(const card of document.querySelectorAll('[data-choose-nft]')){const selected=Number(card.dataset.chooseNft)===tokenId;card.classList.toggle('is-selected',selected);card.setAttribute('aria-pressed',String(selected));}
}
function demoWallet(){return config.mode==='demo'?`<label class="role">Demo wallet<select id="demo-wallet"><option value="alice">Holder A</option><option value="bob">Holder B</option><option value="visitor">Non-holder</option></select></label>`:'';}
function bindDemoWallet(){if($('#demo-wallet')){$('#demo-wallet').value=state.persona;$('#demo-wallet').onchange=()=>run(()=>api('demo/wallet',{persona:$('#demo-wallet').value}));}}
async function createChallenge(tokenId){
  if(config.mode==='live' && !signer)await connect();
  if(config.mode==='demo')await api('challenges/create',{tokenId});else await(await contract().createChallenge(tokenId)).wait();
  toast(`Battle request created. The ${battleLength()} clock starts when another holder accepts.`);
}
async function cancelChallenge(id){if(config.mode==='demo')await api('challenges/cancel',{id});else await(await contract().cancelChallenge(id)).wait();toast('Request cancelled. The NFT is available again.');}
function requests(list){
  const available=owned.filter(id=>!occupied(id));
  return list.length?`<div class="request-grid">${list.map(c=>{const n=nft(c.tokenId),mine=sameAddress(c.creator,accountAddress());return `<article class="request-card"><img loading="lazy" decoding="async" src="${esc(n?.image || '/nfts/'+c.tokenId+'.webp')}" alt="${esc(n?.name || 'Chog')}"><div><span class="eyebrow">REQUEST #${c.id} · ${c.valid?'WAITING FOR OPPONENT':'OWNERSHIP CHANGED'}</span><h3>${esc(n?.name || 'Chog')}</h3><p>By ${esc(c.creator.slice(0,6)+'…'+c.creator.slice(-4))}</p>${mine || !c.valid?`<button data-cancel="${c.id}">${mine?'Cancel request':'Remove stale request'}</button>`:`${nftPicker(`accept-nft-${c.id}`,available)}<button data-accept="${c.id}" ${!available.length || state.serviceSuspended?'disabled':''}>Accept & start battle</button>`}</div></article>`;}).join('')}</div>`:'<div class="empty">No open requests yet. Create one from your profile.</div>';
}
function bindRequests(){
  bindNftPickers();
  for(const b of document.querySelectorAll('[data-cancel]'))b.onclick=()=>run(()=>cancelChallenge(Number(b.dataset.cancel)));
  for(const b of document.querySelectorAll('[data-accept]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.accept),tokenId=Number($('#accept-nft-'+id).value);if(config.mode==='demo')await api('challenges/accept',{id,tokenId});else await(await contract().acceptChallenge(id,tokenId)).wait();toast(`Battle started. Voting and betting are now open for ${battleWindow()}.`);});
}
function outcome(r){return r.cancelled?'Cancelled':r.winner===2?'Draw':(nft(r.winner===0?r.nftA:r.nftB)?.name || 'NFT')+' won!';}
function matches(list){return list.length?`<div class="match-list">${list.map(r=>`<a class="match-row" href="/?round=${r.id}"><div class="match-art">${[r.nftA,r.nftB].map(id=>`<img loading="lazy" decoding="async" src="${esc(nft(id)?.image || '/nfts/'+id+'.webp')}" alt="${esc(nft(id)?.name || 'Chog')}">`).join('')}</div><div><strong>${esc(nft(r.nftA)?.name || 'Chog')} vs ${esc(nft(r.nftB)?.name || 'Chog')}</strong><p>Round #${r.id} · ${r.settled?esc(outcome(r)):phase(r)==='interrupted'?'Interrupted':phase(r)==='commit'?'Voting & betting open':'Automatic opening'} · ${r.committedCount || 0} ${r.protocolVersion>=6?'sealed NFT votes & bets':'participants'}</p></div><span>View battle</span></a>`).join('')}</div>`:'<div class="empty">No active battles. Accept a request to start one.</div>';}
function rewards(){
  if(!state.claims?.length)return;
  $('#content').insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id}${c.betNonce===undefined?' · ':' · Bet #'+(c.betNonce+1)+' · '}${money(c.gross)} − ${money(c.fee)} fee = ${money(c.amount)} CHOG</span><button data-claim="${c.id}" data-bet-nonce="${c.betNonce ?? 0}">Claim reward</button></div>`).join('')}</section>`);
  for(const b of document.querySelectorAll('[data-claim]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.claim),betNonce=Number(b.dataset.betNonce);if(config.mode==='demo')await api('claim',{id,betNonce});else await(await contract().claim(id)).wait();toast('Reward claimed');});
}
function rewardPages(){
  if($('#reward-pages') || config.mode!=='live' || !address || (!claimHasMore && claimBefore===Number.MAX_SAFE_INTEGER))return;
  $('#content').insertAdjacentHTML('beforeend',`<div class="utility-row" id="reward-pages"><span>Rewards are checked in pages of 50 of your completed battles.</span>${claimHasMore?'<button id="older-rewards">Check earlier rewards</button>':''}${claimBefore!==Number.MAX_SAFE_INTEGER?'<button id="latest-rewards">Latest rewards</button>':''}</div>`);
  if($('#older-rewards'))$('#older-rewards').onclick=()=>run(async()=>{claimBefore=claimLast;});
  if($('#latest-rewards'))$('#latest-rewards').onclick=()=>run(async()=>{claimBefore=Number.MAX_SAFE_INTEGER;});
}
function renderLobby(){
  $('#content').innerHTML=`<section class="hero"><div><div class="eyebrow">HOLDER VS HOLDER</div><h1>Your Chog.<br><em>Your challenge.</em></h1><p class="intro">Create a request with your NFT. Another holder brings theirs.<br>Once accepted, the community has ${battleWindow()} to vote and place bets.</p></div><a class="button-link" href="/profile">Create a battle</a></section><div class="utility-row"><span>One NFT · one open request or active battle at a time</span>${demoWallet()}</div><section class="lobby-section"><div class="section-title"><h2>Open battle requests</h2><span>${state.challenges.length} waiting</span></div>${requests(state.challenges)}</section><section class="lobby-section"><div class="section-title"><h2>Active battles</h2><span>${state.rounds.length} ongoing</span></div>${matches(state.rounds)}</section>${state.history.length?`<section class="lobby-section"><h2>Recent contests</h2>${matches(state.history.slice(-8).reverse())}</section>`:''}`;
  if(state.serviceSuspended)$('#content').insertAdjacentHTML('afterbegin','<p class="empty">Battle starts and betting are paused. Existing claims remain available.</p>');
  bindRequests();bindDemoWallet();rewards();
}
function renderProfile(){
  const available=owned.filter(id=>!occupied(id)),selected=selectedNft('create-nft',available),mine=state.challenges.filter(c=>sameAddress(c.creator,accountAddress())),myIds=new Set(owned);
  $('#content').innerHTML=`<section class="hero"><div><div class="eyebrow">YOUR PROFILE</div><h1>Bring your <em>Chog.</em></h1><p class="intro">${accountAddress()?esc(accountAddress()):'Connect your wallet to see your Chog NFTs.'}</p></div>${demoWallet()}</section><p class="vote-note">Your Chog NFTs are found directly from the collection contract. Images load as you browse. Your NFTs stay in their wallets.</p><section class="create-panel"><h2>Create a battle request</h2><p>Choose an available NFT you own to create a request. Voting has not started yet. Only a different holder accepting this request with their NFT starts the ${battleLength()} battle.</p><div class="bet-controls"><div class="field"><label for="create-nft">YOUR AVAILABLE NFT</label><select id="create-nft" ${!available.length?'disabled':''}>${available.length?options(available,selected):'<option>No available owned NFT</option>'}</select></div><button id="create-battle" ${!available.length?'disabled':''}>Confirm & create request</button></div></section><section class="lobby-section"><h2>Your NFTs <span class="muted">(${owned.length})</span></h2>${owned.length?`<div class="owned-grid">${owned.map(id=>{const n=nft(id);return `<button type="button" class="owned-card ${id===selected?'is-selected':''}" data-choose-nft="${id}" aria-pressed="${id===selected}" aria-label="${esc(n?.name)} · ${occupied(id)?'In a request or battle':'Select for battle request'}" ${occupied(id)?'disabled':''}><img loading="lazy" decoding="async" src="${esc(n?.image)}" alt=""><strong class="owned-name">${esc(n?.name)}</strong><span class="status-pill">${occupied(id)?'In a request or battle':'Available'}</span></button>`;}).join('')}</div>`:'<div class="empty">No Chog Genesis NFTs in this wallet. Non-holders can vote by placing a bet in an active battle.</div>'}</section><section class="lobby-section"><h2>Your open requests</h2>${requests(mine)}</section><section class="lobby-section"><h2>Battles with your NFTs</h2>${matches(state.rounds.filter(r=>myIds.has(r.nftA) || myIds.has(r.nftB)))}</section>`;
  $('#create-nft').onchange=()=>selectProfileNft(Number($('#create-nft').value));for(const card of document.querySelectorAll('[data-choose-nft]'))card.onclick=()=>selectProfileNft(Number(card.dataset.chooseNft));
  $('#create-battle').onclick=()=>run(()=>createChallenge(Number($('#create-nft').value)));bindRequests();bindDemoWallet();rewards();
}
function clock(){
  const r=state?.round;if(!r)return;const p=phase(r),target=p==='commit'?r.endsAt:p==='reveal' || p==='waiting'?r.revealEndsAt:r.endsAt;
  // Close controls at the deadline even while a participant is focused in an input.
  if(location.pathname==='/' && new URLSearchParams(location.search).has('round') && p!==displayedPhase){render();return;}
  const seconds=Math.max(0,Math.ceil((target-Date.now())/1000));const t=$('#countdown');if(t)t.textContent=[Math.floor(seconds/3600),Math.floor(seconds%3600/60),seconds%60].map(n=>String(n).padStart(2,'0')).join(':');
}
function resultBanner(r){
  let kind='opening',title='Waiting for the result',description='Voting and betting are closed. Choices open automatically; the final result will appear here.',visual='<span class="result-symbol" aria-hidden="true">…</span>';
  if(r.interrupted && !r.settled){title='Round interrupted';description='This round is cancelled for emergency refunds. Finalize it to make deposits claimable without fees.';}
  if(r.settled){
    if(r.cancelled){kind='cancelled';title='Round cancelled';description='';visual='<span class="result-symbol" aria-hidden="true">↩</span>';}
    else if(r.winner===2){kind='draw';title="Draw";description=`${r.votesA}–${r.votesB} votes`;visual='<span class="result-symbol" aria-hidden="true">=</span>';}
    else{kind='winner';const winner=nft(r.winner===0?r.nftA:r.nftB),votes=r.winner===0?[r.votesA,r.votesB]:[r.votesB,r.votesA];title=esc(winner?.name || 'Chog')+' won!';description=`${votes[0]}–${votes[1]} votes`;if(winner)visual=`<img loading="lazy" decoding="async" src="${esc(winner.image)}" alt="${esc(winner.name)}" width="88" height="88">`;}
  }
  return `<section class="round-result result-${kind}" aria-labelledby="round-result-title"><div class="result-visual">${visual}</div><div><div class="eyebrow">ROUND #${r.id} · ${r.settled?'FINAL RESULT':'BETTING CLOSED'}</div><h1 id="round-result-title">${title}</h1>${description?`<p>${description}</p>`:''}<a class="result-link" href="/leaderboard">View leaderboard</a></div></section>`;
}
function card(token,side){
  if(!token)return '<div class="empty">NFT not loaded.</div>';
  const r=state.round,participant=isRoundParticipant(r,accountAddress()),canStake=!participant && owned.some(id=>!(state.usedNfts || []).includes(id));
  const closed=phase(r)!=='commit';
  const tier=token.attributes.find(a=>a.trait_type==='Tier')?.value || 'Genesis';
  return `<article class="nft-card"><div class="art-wrap"><img loading="lazy" decoding="async" src="${esc(token.image)}" alt="${esc(token.name)}"><span class="art-tag">CONTENDER ${side?'B':'A'}</span></div><div class="card-info"><div class="name-row"><div><h2>${esc(token.name)}</h2><div class="collection-label">Chog Genesis</div></div><span class="trait">${esc(tier)}</span></div><div class="stats"><div><small>VOTES</small><strong>${r.settled?(side?r.votesB:r.votesA):'Sealed'}</strong></div><div><small>SIDE POOL</small><strong>${r.settled?money(side?r.poolB:r.poolA)+' CHOG':'Sealed'}</strong></div></div>${phase(r)==='commit'?`<button class="vote-btn" data-side="${side}" ${closed || !canStake?'disabled':''}>${participant?'Participants cannot vote':'Choose NFTs & vote'}</button>`:''}</div></article>`;
}
function board(){
  const q=$('#search').value.toLowerCase(),rows=leaderboard(config.nfts,state.points,state.losses,state.draws).filter(n=>n.name.toLowerCase().includes(q) || String(n.tokenId).includes(q));
  $('#board').innerHTML=`<table><thead><tr><th>RANK</th><th>NFT</th><th>WINS</th><th>LOSSES</th><th>DRAWS</th><th></th></tr></thead><tbody>${rows.map(n=>`<tr><td class="rank">${n.rank}</td><td><div class="nft-cell"><img loading="lazy" decoding="async" src="${esc(n.image)}" alt="${esc(n.name)}" width="48" height="48" loading="lazy"><div><strong>${esc(n.name)}</strong></div></div></td><td class="score">${n.wins}</td><td class="score">${n.losses}</td><td class="score">${n.draws}</td><td><a href="https://opensea.io/item/monad/${config.collection}/${n.tokenId}" target="_blank" rel="noreferrer" aria-label="View ${esc(n.name)} on OpenSea">↗</a></td></tr>`).join('') || '<tr><td colspan="6">No results yet. NFTs appear after a win, loss or qualifying draw.</td></tr>'}</tbody></table>`;
}
function render(){
  for(const totals of [state.points,state.losses,state.draws])for(const id of Object.keys(totals || {}))if(totals[id]>0)nft(Number(id));
  const focused=document.activeElement,focusId=focused?.id;
  queueMicrotask(()=>{enhanceNftImages();if(['/', '/profile'].includes(location.pathname))rewardPages();if(focusId && document.activeElement===document.body)document.getElementById(focusId)?.focus({preventScroll:true});});
  const values={};for(const e of document.querySelectorAll('input,select'))if(e.id)values[e.id]=e.value;
  if(config.mode==='demo')$('#wallet').textContent='Demo profile';
  $('#mode').innerHTML=config.mode==='demo'?`<strong>DEMO MODE</strong> Fictional CHOG · ${config.demoFastRounds?'2-minute test rounds':'24-hour rounds'} · choices encrypted until betting closes`:'<strong>LIVE · MONAD</strong> Choices encrypted until betting closes · wallet addresses and bet amounts are public';
  $('#arena-link').classList.toggle('active',location.pathname==='/');$('#leader-link').classList.toggle('active',location.pathname==='/leaderboard');$('#profile-link').classList.toggle('active',location.pathname==='/profile');const content=$('#content');
  if(location.pathname==='/profile'){renderProfile();return;}
  if(location.pathname==='/' && !new URLSearchParams(location.search).has('round')){renderLobby();return;}
  if(location.pathname==='/leaderboard'){
    content.innerHTML=`<div class="board-top"><div><div class="eyebrow">THE COMMUNITY HAS SPOKEN</div><h1>The beauty <em>leaderboard.</em></h1><p class="intro">NFTs with a 0 - 0 record are hidden. Cancelled battles are not counted.<br>Draws count only when at least two votes were cast.</p></div><input id="search" aria-label="Search NFTs" placeholder="Search name or token ID…" value="${esc(values.search || '')}"></div><div class="board" id="board"></div>`;$('#search').oninput=board;board();return;
  }
  if(location.pathname==='/setup'){
    content.innerHTML=config.mode==='live'?`<section class="setup"><div class="eyebrow">LIVE ARENA · MONAD</div><h1>The arena is <em>ready.</em></h1><p class="intro">Use the existing arena: ${esc(config.arenaAddress)}</p><a class="button-link" href="/">Open arena</a></section>`:'<section class="setup"><h1>Demo arena</h1><a class="button-link" href="/">Open demo</a></section>';
    return;
  }
  const r=state.round,p=phase(r);displayedPhase=p;
  content.innerHTML=r && p!=='commit'?resultBanner(r):`<section class="hero"><div><div class="eyebrow">THE SEALED CHOG SHOWDOWN</div><h1>Your choice. <em>Under wraps.</em></h1><p class="intro">Pick your Chog. Your choice is encrypted in your browser.<br>After betting closes, choices open automatically.</p></div>${r && !r.settled?`<div class="timer"><small>${p==='commit'?'BETTING CLOSES IN':'AUTOMATIC OPENING'}</small><strong id="countdown">…</strong></div>`:''}</section>`;
  if(!r)content.insertAdjacentHTML('beforeend','<div class="empty">Battle not found. <a href="/">Browse battle requests</a></div>');
  else{
    content.insertAdjacentHTML('beforeend',`<div class="round-bar"><span><span class="live-dot"></span>ROUND #${r.id} · ${r.settled?'COMPLETED':p==='commit'?'SEALED BETTING':p==='interrupted'?'INTERRUPTED':p==='legacy'?'LEGACY ROUND':p==='settlement'?'FINALIZING':'AUTOMATIC OPENING'}</span><span>${r.committedCount ?? 0} sealed NFT votes & bets · ${money(r.totalCommitted)} CHOG deposited</span></div><section class="battle">${card(nft(r.nftA),0)}<div class="versus">VS</div>${card(nft(r.nftB),1)}</section>${p==='commit'?`${participationPanels(r)}`:''}<div class="utility-row"><span>${config.mode==='demo'?'Demo balance: '+money(state.account.balance)+' CHOG':address?(isRoundParticipant(r,address)?'Battle participant \u00b7 CHOG bets add no votes':ownershipError?'NFT ownership temporarily unavailable':holder?'Holder · bet optional':'Non-holder · bet required'):'Connect wallet to participate'}</span>${config.mode==='demo'?demoWallet():''}</div>`);
    if(p==='interrupted' && config.mode==='live'){content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="finalize-refunds">Finalize refunds</button></div>');$('#finalize-refunds').onclick=()=>run(async()=>{if(!signer)await connect();await(await contract().settle(r.id)).wait();toast('Refunds are available to claim');});}
    bindHolderVotes(); for(const b of document.querySelectorAll('[data-side]'))b.onclick=()=>{if($('#holder-side'))$('#holder-side').value=b.dataset.side;$('#holder-votes')?.scrollIntoView({behavior:'smooth',block:'center'});};
    if($('#stake'))$('#stake').onclick=()=>run(()=>cast(Number($('#side').value),$('#amount').value));
    if($('#max-bet'))$('#max-bet').onclick=()=>run(fillMaxBet);
    if(config.mode==='demo')bindDemoWallet();
  }
  if(config.mode==='live' && address.toLowerCase()===config.treasury.toLowerCase()){
    content.insertAdjacentHTML('beforeend','<div class="utility-row"><button id="fees">Withdraw developer fees</button></div>');$('#fees').onclick=()=>run(async()=>{await(await contract().withdrawFees()).wait();});
  }
  if(p==='commit')content.insertAdjacentHTML('beforeend','<section class="info-grid"><div><strong>01 · Encrypted locally</strong><p>Your choice is sealed for a future drand beacon. Our server does not hold the decryption key.</p></div><div><strong>02 · Automatic opening</strong><p>After betting closes, the keeper decrypts and submits matching reveals. No second wallet action from you. Unopened choices are excluded and their bets refunded after the opening deadline.</p></div><div><strong>03 · Claim your payout</strong><p>One combined payout per battle. Gross first, then one 1% fee. Draws, one-sided pools and cancelled rounds return bets in full.</p></div></section>');
  if(state.claims?.length){content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Your rewards</h3>${state.claims.map(c=>`<div class="history-item"><span>Round #${c.id}${c.betNonce===undefined?' · ':' · Bet #'+(c.betNonce+1)+' · '}${money(c.gross)} − ${money(c.fee)} fee = ${money(c.amount)} CHOG</span><button data-claim="${c.id}" data-bet-nonce="${c.betNonce ?? 0}">Claim reward</button></div>`).join('')}</section>`);for(const b of document.querySelectorAll('[data-claim]'))b.onclick=()=>run(async()=>{const id=Number(b.dataset.claim),betNonce=Number(b.dataset.betNonce);if(config.mode==='demo')await api('claim',{id,betNonce});else await(await contract().claim(id)).wait();toast('Reward claimed');});}
  if(state.history.length)content.insertAdjacentHTML('beforeend',`<section class="history"><h3>Recent contests</h3>${state.history.slice().reverse().slice(0,8).map(x=>`<div class="history-item"><span>Round #${x.id} · ${esc(nft(x.nftA)?.name || 'Chog')} vs ${esc(nft(x.nftB)?.name || 'Chog')}</span><strong>${esc(outcome(x))}</strong></div>`).join('')}</section>`);
  for(const [id,value]of Object.entries(values)){const e=document.getElementById(id);if(e && id!=='role')e.value=value;}clock();
}
function capturedWallet(account){
  const capturedSigner=signer,capturedEpoch=walletEpoch;
  return {arena:new Contract(config.arenaAddress,config.abi,capturedSigner),assertWallet:async()=>{
    const [accounts,chain]=await Promise.all([capturedSigner.provider.send('eth_accounts',[]),capturedSigner.provider.send('eth_chainId',[])]);
    if(walletEpoch!==capturedEpoch || signer!==capturedSigner || !sameAddress(accounts[0],account) || BigInt(chain)!==BigInt(config.chainId))throw Error('Wallet or network changed. Please retry.');
  }};
}
function holderSelection(){
  const key=selectionKey('holder-votes:'+state.round.id),used=new Set(state.usedNfts || []);
  const ids=(holderSelections.get(key) || []).filter(id=>owned.includes(id) && !used.has(id));
  holderSelections.set(key,ids);return {key,ids};
}
function contenderOptions(r){return [r.nftA,r.nftB].map((id,side)=>`<option value="${side}">${esc(nft(id)?.name || 'CHOG')}</option>`).join('');}
function participationPanels(r){
  const {ids}=holderSelection(),used=new Set(state.usedNfts || []),available=owned.filter(id=>!used.has(id)),participant=isRoundParticipant(r,accountAddress());
  return `<p class="vote-note">Each eligible NFT gives one vote without a CHOG bet. ${r.protocolVersion>=8?'Battle participants cannot vote; their CHOG bets carry no votes.':'Your first CHOG bet gives one additional vote.'} Choices stay encrypted until betting closes.</p>
  <section class="holder-panel" id="holder-votes"><h3>Vote with your NFTs</h3>${participant?'<p>You are a participant in this battle and cannot vote. You may still place CHOG bets below; they participate in payouts but add no votes.</p>':`<p>Select one NFT or a group, then choose a contender. You can submit other groups for either contender. Each NFT can vote once per battle, even after a transfer. Your NFTs stay in your wallet.</p>
  ${owned.length?`<div class="holder-toolbar"><span>${available.length} available · ${owned.length-available.length} already used</span><div><button type="button" id="select-all-nfts" ${!available.length?'disabled':''}>Select all available</button><button type="button" id="clear-nfts">Clear</button></div></div>
  <div class="holder-grid">${owned.map(id=>{const n=nft(id),disabled=used.has(id);return `<label class="holder-choice ${disabled?'is-used':''}"><input type="checkbox" data-holder-nft="${id}" ${ids.includes(id)?'checked':''} ${disabled?'disabled':''}><img loading="lazy" decoding="async" src="${esc(n?.image)}" alt="" width="52" height="52"><span><strong>${esc(n?.name || 'CHOG')}</strong><small>${disabled?'Already voted':'1 vote'}</small></span></label>`;}).join('')}</div>
  <div class="bet-controls"><div class="field"><label for="holder-side">CONTENDER FOR SELECTED NFTs</label><select id="holder-side">${contenderOptions(r)}</select></div><button type="button" id="submit-nft-votes" ${!ids.length?'disabled':''}>Submit ${ids.length} NFT vote${ids.length===1?'':'s'}</button></div>`:'<p class="holder-empty">Connect a wallet with a Chog Genesis NFT to vote without a CHOG bet. You can also participate by placing a bet below.</p>'}`}</section>
  <section class="bet-panel"><div><h3>Place a CHOG bet</h3><p>${participant?'You may place CHOG bets without voting.':'You can place bets alongside your NFT votes.'} Each bet must be at least 5,000 CHOG. Only CHOG bets receive payouts. Bets on the same contender are combined into one payout per battle.<br>Your combined winning bets + share of the opposing bank are calculated first; then 1% is deducted once. No fees on refunds.<br>Choices open automatically. No second action is required.</p></div>
  <div><div class="bet-controls"><div class="field"><label for="side">YOUR CONTENDER</label><select id="side">${contenderOptions(r)}</select></div><div class="field"><label for="amount">BET · CHOG · MIN. 5,000</label><div class="amount-input"><input id="amount" type="number" min="5000" step="any" value="5000" placeholder="Minimum 5,000 CHOG" inputmode="decimal" aria-describedby="paid-vote-note"><button type="button" id="max-bet" aria-label="Use maximum CHOG balance">Max</button></div></div></div>
  <p id="paid-vote-note" class="paid-vote-note">${participant?'You are a battle participant. All your CHOG bets participate in payouts but add no votes.':`Only your first CHOG bet in this battle adds 1 vote. You can place more bets on either contender; they participate in payouts but add no votes.${state.betCount?' You have already used your CHOG vote.':''}`}</p><button id="stake">Place a bet</button></div></section>`;
}
function bindHolderVotes(){
  if(!$('#holder-votes'))return;
  const update=ids=>{holderSelections.set(holderSelection().key,ids);render();};
  for(const input of document.querySelectorAll('[data-holder-nft]'))input.onchange=()=>update([...document.querySelectorAll('[data-holder-nft]:checked')].map(e=>Number(e.dataset.holderNft)));
  if($('#select-all-nfts'))$('#select-all-nfts').onclick=()=>update(owned.filter(id=>!(state.usedNfts || []).includes(id)));
  if($('#clear-nfts'))$('#clear-nfts').onclick=()=>update([]);
  if($('#submit-nft-votes'))$('#submit-nft-votes').onclick=()=>run(()=>castHolder(Number($('#holder-side').value)));
}
async function castHolder(side){
  const r=state.round,{key,ids}=holderSelection();if(phase(r)!=='commit')throw Error('Voting is closed');
  if(isRoundParticipant(r,accountAddress()))throw Error('Battle participants cannot vote');
  if(!ids.length)throw Error('Select at least one available NFT');
  if(config.mode==='live' && !signer)await connect();
  const account=accountAddress(),wallet=config.mode==='live'?capturedWallet(account):null;
  toast('Encrypting your NFT votes locally…');
  // No per-wallet NFT cap. Large collections use bounded transactions.
  for(let offset=0;offset<ids.length;offset+=MAX_HOLDER_BATCH){
    const tokenIds=normalizeHolderTokens(ids.slice(offset,offset+MAX_HOLDER_BATCH));
    if(wallet)await submitLiveHolderVotes({...wallet,account,chainId:config.chainId,roundId:r.id,side,tokenIds,notify:toast});
    else{
      const sealed=await sealBallot({arena:DEMO_ARENA,chainId:config.chainId,roundId:r.id,account,side,tokenId:side===0?r.nftA:r.nftB,amount:'0',holderKey:tokenIds[0],holderTokenIdsHash:holderTokensHash(tokenIds)},r.beaconRound);
      await api('holder-votes',{roundId:r.id,tokenIds,...sealed});
    }
    holderSelections.set(key,(holderSelections.get(key) || []).filter(id=>!tokenIds.includes(id)));
  }
  toast(ids.length+' NFT vote'+(ids.length===1?'':'s')+' encrypted. Opening is automatic.');
}
async function fillMaxBet(){
  const roundId=state.round.id;let balance;
  if(config.mode==='demo'){
    const account=accountAddress(),fresh=await api('state?round='+roundId);
    if(!sameAddress(fresh.account.address,account) || !sameAddress(accountAddress(),account))throw Error('Demo wallet changed. Please retry.');
    balance=BigInt(fresh.account.balance);state.account.balance=balance.toString();
  }else{
    if(!signer)await connect();
    const account=address,capturedSigner=signer,{assertWallet}=capturedWallet(account);
    await assertWallet();
    balance=await new Contract(config.token,['function balanceOf(address) view returns(uint256)'],capturedSigner).balanceOf(account);
    await assertWallet();
  }
  if(state.round?.id!==roundId || phase(state.round)!=='commit')throw Error('Betting is closed');
  // Fill the exact balance, independently of the rounded display elsewhere.
  $('#amount').value=formatUnits(balance,18);$('#amount').focus();
}
async function cast(side,amountText){
  const r=state.round;if(phase(r)!=='commit')throw Error('Betting is closed');const amount=parseUnits(amountText || '0',18);
  if(amount<BigInt(config.minStake))throw Error('Minimum bet is 5,000 CHOG');
  if(config.mode==='live' && !signer)await connect();
  const account=accountAddress();toast('Encrypting your bet locally…');
  if(config.mode==='live'){
    const wallet=capturedWallet(account),token=new Contract(config.token,['function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],signer);
    await submitLiveBet({...wallet,token,account,chainId:config.chainId,roundId:r.id,side,amount,notify:toast});
  }else{
    const betNonce=state.betCount || 0;
    const sealed=await sealBallot({arena:DEMO_ARENA,chainId:config.chainId,roundId:r.id,account,betNonce,side,tokenId:side===0?r.nftA:r.nftB,amount:amount.toString()},r.beaconRound);
    await api('commit',{...sealed,amount:amountText,roundId:r.id,betNonce});
  }
  toast('Bet encrypted. It will open automatically after closing.');
}

$('#wallet').onclick=()=>{
  if(!config)return;
  if(config.mode==='demo'){location.assign('/profile');return;}
  if(!address){run(connect);return;}
  setWalletMenu($('#wallet-menu').hidden);
  if(!$('#wallet-menu').hidden)$('#disconnect-wallet').focus();
};
$('#disconnect-wallet').onclick=()=>{clearWallet();$('#wallet').focus();toast('Wallet disconnected.');};
document.addEventListener('click',event=>{if(!$('.wallet-control').contains(event.target))setWalletMenu(false);});
document.addEventListener('focusin',event=>{if(!$('.wallet-control').contains(event.target))setWalletMenu(false);});
document.addEventListener('keydown',event=>{if(event.key==='Escape' && !$('#wallet-menu').hidden){setWalletMenu(false);$('#wallet').focus();}});
window.ethereum?.on?.('accountsChanged',()=>{clearWallet();run(refresh);});window.ethereum?.on?.('chainChanged',()=>{walletEpoch++;location.reload();});
try{config=await api('config');await refresh();setInterval(()=>{if(!busy && !document.querySelector('[data-picker-toggle][aria-expanded="true"]') && !['INPUT','SELECT'].includes(document.activeElement.tagName))refresh().catch(e=>toast(e.message));},10000);setInterval(clock,1000);}catch(e){$('#content').innerHTML='<div class="empty">'+esc(e.message)+'</div>';}
