// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import '@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol';
import '@openzeppelin/contracts/token/ERC721/IERC721.sol';
import '@openzeppelin/contracts/access/Ownable.sol';
import '@openzeppelin/contracts/utils/ReentrancyGuard.sol';
import '@openzeppelin/contracts/utils/math/Math.sol';

/// @notice One wallet, one vote. All votes and stake totals are public onchain.
contract BeautyArena is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    IERC20 public immutable chog;
    IERC721 public immutable collection;
    address public immutable treasury;
    uint256 public constant FEE_BPS = 100;
    uint256 public constant DURATION = 24 hours;
    uint256 public currentRoundId;
    uint256 public treasuryCredit;
    struct Round {
        uint256 nftA; uint256 nftB; uint256 endsAt;
        uint256 votesA; uint256 votesB; uint256 poolA; uint256 poolB;
        uint256 distributable; uint8 winner; bool settled; bool refund;
    }
    struct Entry { uint256 amount; uint8 side; bool voted; bool claimed; }
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => Entry)) public entries;
    mapping(uint256 => uint256) public points;
    // A free vote consumes a specific NFT's eligibility for this round. This
    // prevents reusing it by transferring it through multiple wallets.
    mapping(uint256 => mapping(uint256 => bool)) public freeVoteUsed;
    event RoundStarted(uint256 indexed id, uint256 nftA, uint256 nftB, uint256 endsAt);
    event Voted(uint256 indexed id, address indexed account, uint8 side, uint256 amount);
    event RoundSettled(uint256 indexed id, uint8 winner, bool refund, uint256 fee);
    event Claimed(uint256 indexed id, address indexed account, uint256 amount);

    constructor(address token_, address collection_, address treasury_)
        Ownable(msg.sender) {
        require(token_ != address(0) && collection_ != address(0) && treasury_ != address(0), 'Zero address');
        chog = IERC20(token_); collection = IERC721(collection_); treasury = treasury_;
    }
    function startRound(uint256 nftA, uint256 nftB) external onlyOwner {
        require(currentRoundId == 0 || rounds[currentRoundId].settled, 'Settle previous round');
        require(nftA != nftB, 'Same NFT');
        collection.ownerOf(nftA); collection.ownerOf(nftB);
        Round storage r = rounds[++currentRoundId];
        r.nftA = nftA; r.nftB = nftB; r.endsAt = block.timestamp + DURATION;
        emit RoundStarted(currentRoundId,nftA,nftB,r.endsAt);
    }
    function vote(uint256 id, uint8 side, uint256 amount, uint256 holderTokenId) external nonReentrant {
        Round storage r = rounds[id];
        require(r.endsAt != 0 && block.timestamp < r.endsAt && !r.settled, 'Voting closed');
        require(side < 2, 'Invalid side');
        Entry storage e = entries[id][msg.sender];
        require(!e.voted, 'Already voted');
        if (amount == 0) {
            require(collection.ownerOf(holderTokenId) == msg.sender, 'NFT required');
            require(!freeVoteUsed[id][holderTokenId], 'NFT already used');
            freeVoteUsed[id][holderTokenId] = true;
        }
        e.voted = true; e.side = side; e.amount = amount;
        if (amount > 0) {
            uint256 beforeBalance = chog.balanceOf(address(this));
            chog.safeTransferFrom(msg.sender,address(this),amount);
            require(chog.balanceOf(address(this)) - beforeBalance == amount, 'Transfer-tax token unsupported');
        }
        if (side == 0) { r.votesA++; r.poolA += amount; }
        else { r.votesB++; r.poolB += amount; }
        emit Voted(id,msg.sender,side,amount);
    }
    function settle(uint256 id) external {
        Round storage r = rounds[id];
        require(r.endsAt != 0 && block.timestamp >= r.endsAt, 'Round active');
        require(!r.settled, 'Already settled');
        r.settled = true;
        uint256 pool = r.poolA + r.poolB;
        if (r.votesA == r.votesB) { r.refund = true; r.winner = 2; }
        else {
            r.winner = r.votesA > r.votesB ? 0 : 1;
            points[r.winner == 0 ? r.nftA : r.nftB]++;
            r.refund = r.poolA == 0 || r.poolB == 0;
        }
        // Charge only when stakers win the opposing side's tokens.
        // Ties and one-sided pools return every stake in full.
        uint256 fee = r.refund ? 0 : Math.mulDiv(pool,FEE_BPS,10000);
        treasuryCredit += fee;
        r.distributable = pool - fee;
        emit RoundSettled(id,r.winner,r.refund,fee);
    }
    function payout(uint256 id, address account) public view returns (uint256) {
        Round storage r = rounds[id]; Entry storage e = entries[id][account];
        if (!r.settled || e.claimed || e.amount == 0) return 0;
        if (r.refund) return Math.mulDiv(e.amount,r.distributable,r.poolA+r.poolB);
        if (e.side != r.winner) return 0;
        return Math.mulDiv(e.amount,r.distributable,r.winner == 0 ? r.poolA : r.poolB);
    }
    function claim(uint256 id) external nonReentrant {
        uint256 amount = payout(id,msg.sender);
        require(amount > 0, 'Nothing to claim');
        entries[id][msg.sender].claimed = true;
        chog.safeTransfer(msg.sender,amount);
        emit Claimed(id,msg.sender,amount);
    }
    function withdrawFees() external nonReentrant {
        require(msg.sender == treasury, 'Treasury only');
        uint256 amount = treasuryCredit; require(amount > 0, 'No fees');
        treasuryCredit = 0; chog.safeTransfer(treasury,amount);
    }
    function getRound(uint256 id) external view returns (Round memory) { return rounds[id]; }
}
