import {BrowserProvider,formatEther,getAddress} from 'ethers';
import {DEPLOYER,validateDeploymentDraft,reviewDeploymentWallet} from '../lib/deployment-draft.mjs';
const $=id=>document.getElementById(id),connect=$('connect'),deploy=$('deploy'),consent=$('consent');
let draft,injected,provider,connected=false,version=0,requestStarted=false,busy=false;
const announced=[];window.addEventListener('eip6963:announceProvider',event=>{if(event.detail?.info?.rdns==='io.rabby')announced.push(event.detail.provider);});window.dispatchEvent(new Event('eip6963:requestProvider'));
function status(text){$('status').textContent=text;}
function reset(){version++;connected=false;consent.checked=false;consent.disabled=true;deploy.disabled=true;$('wallet').textContent='Кошелёк или сеть изменились. Выполни проверку заново.';}
function showError(error){status(error?.code===4001?'Запрос отменён в кошельке.':String(error?.shortMessage||error?.message||'Проверка не прошла.').slice(0,600));}
function row(label,value){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=label;dd.textContent=value;$('parameters').append(dt,dd);}
try{
  const response=await fetch('/deployment.json',{cache:'no-store'});if(!response.ok)throw Error('Не удалось получить подготовленную транзакцию.');draft=await response.json();validateDeploymentDraft(draft);
  row('Сеть','Monad mainnet · 143');row('Кошелёк развёртывания',DEPLOYER);row('Получатель комиссии 1%',draft.addresses.treasury);row('Управляющий Safe',draft.addresses.governance);row('Keeper',draft.addresses.revealer);row('Токен CHOG',draft.addresses.token);row('Коллекция NFT',draft.addresses.collection);row('Максимальная комиссия',formatEther(draft.maximumGasCostWei)+' MON');row('Nonce',String(BigInt(draft.request.nonce)));row('Расчётный адрес контракта',draft.predictedAddress);row('Длительность боя','24 часа');row('Минимальная ставка','5000 CHOG');$('initcode').textContent=draft.initcodeHash;
  status('Транзакция подготовлена. Подключи Rabby для проверки.');connect.disabled=false;
}catch(error){showError(error);}
connect.addEventListener('click',async()=>{
  if(requestStarted)return;connect.disabled=true;reset();
  try{
    const candidate=announced[0]||window.ethereum?.providers?.find(p=>p.isRabby)||(window.ethereum?.isRabby?window.ethereum:null);
    if(!candidate)throw Error('Rabby не найден. Открой http://127.0.0.1:3110/ в Chrome, Brave или другом браузере с Rabby.');
    if(injected!==candidate){injected=candidate;injected.on?.('accountsChanged',reset);injected.on?.('chainChanged',reset);}
    await injected.request({method:'eth_requestAccounts'});
    if(BigInt(await injected.request({method:'eth_chainId'}))!==143n)await injected.request({method:'wallet_switchEthereumChain',params:[{chainId:'0x8f'}]});
    const current=version;provider=new BrowserProvider(injected,undefined,{cacheTimeout:-1});status('Проверяю адреса, сеть, CHOG, Safe и комиссию…');
    await reviewDeploymentWallet(provider,draft);if(current!==version)throw Error('Кошелёк изменился во время проверки. Повтори подключение.');
    connected=true;consent.disabled=false;$('wallet').textContent='Подключён и проверен: '+DEPLOYER;status('Проверки прошли. Проверь параметры и подтверди своё намерение создать контракт.');
  }catch(error){showError(error);}finally{connect.disabled=requestStarted;}
});
consent.addEventListener('change',()=>{deploy.disabled=!connected||!consent.checked||requestStarted;});
deploy.addEventListener('click',async()=>{
  if(!connected||!consent.checked||requestStarted||busy)return;busy=true;
  deploy.disabled=true;connect.disabled=true;consent.disabled=true;const current=version;
  try{
    status('Повторная проверка перед запросом подписи…');const review=await reviewDeploymentWallet(provider,draft);
    if(current!==version||!connected||!consent.checked)throw Error('Кошелёк изменился. Подключись и проверь параметры снова.');
    // Exactly one request, only following this explicit human click. No retry.
    requestStarted=true;status('Проверь создание контракта и комиссию в Rabby. Решение об отправке принимаешь ты.');
    const hash=await injected.request({method:'eth_sendTransaction',params:[review.request]});
    if(!/^0x[0-9a-f]{64}$/i.test(hash))throw Error('Кошелёк не вернул корректный хеш. Проверь историю Rabby перед повтором.');
    const link=document.createElement('a');link.href='https://monadscan.com/tx/'+hash;link.target='_blank';link.rel='noopener noreferrer';link.textContent=hash;$('result').replaceChildren(link);
    status('Транзакция отправлена. Передай этот хеш для проверки развёрнутого кода и настройки keeper.');
  }catch(error){showError(error);if(requestStarted)status($('status').textContent+'\nПеред повтором проверь историю и ожидающие транзакции в Rabby: запрос мог быть принят. Страница сама ничего не повторяет.');}
  finally{busy=false;if(!requestStarted){connect.disabled=false;consent.disabled=!connected;deploy.disabled=!connected||!consent.checked;}}
});
