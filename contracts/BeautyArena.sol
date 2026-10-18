// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

/// @notice Stakes and addresses are public. Choices are time-encrypted until betting closes.
contract BeautyArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable chog;
    IERC721 public immutable collection;
    address public immutable treasury;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant DURATION = 24 hours;
    uint256 public constant UNLOCK_DELAY = 5 minutes;
    uint256 public constant REVEAL_DURATION = 1 hours;
    uint256 public constant DRAND_GENESIS = 1692803367;
    uint256 public constant DRAND_PERIOD = 3;
    uint256 public currentRoundId;
    uint256 public challengeCount;
    uint256 public treasuryCredit;
    struct Round {
        uint256 nftA; uint256 nftB; uint256 endsAt;
        uint256 unlockAt; uint256 revealEndsAt; uint256 beaconRound;
        uint256 votesA; uint256 votesB; uint256 poolA; uint256 poolB;
        uint256 totalCommitted; uint256 committedCount; uint256 revealedCount;
        uint8 winner; bool settled; bool refund; bool cancelled;
    }
    struct Entry { bytes32 commitment; uint256 amount; uint8 side; bool committed; bool revealed; bool claimed; }
    struct Challenge { address creator; uint256 tokenId; uint256 createdAt; uint256 roundId; bool closed; }
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => uint256) public tokenChallenge;
    mapping(uint256 => uint256) public tokenRound;
    mapping(uint256 => Round) internal rounds;
    mapping(uint256 => mapping(address => Entry)) public entries;
    mapping(uint256 => uint256) public points;
    mapping(uint256 => uint256) public losses;
    mapping(uint256 => mapping(uint256 => bool)) public unstakedVoteUsed;
    event RoundStarted(uint256 indexed id, uint256 nftA, uint256 nftB, uint256 endsAt, uint256 unlockAt);
    event ChallengeCreated(uint256 indexed id, address indexed creator, uint256 tokenId);
    event ChallengeCancelled(uint256 indexed id);
    event ChallengeAccepted(uint256 indexed id, address indexed opponent, uint256 tokenId, uint256 roundId);
    event VoteCommitted(uint256 indexed id, address indexed account, bytes32 commitment, uint256 amount, bytes sealedChoice);
    event VoteRevealed(uint256 indexed id, address indexed account, uint8 side, uint256 amount);
    event RoundSettled(uint256 indexed id, uint8 winner, bool refund, bool cancelled);
    event Claimed(uint256 indexed id, address indexed account, uint256 gross, uint256 fee, uint256 amount);
    constructor(address token_, address collection_, address treasury_) Ownable(msg.sender) {
        require(token_!=address(0) && collection_!=address(0) && treasury_!=address(0),'Zero address');
        chog=IERC20(token_); collection=IERC721(collection_); treasury=treasury_;
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
        Challenge storage c=challenges[id];
        require(c.creator!=address(0) && !c.closed,'Challenge closed');
        require(msg.sender!=c.creator,'Different holder required');
        require(_owns(c.creator,c.tokenId),'Creator no longer owns NFT');
        require(collection.ownerOf(tokenId)==msg.sender,'Not NFT owner');
        require(tokenId!=c.tokenId && tokenAvailable(tokenId),'NFT busy');
        c.closed=true;delete tokenChallenge[c.tokenId];
        roundId=_startRound(c.tokenId,tokenId);c.roundId=roundId;
        tokenRound[c.tokenId]=roundId;tokenRound[tokenId]=roundId;
        emit ChallengeAccepted(id,msg.sender,tokenId,roundId);
    }
    function _startRound(uint256 nftA,uint256 nftB) internal returns(uint256 id) {
        id=++currentRoundId;
        Round storage r=rounds[id];
        r.nftA=nftA; r.nftB=nftB; r.endsAt=block.timestamp+DURATION;
        uint256 target=r.endsAt+UNLOCK_DELAY;
        r.beaconRound=(target-DRAND_GENESIS+DRAND_PERIOD-1)/DRAND_PERIOD+1;
        r.unlockAt=DRAND_GENESIS+(r.beaconRound-1)*DRAND_PERIOD;
        r.revealEndsAt=r.unlockAt+REVEAL_DURATION;
        emit RoundStarted(currentRoundId,nftA,nftB,r.endsAt,r.unlockAt);
    }
    function commitVote(uint256 id,bytes32 commitment,uint256 amount,uint256 holderTokenId,bytes calldata sealedChoice) external nonReentrant {
        Round storage r=rounds[id];
        require(r.endsAt!=0 && block.timestamp<r.endsAt && !r.settled,'Betting closed');
        require(commitment!=bytes32(0),'Empty commitment');
        require(sealedChoice.length>0 && sealedChoice.length<=4096,'Invalid ciphertext size');
        Entry storage e=entries[id][msg.sender]; require(!e.committed,'Already participated');
        if(amount==0){
            require(collection.ownerOf(holderTokenId)==msg.sender,'NFT required');
            require(!unstakedVoteUsed[id][holderTokenId],'NFT already used');
            unstakedVoteUsed[id][holderTokenId]=true;
        }
        e.commitment=commitment; e.amount=amount; e.committed=true;
        r.totalCommitted+=amount; r.committedCount++;
        if(amount>0){
            uint256 beforeBalance=chog.balanceOf(address(this));
            chog.safeTransferFrom(msg.sender,address(this),amount);
            require(chog.balanceOf(address(this))-beforeBalance==amount,'Transfer-tax token unsupported');
        }
        emit VoteCommitted(id,msg.sender,commitment,amount,sealedChoice);
    }
    function revealVote(uint256 id,address account,uint8 side,uint256 tokenId,bytes32 salt) external {
        Round storage r=rounds[id];
        require(r.endsAt!=0 && block.timestamp>=r.unlockAt && block.timestamp<r.revealEndsAt && !r.settled,'Not revealing');
        require(side<2 && tokenId==(side==0?r.nftA:r.nftB),'Invalid NFT choice');
        Entry storage e=entries[id][account]; require(e.committed && !e.revealed,'Invalid reveal');
        require(e.commitment==keccak256(abi.encode(address(this),block.chainid,id,account,side,tokenId,e.amount,salt)),'Commitment mismatch');
        e.revealed=true; e.side=side; r.revealedCount++;
        if(side==0){r.votesA++;r.poolA+=e.amount;}else{r.votesB++;r.poolB+=e.amount;}
        emit VoteRevealed(id,account,side,e.amount);
    }
    function settle(uint256 id) external {
        Round storage r=rounds[id];
        require(r.endsAt!=0 && block.timestamp>=r.unlockAt,'Round active');
        require(!r.settled,'Already settled');
        require(r.revealedCount==r.committedCount || block.timestamp>=r.revealEndsAt,'Reveal incomplete');
        r.settled=true;
        delete tokenRound[r.nftA];delete tokenRound[r.nftB];
        if(r.revealedCount!=r.committedCount){r.cancelled=true;r.refund=true;r.winner=2;}
        else if(r.votesA==r.votesB){r.refund=true;r.winner=2;}
        else{r.winner=r.votesA>r.votesB?0:1;points[r.winner==0?r.nftA:r.nftB]++;losses[r.winner==0?r.nftB:r.nftA]++;r.refund=r.poolA==0 || r.poolB==0;}
        emit RoundSettled(id,r.winner,r.refund,r.cancelled);
    }
    function payoutBreakdown(uint256 id,address account) public view returns(uint256 gross,uint256 fee,uint256 amount){
        Round storage r=rounds[id]; Entry storage e=entries[id][account];
        if(!r.settled || !e.committed || e.claimed || e.amount==0)return(0,0,0);
        if(r.refund)return(e.amount,0,e.amount);
        if(!e.revealed || e.side!=r.winner)return(0,0,0);
        uint256 winningPool=r.winner==0?r.poolA:r.poolB;
        uint256 losingPool=r.winner==0?r.poolB:r.poolA;
        gross=e.amount+Math.mulDiv(e.amount,losingPool,winningPool);
        fee=Math.mulDiv(gross,FEE_BPS,10000);amount=gross-fee;
    }
    function payout(uint256 id,address account) public view returns(uint256){(,,uint256 amount)=payoutBreakdown(id,account);return amount;}
    function claim(uint256 id) external nonReentrant {
        (uint256 gross,uint256 fee,uint256 amount)=payoutBreakdown(id,msg.sender);
        require(amount>0,'Nothing to claim');entries[id][msg.sender].claimed=true;treasuryCredit+=fee;
        chog.safeTransfer(msg.sender,amount);emit Claimed(id,msg.sender,gross,fee,amount);
    }
    function withdrawFees() external nonReentrant {
        require(msg.sender==treasury,'Treasury only');uint256 amount=treasuryCredit;require(amount>0,'No fees');
        treasuryCredit=0;chog.safeTransfer(treasury,amount);
    }
    function getRound(uint256 id) external view returns(Round memory){return rounds[id];}
}
