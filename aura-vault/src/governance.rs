use soroban_sdk::{contracttype, Address, Env, Vec, Symbol, String};
use crate::errors::VaultError;
use crate::storage::{get_total_shares, get_balance};

// ---------------------------------------------------------------------------
// Governance constants
// ---------------------------------------------------------------------------

/// Timelock duration: 48 hours in seconds (Issue #339).
pub const TIMELOCK_DURATION: u64 = 48 * 60 * 60;

/// Quorum requirement: 10% of total shares must vote FOR (Issue #339).
/// Expressed as basis points: 1000 = 10%.
pub const QUORUM_BPS: u64 = 1_000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Soroban contracttype enums do not support named struct-like variants.
/// Use a tuple variant (with a helper struct) instead.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ParameterUpdate {
    pub name: Symbol,
    pub value: i128,
}

#[contracttype]
#[derive(Clone, Debug)]
pub enum ProposalType {
    UpdateAdmin,
    UpdateUnderlyingToken,
    UpdateParameter(ParameterUpdate),
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub enum ProposalStatus {
    Pending,
    Approved,
    Executed,
    Rejected,
    Cancelled,
}

/// A governance proposal.
///
/// `votes_for_shares` and `votes_against_shares` store the total vault-share
/// weight of votes cast, enabling share-weighted quorum checks (Issue #339).
#[contracttype]
#[derive(Clone, Debug)]
pub struct Proposal {
    pub id: u64,
    pub proposal_type: ProposalType,
    pub proposer: Address,
    pub status: ProposalStatus,
    /// Raw vote count (number of signers who voted for).
    pub votes_for: u32,
    /// Raw vote count (number of signers who voted against).
    pub votes_against: u32,
    /// Share-weighted votes FOR (sum of voter share balances at vote time).
    pub votes_for_shares: i128,
    /// Share-weighted votes AGAINST.
    pub votes_against_shares: i128,
    /// Snapshot of total_shares at proposal creation time (for quorum calc).
    pub total_shares_snapshot: i128,
    /// Voters who have voted on this proposal.
    pub signers: Vec<Address>,
    /// Ledger timestamp when this proposal was created.
    pub created_at: u64,
    /// Earliest ledger timestamp at which this proposal may be executed.
    pub execution_time: u64,
}

/// Key for recording per-signer votes; uses a tuple variant instead of named fields.
#[contracttype]
#[derive(Clone)]
pub struct ProposalVoteKey {
    pub proposal_id: u64,
    pub signer: Address,
}

#[contracttype]
pub enum GovDataKey {
    Signers,
    ProposalCount,
    Proposal(u64),
    /// Stores whether a given signer has voted on a given proposal.
    ProposalVote(ProposalVoteKey),
    Admin,
}

// ---------------------------------------------------------------------------
// Storage helpers
// ---------------------------------------------------------------------------

pub fn get_signers(env: &Env) -> Vec<Address> {
    env.storage()
        .instance()
        .get(&GovDataKey::Signers)
        .unwrap_or_else(|| Vec::new(env))
}

pub fn set_signers(env: &Env, signers: &Vec<Address>) {
    env.storage().instance().set(&GovDataKey::Signers, signers);
}

pub fn get_proposal_count(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&GovDataKey::ProposalCount)
        .unwrap_or(0)
}

pub fn set_proposal_count(env: &Env, count: u64) {
    env.storage()
        .instance()
        .set(&GovDataKey::ProposalCount, &count);
}

pub fn get_proposal(env: &Env, id: u64) -> Option<Proposal> {
    env.storage()
        .instance()
        .get(&GovDataKey::Proposal(id))
}

pub fn set_proposal(env: &Env, id: u64, proposal: &Proposal) {
    env.storage()
        .instance()
        .set(&GovDataKey::Proposal(id), proposal);
}

pub fn has_voted(env: &Env, proposal_id: u64, signer: &Address) -> bool {
    let key = GovDataKey::ProposalVote(ProposalVoteKey {
        proposal_id,
        signer: signer.clone(),
    });
    env.storage()
        .instance()
        .get::<GovDataKey, bool>(&key)
        .is_some()
}

pub fn record_vote(env: &Env, proposal_id: u64, signer: &Address) {
    let key = GovDataKey::ProposalVote(ProposalVoteKey {
        proposal_id,
        signer: signer.clone(),
    });
    env.storage().instance().set(&key, &true);
}

// ---------------------------------------------------------------------------
// Helper: check quorum
//
// Quorum is met when `votes_for_shares / total_shares_snapshot >= QUORUM_BPS / 10_000`.
// Using cross-multiplication to stay integer-only.
// ---------------------------------------------------------------------------
fn quorum_met(votes_for_shares: i128, total_shares_snapshot: i128) -> bool {
    if total_shares_snapshot == 0 {
        return false;
    }
    // votes_for_shares * 10_000 >= total_shares_snapshot * QUORUM_BPS
    let lhs = votes_for_shares.checked_mul(10_000).unwrap_or(i128::MAX);
    let rhs = total_shares_snapshot
        .checked_mul(QUORUM_BPS as i128)
        .unwrap_or(i128::MAX);
    lhs >= rhs
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

pub fn initialize_governance(env: &Env, signers: Vec<Address>) -> Result<(), VaultError> {
    let current_signers = get_signers(env);
    if current_signers.len() > 0 {
        return Err(VaultError::AlreadyInitialized);
    }

    set_signers(env, &signers);
    set_proposal_count(env, 0);
    Ok(())
}

// ---------------------------------------------------------------------------
// propose — create a new proposal (Issue #339)
//
// Any whitelisted signer may propose. The proposal captures the current
// total_shares as a snapshot for quorum computation.
//
// Emits: ProposalCreated event
// ---------------------------------------------------------------------------
pub fn create_proposal(
    env: &Env,
    proposer: Address,
    proposal_type: ProposalType,
) -> Result<u64, VaultError> {
    proposer.require_auth();

    let signers = get_signers(env);
    // `signers.iter()` yields owned `Address` values in soroban-sdk Vec
    if !signers.iter().any(|s| s == proposer) {
        return Err(VaultError::InvalidAddress);
    }

    let count = get_proposal_count(env);
    let new_id = count + 1;
    let current_time = env.ledger().timestamp();
    let total_shares_snapshot = get_total_shares(env);

    let proposal = Proposal {
        id: new_id,
        proposal_type,
        proposer: proposer.clone(),
        status: ProposalStatus::Pending,
        votes_for: 0,
        votes_against: 0,
        votes_for_shares: 0,
        votes_against_shares: 0,
        total_shares_snapshot,
        signers: Vec::new(env),
        created_at: current_time,
        execution_time: current_time + TIMELOCK_DURATION,
    };

    set_proposal(env, new_id, &proposal);
    set_proposal_count(env, new_id);

    // Event: ProposalCreated (Issue #339)
    env.events().publish(
        (Symbol::new(env, "proposal_created"), proposer, new_id),
        (current_time, current_time + TIMELOCK_DURATION, total_shares_snapshot),
    );

    Ok(new_id)
}

// ---------------------------------------------------------------------------
// vote — record a share-weighted vote (Issue #339)
//
// Voter's share balance at vote time is used as vote weight. After every
// vote, check if quorum (≥10%) AND majority (>50% of votes_for + votes_against
// shares) are both met; if so, auto-transition to Approved.
//
// Emits: Voted event
// ---------------------------------------------------------------------------
pub fn vote_on_proposal(
    env: &Env,
    voter: Address,
    proposal_id: u64,
    approve: bool,
) -> Result<(), VaultError> {
    voter.require_auth();

    let signers = get_signers(env);
    if !signers.iter().any(|s| s == voter) {
        return Err(VaultError::InvalidAddress);
    }

    let mut proposal = get_proposal(env, proposal_id)
        .ok_or(VaultError::NotInitialized)?;

    if has_voted(env, proposal_id, &voter) {
        return Err(VaultError::InvalidAddress); // Already voted
    }

    // Can only vote on pending proposals; cancelled/executed proposals cannot
    // receive new votes.
    if !matches!(proposal.status, ProposalStatus::Pending) {
        return Err(VaultError::NotApproved);
    }

    // Share-weighted vote: use the voter's current share balance.
    let voter_shares = get_balance(env, &voter);

    if approve {
        proposal.votes_for += 1;
        proposal.votes_for_shares = proposal.votes_for_shares
            .checked_add(voter_shares)
            .unwrap_or(i128::MAX);
    } else {
        proposal.votes_against += 1;
        proposal.votes_against_shares = proposal.votes_against_shares
            .checked_add(voter_shares)
            .unwrap_or(i128::MAX);
    }

    let mut signers_vec = proposal.signers.clone();
    signers_vec.push_back(voter.clone());
    proposal.signers = signers_vec;

    // Auto-approve when quorum (≥10% of total shares) AND majority (>50%) met.
    let total_voted_shares = proposal.votes_for_shares
        .checked_add(proposal.votes_against_shares)
        .unwrap_or(i128::MAX);
    let majority_met = total_voted_shares > 0
        && proposal.votes_for_shares > proposal.votes_against_shares;
    if quorum_met(proposal.votes_for_shares, proposal.total_shares_snapshot) && majority_met {
        proposal.status = ProposalStatus::Approved;
    }

    set_proposal(env, proposal_id, &proposal);
    record_vote(env, proposal_id, &voter);

    // Event: Voted (Issue #339)
    env.events().publish(
        (Symbol::new(env, "voted"), voter, proposal_id),
        (approve, voter_shares, proposal.votes_for_shares, proposal.votes_against_shares),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// execute — execute an approved proposal after its 48h timelock (Issue #339)
//
// Only a whitelisted signer may trigger execution. Cancelled proposals
// cannot be re-executed.
//
// Emits: ProposalExecuted event
// ---------------------------------------------------------------------------
pub fn execute_proposal(
    env: &Env,
    executor: Address,
    proposal_id: u64,
) -> Result<(), VaultError> {
    executor.require_auth();

    let signers = get_signers(env);
    if !signers.iter().any(|s| s == executor) {
        return Err(VaultError::InvalidAddress);
    }

    let mut proposal = get_proposal(env, proposal_id)
        .ok_or(VaultError::NotInitialized)?;

    // Cancelled proposals cannot be executed (Issue #339 requirement).
    if matches!(proposal.status, ProposalStatus::Cancelled) {
        return Err(VaultError::NotApproved);
    }

    // 48-hour timelock (Issue #339)
    let current_time = env.ledger().timestamp();
    if current_time < proposal.execution_time {
        return Err(VaultError::InvalidAddress); // Timelock not expired
    }

    if !matches!(proposal.status, ProposalStatus::Approved) {
        return Err(VaultError::InvalidAddress); // Not approved
    }

    proposal.status = ProposalStatus::Executed;
    set_proposal(env, proposal_id, &proposal);

    // Event: ProposalExecuted (Issue #339)
    env.events().publish(
        (Symbol::new(env, "proposal_executed"), executor, proposal_id),
        (current_time, proposal.votes_for_shares, proposal.votes_against_shares),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// cancel_proposal — admin or proposer may cancel a pending proposal (Issue #339)
//
// Cancelled proposals cannot be re-executed. Only Pending proposals may be
// cancelled; Approved/Executed/Rejected are terminal states.
//
// Emits: ProposalCancelled event
// ---------------------------------------------------------------------------
pub fn cancel_proposal(
    env: &Env,
    canceller: Address,
    proposal_id: u64,
) -> Result<(), VaultError> {
    canceller.require_auth();

    let mut proposal = get_proposal(env, proposal_id)
        .ok_or(VaultError::NotInitialized)?;

    // Only Pending proposals can be cancelled.
    if !matches!(proposal.status, ProposalStatus::Pending) {
        return Err(VaultError::NotApproved);
    }

    // Verify the canceller is either the proposer or a whitelisted signer.
    let signers = get_signers(env);
    let is_signer = signers.iter().any(|s| s == canceller);
    if canceller != proposal.proposer && !is_signer {
        return Err(VaultError::InvalidAddress);
    }

    proposal.status = ProposalStatus::Cancelled;
    set_proposal(env, proposal_id, &proposal);

    // Event: ProposalCancelled
    env.events().publish(
        (Symbol::new(env, "proposal_cancelled"), canceller, proposal_id),
        (env.ledger().timestamp(),),
    );

    Ok(())
}

// ---------------------------------------------------------------------------
// get_proposal_status — read-only
// ---------------------------------------------------------------------------
pub fn get_proposal_status(env: &Env, proposal_id: u64) -> Option<ProposalStatus> {
    get_proposal(env, proposal_id).map(|p| p.status)
}

// ---------------------------------------------------------------------------
// proposal_details — read-only, returns proposal info as a tuple
// ---------------------------------------------------------------------------
pub fn proposal_details(env: &Env, proposal_id: u64) -> Option<Proposal> {
    get_proposal(env, proposal_id)
}
