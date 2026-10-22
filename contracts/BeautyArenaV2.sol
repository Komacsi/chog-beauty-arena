// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/access/Ownable2Step.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

/// @notice Stakes and addresses are public. Choices are time-encrypted until betting closes.
interface ISafeGovernance {
    function masterCopy() external view returns(address);
    function getThreshold() external view returns(uint256);
    function getOwners() external view returns(address[] memory);
    function getModulesPaginated(address start,uint256 pageSize) external view returns(address[] memory,address);
}
contract BeautyArenaV2 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable chog;
    IERC721 public immutable collection;
    address public immutable treasury;
    /// @notice Trusted automatic-opening service, replaceable only by governance.
    address public revealer;
    /// @notice Unsettled rounds up to this ID must refund after an emergency revoke.
    uint256 public interruptedThroughRound;
    // Official @safe-global/safe-smart-account 1.5.0 runtime artifacts.
    bytes32 private constant SAFE_PROXY_HASH=0x4e381985ca68b3e5d27b4425fa581c19cf33146d3f887a3cfca96f55528ea46f;
    bytes32 private constant SAFE_HASH=0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2;
    bytes32 private constant SAFE_L2_HASH=0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant MIN_STAKE = 5_000 * 10 ** 18;
    uint256 public constant DURATION = 24 hours;
    uint256 public constant UNLOCK_DELAY = 5 minutes;
    uint256 public constant REVEAL_DURATION = 1 hours;
    uint256 public constant DRAND_GENESIS = 1692803367;
    uint256 public constant DRAND_PERIOD = 3;
    uint256 public currentRoundId;
    uint256 public challengeCount;
    uint256 public treasuryCredit;
    uint256 public constant RULES_VERSION = 8;
    struct Round {
        uint256 nftA; uint256 nftB; uint256 endsAt;
        uint256 unlockAt; uint256 revealEndsAt; uint256 beaconRound;
        uint256 votesA; uint256 votesB; uint256 poolA; uint256 poolB;
        uint256 totalCommitted; uint256 committedCount; uint256 revealedCount;
        uint8 winner; bool settled; bool refund; bool cancelled;
        address participantA; address participantB;
    }
    struct Entry { bytes32 commitment; uint256 amount; uint8 side; bool committed; bool revealed; }
    struct WalletBank { uint256 total; uint256 amountA; uint256 amountB; bool claimed; }
    struct HolderEntry { address account; bytes32 commitment; bytes32 tokenIdsHash; uint256 weight; uint8 side; bool revealed; }
    struct Challenge { address creator; uint256 tokenId; uint256 createdAt; uint256 roundId; bool closed; }
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => uint256) public tokenChallenge;
    mapping(uint256 => uint256) public tokenRound;
    mapping(uint256 => Round) internal rounds;
    mapping(uint256 => mapping(address => mapping(uint256 => Entry))) public bets;
    mapping(uint256 => mapping(address => uint256)) public betCount;
    mapping(uint256 => mapping(address => WalletBank)) public walletBanks;
    mapping(uint256 => uint256) public points;
    mapping(uint256 => uint256) public losses;
    mapping(uint256 => uint256) public draws;
    mapping(uint256 => mapping(uint256 => bool)) public unstakedVoteUsed;
    mapping(uint256 => mapping(uint256 => HolderEntry)) public holderEntries;
    mapping(uint256 => mapping(address => uint256)) public holderVoteCount;
    uint256 public constant MAX_HOLDER_BATCH=50;
    bytes32 private constant HOLDER_VOTE_DOMAIN=keccak256('CHOG_HOLDER_VOTE_V1');
    bytes32 private constant BET_DOMAIN=keccak256('CHOG_PAID_BET_V1');
    event RoundStarted(uint256 indexed id, uint256 nftA, uint256 nftB, uint256 endsAt, uint256 unlockAt);
    event ChallengeCreated(uint256 indexed id, address indexed creator, uint256 tokenId);
    event ChallengeCancelled(uint256 indexed id);
    event ChallengeAccepted(uint256 indexed id, address indexed opponent, uint256 tokenId, uint256 roundId);
    event VoteCommitted(uint256 indexed id, address indexed account, uint256 indexed betNonce, bytes32 commitment, uint256 amount, bytes sealedChoice);
    event VoteRevealed(uint256 indexed id, address indexed account, uint256 indexed betNonce, uint8 side, uint256 amount);
    event HolderVotesCommitted(uint256 indexed id,address indexed account,uint256 indexed holderKey,uint256[] tokenIds,bytes32 commitment,bytes sealedChoice);
    event HolderVotesRevealed(uint256 indexed id,address indexed account,uint256 indexed holderKey,uint8 side,uint256 votes);
    event RoundSettled(uint256 indexed id, uint8 winner, bool refund, bool cancelled);
    event Claimed(uint256 indexed id, address indexed account, uint256 gross, uint256 fee, uint256 amount);
    event RevealerChanged(address indexed previous,address indexed current);
    event RevealerRevoked(address indexed previous,uint256 interruptedThroughRound);
    event RoundEmergencyCancelled(uint256 indexed id,address indexed caller);
    constructor(address token_, address collection_, address treasury_, address revealer_, address governance_) Ownable(governance_) {
        require(token_!=address(0) && collection_!=address(0) && treasury_!=address(0) && revealer_!=address(0),'Zero address');
        _requireMultisig(governance_);
        require(revealer_!=governance_ && revealer_!=treasury_,'Separate keeper wallet required');
        chog=IERC20(token_); collection=IERC721(collection_); treasury=treasury_;revealer=revealer_;
    }
    function _requireMultisig(address account) internal view {
        require(account.codehash==SAFE_PROXY_HASH,'Verified Safe proxy required');
        ISafeGovernance safe=ISafeGovernance(account);
        bytes32 implementationHash=safe.masterCopy().codehash;
        require(implementationHash==SAFE_HASH || implementationHash==SAFE_L2_HASH,'Unsupported Safe implementation');
        uint256 threshold=safe.getThreshold();
        require(threshold>=2 && threshold<=safe.getOwners().length,'At least two confirmations required');
        (address[] memory modules,)=safe.getModulesPaginated(address(1),1);
        require(modules.length==0,'Governance modules must be disabled');
    }
    modifier onlyGovernance(){_checkOwner();_requireMultisig(owner());_;}
    function transferOwnership(address next) public override onlyGovernance {_requireMultisig(next);super.transferOwnership(next);}
    function acceptOwnership() public override {_requireMultisig(msg.sender);super.acceptOwnership();}
    function renounceOwnership() public override onlyGovernance {revert('Governance cannot be renounced');}
    function setRevealer(address next) external onlyGovernance {
        require(next!=address(0) && next!=revealer,'Invalid revealer');
        require(next!=owner() && next!=treasury,'Separate keeper wallet required');
        address previous=revealer;revealer=next;emit RevealerChanged(previous,next);
    }
    function revokeRevealer() external onlyGovernance {
        address previous=revealer;require(previous!=address(0),'Revealer already revoked');
        revealer=address(0);interruptedThroughRound=currentRoundId;
        emit RevealerRevoked(previous,currentRoundId);
    }
    function roundInterrupted(uint256 id) public view returns(bool){return rounds[id].endsAt!=0 && !rounds[id].settled && id<=interruptedThroughRound;}
    function emergencyCancelRound(uint256 id) external onlyGovernance {
        Round storage r=rounds[id];require(r.endsAt!=0 && !r.settled,'Round unavailable');_cancelRound(id,r);
    }
    function _cancelRound(uint256 id,Round storage r) internal {
        r.settled=true;r.cancelled=true;r.refund=true;r.winner=2;
        delete tokenRound[r.nftA];delete tokenRound[r.nftB];
        emit RoundEmergencyCancelled(id,msg.sender);emit RoundSettled(id,2,true,true);
    }
    function tokenAvailable(uint256 tokenId) public view returns(bool) {
        return tokenChallenge[tokenId]==0 && tokenRound[tokenId]==0;
    }
    function createChallenge(uint256 tokenId) external returns(uint256 id) {
        require(collection.ownerOf(tokenId)==msg.sender,'Not NFT owner');
        require(tokenAvailable(tokenId),'NFT busy');
        id=++challengeCount;
        challenges[id]=Challenge(msg.sender,tokenId,block.timestamp,0,false);
        tokenChallenge[tokenId]=id;
        emit ChallengeCreated(id,msg.sender,tokenId);
    }
    function cancelChallenge(uint256 id) external {
        Challenge storage c=challenges[id];
        require(c.creator!=address(0) && !c.closed,'Challenge closed');
        // Anyone may clear a stale request after the creator transfers or burns its NFT.
        require(msg.sender==c.creator || !_owns(c.creator,c.tokenId),'Creator only');
        c.closed=true;delete tokenChallenge[c.tokenId];
        emit ChallengeCancelled(id);
    }
    function _owns(address account,uint256 tokenId) internal view returns(bool) {
        try collection.ownerOf(tokenId) returns(address holder){return holder==account;}catch{return false;}
    }
    function acceptChallenge(uint256 id,uint256 tokenId) external returns(uint256 roundId) {
        require(revealer!=address(0),'Automatic opening suspended');
        Challenge storage c=challenges[id];
        require(c.creator!=address(0) && !c.closed,'Challenge closed');
        require(msg.sender!=c.creator,'Different holder required');
        require(_owns(c.creator,c.tokenId),'Creator no longer owns NFT');
        require(collection.ownerOf(tokenId)==msg.sender,'Not NFT owner');
        require(tokenId!=c.tokenId && tokenAvailable(tokenId),'NFT busy');
        c.closed=true;delete tokenChallenge[c.tokenId];
        roundId=_startRound(c.tokenId,tokenId,c.creator,msg.sender);c.roundId=roundId;
        tokenRound[c.tokenId]=roundId;tokenRound[tokenId]=roundId;
        emit ChallengeAccepted(id,msg.sender,tokenId,roundId);
    }
    function _startRound(uint256 nftA,uint256 nftB,address participantA,address participantB) internal returns(uint256 id) {
        id=++currentRoundId;
        Round storage r=rounds[id];
        r.participantA=participantA; r.participantB=participantB;
        r.nftA=nftA; r.nftB=nftB; r.endsAt=block.timestamp+DURATION;
        uint256 target=r.endsAt+UNLOCK_DELAY;
        r.beaconRound=(target-DRAND_GENESIS+DRAND_PERIOD-1)/DRAND_PERIOD+1;
        r.unlockAt=DRAND_GENESIS+(r.beaconRound-1)*DRAND_PERIOD;
        r.revealEndsAt=r.unlockAt+REVEAL_DURATION;
        emit RoundStarted(currentRoundId,nftA,nftB,r.endsAt,r.unlockAt);
    }
    // The two wallets are fixed at acceptance; moving an NFT cannot clear this role.
    function isRoundParticipant(uint256 id,address account) public view returns(bool) {
        Round storage r=rounds[id];
        return account!=address(0) && (account==r.participantA || account==r.participantB);
    }
    function commitVote(uint256 id,bytes32 commitment,uint256 amount,uint256 betNonce,bytes calldata sealedChoice) external nonReentrant {
        Round storage r=rounds[id];
        require(revealer!=address(0) && id>interruptedThroughRound,'Round interrupted');
        require(r.endsAt!=0 && block.timestamp<r.endsAt && !r.settled,'Betting closed');
        require(commitment!=bytes32(0),'Empty commitment');
        require(sealedChoice.length>0 && sealedChoice.length<=4096,'Invalid ciphertext size');
        require(amount>=MIN_STAKE,'Minimum bet is 5000 CHOG');
        require(betNonce==betCount[id][msg.sender],'Bet nonce changed');
        Entry storage e=bets[id][msg.sender][betNonce];
        betCount[id][msg.sender]++;
        e.commitment=commitment; e.amount=amount; e.committed=true;
        walletBanks[id][msg.sender].total+=amount;
        r.totalCommitted+=amount; r.committedCount++;
        if(amount>0){
            uint256 beforeBalance=chog.balanceOf(address(this));
            chog.safeTransferFrom(msg.sender,address(this),amount);
            require(chog.balanceOf(address(this))-beforeBalance==amount,'Transfer-tax token unsupported');
        }
        emit VoteCommitted(id,msg.sender,betNonce,commitment,amount,sealedChoice);
    }
    function commitHolderVotes(uint256 id,uint256[] calldata tokenIds,bytes32 commitment,bytes calldata sealedChoice) external nonReentrant {
        Round storage r=rounds[id];
        require(revealer!=address(0) && id>interruptedThroughRound,'Round interrupted');
        require(r.endsAt!=0 && block.timestamp<r.endsAt && !r.settled,'Betting closed');
        require(!isRoundParticipant(id,msg.sender),'Battle participants cannot vote');
        require(tokenIds.length>0 && tokenIds.length<=MAX_HOLDER_BATCH,'Invalid NFT count');
        require(commitment!=bytes32(0),'Empty commitment');
        require(sealedChoice.length>0 && sealedChoice.length<=4096,'Invalid ciphertext size');
        for(uint256 i=0;i<tokenIds.length;i++){
            require(i==0 || tokenIds[i]>tokenIds[i-1],'NFTs must be unique and sorted');
            require(collection.ownerOf(tokenIds[i])==msg.sender,'Not NFT owner');
            require(!unstakedVoteUsed[id][tokenIds[i]],'NFT already used');
            unstakedVoteUsed[id][tokenIds[i]]=true;
        }
        uint256 holderKey=tokenIds[0];
        holderEntries[id][holderKey]=HolderEntry(msg.sender,commitment,keccak256(abi.encode(tokenIds)),tokenIds.length,0,false);
        holderVoteCount[id][msg.sender]+=tokenIds.length;r.committedCount+=tokenIds.length;
        emit HolderVotesCommitted(id,msg.sender,holderKey,tokenIds,commitment,sealedChoice);
    }
    function revealHolderVotes(uint256 id,uint256 holderKey,uint8 side,uint256 tokenId,bytes32 salt) external {
        require(msg.sender==revealer,'Automatic revealer only');
        Round storage r=rounds[id];
        require(id>interruptedThroughRound,'Round interrupted');
        require(r.endsAt!=0 && block.timestamp>=r.unlockAt && block.timestamp<r.revealEndsAt && !r.settled,'Not revealing');
        require(side<2 && tokenId==(side==0?r.nftA:r.nftB),'Invalid NFT choice');
        HolderEntry storage e=holderEntries[id][holderKey];require(e.account!=address(0) && !e.revealed,'Invalid NFT reveal');
        require(e.commitment==keccak256(abi.encode(HOLDER_VOTE_DOMAIN,address(this),block.chainid,id,e.account,side,tokenId,e.tokenIdsHash,salt)),'Commitment mismatch');
        e.revealed=true;e.side=side;r.revealedCount+=e.weight;
        if(side==0)r.votesA+=e.weight;else r.votesB+=e.weight;
        emit HolderVotesRevealed(id,e.account,holderKey,side,e.weight);
    }
    function revealVote(uint256 id,address account,uint256 betNonce,uint8 side,uint256 tokenId,bytes32 salt) external {
        require(msg.sender==revealer,'Automatic revealer only');
        Round storage r=rounds[id];
        require(id>interruptedThroughRound,'Round interrupted');
        require(r.endsAt!=0 && block.timestamp>=r.unlockAt && block.timestamp<r.revealEndsAt && !r.settled,'Not revealing');
        require(side<2 && tokenId==(side==0?r.nftA:r.nftB),'Invalid NFT choice');
        Entry storage e=bets[id][account][betNonce]; require(e.committed && !e.revealed,'Invalid reveal');
        require(e.commitment==keccak256(abi.encode(BET_DOMAIN,address(this),block.chainid,id,account,betNonce,side,tokenId,e.amount,salt)),'Commitment mismatch');
        e.revealed=true; e.side=side; r.revealedCount++;
        if(side==0)walletBanks[id][account].amountA+=e.amount;else walletBanks[id][account].amountB+=e.amount;
        // A participant may fund either bank, but none of their bets carry a vote.
        // For other wallets only the first committed bet carries a vote, even if unopened.
        bool addsVote=betNonce==0 && !isRoundParticipant(id,account);
        if(side==0){if(addsVote)r.votesA++;r.poolA+=e.amount;}else{if(addsVote)r.votesB++;r.poolB+=e.amount;}
        emit VoteRevealed(id,account,betNonce,side,e.amount);
    }
    function settle(uint256 id) external {
        Round storage r=rounds[id];
        require(r.endsAt!=0,'Round unavailable');
        require(!r.settled,'Already settled');
        // Revocation taints every unfinished round, including fully revealed ones.
        // Anyone can finalize refunds while governance or the keeper is offline.
        if(id<=interruptedThroughRound){_cancelRound(id,r);return;}
        require(block.timestamp>=r.unlockAt,'Round active');
        require(r.revealedCount==r.committedCount || block.timestamp>=r.revealEndsAt,'Reveal incomplete');
        r.settled=true;
        delete tokenRound[r.nftA];delete tokenRound[r.nftB];
        // Unopened entries are excluded and refunded individually. Only the
        // authorized service can reveal, preventing selective participant reveals.
        if(r.votesA==r.votesB){r.refund=true;r.winner=2;if(r.votesA+r.votesB>1){draws[r.nftA]++;draws[r.nftB]++;}}
        else{r.winner=r.votesA>r.votesB?0:1;points[r.winner==0?r.nftA:r.nftB]++;losses[r.winner==0?r.nftB:r.nftA]++;r.refund=r.poolA==0 || r.poolB==0;}
        emit RoundSettled(id,r.winner,r.refund,r.cancelled);
    }
    function payoutBreakdown(uint256 id,address account) public view returns(uint256 gross,uint256 fee,uint256 amount){
        Round storage r=rounds[id]; WalletBank storage bank=walletBanks[id][account];
        if(!r.settled || bank.claimed || bank.total==0)return(0,0,0);
        if(r.refund)return(bank.total,0,bank.total);
        // Unopened deposits are returned outside the valid pools, without fees.
        uint256 unopened=bank.total-bank.amountA-bank.amountB;
        uint256 winningBets=r.winner==0?bank.amountA:bank.amountB;
        uint256 winningPool=r.winner==0?r.poolA:r.poolB;
        uint256 losingPool=r.winner==0?r.poolB:r.poolA;
        uint256 winningGross=winningBets+Math.mulDiv(winningBets,losingPool,winningPool);
        fee=Math.mulDiv(winningGross,FEE_BPS,10000);gross=winningGross+unopened;amount=gross-fee;
    }
    // Individual entries remain readable; payouts use the wallet's round totals.
    function entries(uint256 id,address account) external view returns(Entry memory){return bets[id][account][0];}
    function payout(uint256 id,address account) public view returns(uint256){(,,uint256 amount)=payoutBreakdown(id,account);return amount;}
    function claim(uint256 id) external nonReentrant {
        (uint256 gross,uint256 fee,uint256 amount)=payoutBreakdown(id,msg.sender);
        require(amount>0,'Nothing to claim');walletBanks[id][msg.sender].claimed=true;treasuryCredit+=fee;
        chog.safeTransfer(msg.sender,amount);emit Claimed(id,msg.sender,gross,fee,amount);
    }
    function withdrawFees() external nonReentrant {
        require(msg.sender==treasury,'Treasury only');uint256 amount=treasuryCredit;require(amount>0,'No fees');
        treasuryCredit=0;chog.safeTransfer(treasury,amount);
    }
    function getRound(uint256 id) external view returns(Round memory){return rounds[id];}
}
