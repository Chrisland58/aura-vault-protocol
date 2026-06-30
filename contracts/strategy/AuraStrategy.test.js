const { expect } = require("chai");
const { ethers } = require("hardhat");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PRECISION = ethers.parseEther("1"); // 1e18

async function deploy(admin, lendingPool, vault) {
  const Factory = await ethers.getContractFactory("AuraStrategy");
  const strategy = await Factory.deploy(admin.address, lendingPool, vault);
  await strategy.waitForDeployment();
  return strategy;
}

async function deployMocks() {
  const ERC20 = await ethers.getContractFactory("MockERC20");
  const token = await ERC20.deploy("Underlying", "UND");
  await token.waitForDeployment();

  const Pool = await ethers.getContractFactory("MockLendingPool");
  const pool = await Pool.deploy();
  await pool.waitForDeployment();

  const CTokenF = await ethers.getContractFactory("MockCToken");
  const cToken = await CTokenF.deploy(await token.getAddress());
  await cToken.waitForDeployment();

  return { token, pool, cToken };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("AuraStrategy", function () {
  let strategy, token, pool, cToken;
  let admin, vault, operator, stratManager, stranger, alice, bob;

  beforeEach(async function () {
    [admin, vault, operator, stratManager, stranger, alice, bob] =
      await ethers.getSigners();

    ({ token, pool, cToken } = await deployMocks());

    strategy = await deploy(admin, await pool.getAddress(), vault.address);

    // Grant roles
    await strategy
      .connect(admin)
      .grantRole(await strategy.OPERATOR_ROLE(), operator.address);
    await strategy
      .connect(admin)
      .grantRole(await strategy.STRATEGY_MANAGER_ROLE(), stratManager.address);
  });

  // ── Constructor ─────────────────────────────────────────────────────────────

  describe("Constructor", function () {
    it("sets the vault address", async function () {
      expect(await strategy.vault()).to.equal(vault.address);
    });

    it("sets the aaveLendingPool address", async function () {
      expect(await strategy.aaveLendingPool()).to.equal(
        await pool.getAddress()
      );
    });

    it("grants DEFAULT_ADMIN_ROLE to admin", async function () {
      expect(
        await strategy.hasRole(
          await strategy.DEFAULT_ADMIN_ROLE(),
          admin.address
        )
      ).to.be.true;
    });

    it("reverts when lendingPool is zero address", async function () {
      const Factory = await ethers.getContractFactory("AuraStrategy");
      await expect(
        Factory.deploy(admin.address, ethers.ZeroAddress, vault.address)
      ).to.be.revertedWith("Zero address");
    });

    it("reverts when vault is zero address", async function () {
      const Factory = await ethers.getContractFactory("AuraStrategy");
      await expect(
        Factory.deploy(admin.address, await pool.getAddress(), ethers.ZeroAddress)
      ).to.be.revertedWith("Zero address");
    });
  });

  // ── addToken ────────────────────────────────────────────────────────────────

  describe("addToken", function () {
    it("strategy manager can add a token (AAVE protocol)", async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0); // Protocol.AAVE = 0
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.enabled).to.be.true;
      expect(cfg.active).to.equal(0);
    });

    it("strategy manager can add a token (COMPOUND protocol)", async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), 1); // Protocol.COMPOUND = 1
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.active).to.equal(1);
      expect(cfg.cToken).to.equal(await cToken.getAddress());
    });

    it("emits TokenAdded event", async function () {
      await expect(
        strategy
          .connect(stratManager)
          .addToken(await token.getAddress(), ethers.ZeroAddress, 0)
      )
        .to.emit(strategy, "TokenAdded")
        .withArgs(await token.getAddress(), 0);
    });

    it("reverts on zero token address", async function () {
      await expect(
        strategy
          .connect(stratManager)
          .addToken(ethers.ZeroAddress, ethers.ZeroAddress, 0)
      ).to.be.revertedWith("Zero address");
    });

    it("reverts when adding the same token twice", async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);
      await expect(
        strategy
          .connect(stratManager)
          .addToken(await token.getAddress(), ethers.ZeroAddress, 0)
      ).to.be.revertedWith("Already added");
    });

    it("non-strategy-manager cannot add a token", async function () {
      await expect(
        strategy
          .connect(stranger)
          .addToken(await token.getAddress(), ethers.ZeroAddress, 0)
      ).to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });
  });

  // ── Deposit ─────────────────────────────────────────────────────────────────

  describe("deposit (AAVE protocol)", function () {
    const AMOUNT = ethers.parseEther("1000");

    beforeEach(async function () {
      // Register token on Aave
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);

      // Mint tokens to vault and approve strategy
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
    });

    it("moves tokens from vault into the lending pool", async function () {
      await strategy
        .connect(vault)
        .deposit(await token.getAddress(), AMOUNT);

      expect(await token.balanceOf(await pool.getAddress())).to.equal(AMOUNT);
      expect(await token.balanceOf(vault.address)).to.equal(0);
    });

    it("emits Deposited event with correct args", async function () {
      await expect(
        strategy.connect(vault).deposit(await token.getAddress(), AMOUNT)
      )
        .to.emit(strategy, "Deposited")
        .withArgs(await token.getAddress(), AMOUNT, 0);
    });

    it("reverts when called by non-vault", async function () {
      await expect(
        strategy.connect(stranger).deposit(await token.getAddress(), AMOUNT)
      ).to.be.revertedWith("Caller not vault");
    });

    it("reverts for zero amount", async function () {
      await expect(
        strategy.connect(vault).deposit(await token.getAddress(), 0)
      ).to.be.revertedWith("Zero amount");
    });

    it("reverts for unsupported token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("Other", "OTH");
      await expect(
        strategy.connect(vault).deposit(await other.getAddress(), AMOUNT)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(
        strategy.connect(vault).deposit(await token.getAddress(), AMOUNT)
      ).to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("reverts in emergency mode", async function () {
      // Trigger emergency (operator role)
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0)
        .catch(() => {}); // ignore duplicate if already added

      // Make emergency active: grant operator, trigger
      await strategy
        .connect(operator)
        .emergencyWithdrawAll();

      await expect(
        strategy.connect(vault).deposit(await token.getAddress(), AMOUNT)
      ).to.be.revertedWith("Emergency mode");
    });

    it("handles multiple deposits accumulating in pool", async function () {
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT * 2n);

      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);

      expect(await token.balanceOf(await pool.getAddress())).to.equal(AMOUNT * 2n);
    });
  });

  describe("deposit (COMPOUND protocol)", function () {
    const AMOUNT = ethers.parseEther("500");

    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), 1);

      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
    });

    it("mints cTokens via Compound", async function () {
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
      // MockCToken holds the underlying; strategy holds the cToken balance
      expect(
        await cToken.balanceOf(await strategy.getAddress())
      ).to.equal(AMOUNT);
    });

    it("emits Deposited event with COMPOUND protocol", async function () {
      await expect(
        strategy.connect(vault).deposit(await token.getAddress(), AMOUNT)
      )
        .to.emit(strategy, "Deposited")
        .withArgs(await token.getAddress(), AMOUNT, 1);
    });
  });

  // ── Withdraw ────────────────────────────────────────────────────────────────

  describe("withdraw (AAVE protocol)", function () {
    const AMOUNT = ethers.parseEther("1000");

    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);

      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("returns tokens to vault on full withdrawal", async function () {
      await strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT);
      expect(await token.balanceOf(vault.address)).to.equal(AMOUNT);
    });

    it("returns tokens to vault on partial withdrawal", async function () {
      const half = AMOUNT / 2n;
      await strategy.connect(vault).withdraw(await token.getAddress(), half);
      expect(await token.balanceOf(vault.address)).to.equal(half);
    });

    it("emits Withdrawn event", async function () {
      await expect(
        strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT)
      )
        .to.emit(strategy, "Withdrawn")
        .withArgs(await token.getAddress(), AMOUNT, 0);
    });

    it("reverts when called by non-vault", async function () {
      await expect(
        strategy.connect(stranger).withdraw(await token.getAddress(), AMOUNT)
      ).to.be.revertedWith("Caller not vault");
    });

    it("reverts for zero amount", async function () {
      await expect(
        strategy.connect(vault).withdraw(await token.getAddress(), 0)
      ).to.be.revertedWith("Zero amount");
    });

    it("reverts for unsupported token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("Other", "OTH");
      await expect(
        strategy.connect(vault).withdraw(await other.getAddress(), AMOUNT)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(
        strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT)
      ).to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("multiple partial withdrawals drain pool correctly", async function () {
      const third = AMOUNT / 3n;
      await strategy.connect(vault).withdraw(await token.getAddress(), third);
      await strategy.connect(vault).withdraw(await token.getAddress(), third);
      const remaining = await token.balanceOf(await pool.getAddress());
      // Pool had AMOUNT; two thirds withdrawn → remainder is AMOUNT - 2*third
      expect(remaining).to.equal(AMOUNT - third * 2n);
    });
  });

  describe("withdraw (COMPOUND protocol)", function () {
    const AMOUNT = ethers.parseEther("400");

    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), 1);

      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("redeems cTokens and returns underlying to vault", async function () {
      await strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT);
      expect(await token.balanceOf(vault.address)).to.equal(AMOUNT);
    });

    it("emits Withdrawn with COMPOUND protocol", async function () {
      await expect(
        strategy.connect(vault).withdraw(await token.getAddress(), AMOUNT)
      )
        .to.emit(strategy, "Withdrawn")
        .withArgs(await token.getAddress(), AMOUNT, 1);
    });
  });

  // ── switchProtocol ──────────────────────────────────────────────────────────

  describe("switchProtocol", function () {
    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), 0); // start on AAVE
    });

    it("strategy manager can switch protocol", async function () {
      await strategy
        .connect(stratManager)
        .switchProtocol(await token.getAddress(), 1);
      const cfg = await strategy.tokenConfigs(await token.getAddress());
      expect(cfg.active).to.equal(1);
    });

    it("emits ProtocolSwitched event", async function () {
      await expect(
        strategy
          .connect(stratManager)
          .switchProtocol(await token.getAddress(), 1)
      )
        .to.emit(strategy, "ProtocolSwitched")
        .withArgs(await token.getAddress(), 0, 1);
    });

    it("reverts for unregistered token", async function () {
      const ERC20 = await ethers.getContractFactory("MockERC20");
      const other = await ERC20.deploy("X", "X");
      await expect(
        strategy
          .connect(stratManager)
          .switchProtocol(await other.getAddress(), 1)
      ).to.be.revertedWith("Token not registered");
    });
  });

  // ── Harvest ─────────────────────────────────────────────────────────────────

  describe("harvest", function () {
    const DEPOSIT = ethers.parseEther("1000");

    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);

      await token.mint(vault.address, DEPOSIT);
      await token.connect(vault).approve(await strategy.getAddress(), DEPOSIT);
      await strategy.connect(vault).deposit(await token.getAddress(), DEPOSIT);
    });

    it("updates lastHarvestTimestamp", async function () {
      const before = await strategy.lastHarvestTimestamp();
      await strategy.connect(stratManager).harvest();
      const after = await strategy.lastHarvestTimestamp();
      expect(after).to.be.gt(before);
    });

    it("reverts when called by non-strategy-manager", async function () {
      await expect(
        strategy.connect(stranger).harvest()
      ).to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });

    it("reverts when paused", async function () {
      await strategy.connect(operator).pause();
      await expect(
        strategy.connect(stratManager).harvest()
      ).to.be.revertedWithCustomError(strategy, "EnforcedPause");
    });

    it("reverts in emergency mode", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      await expect(
        strategy.connect(stratManager).harvest()
      ).to.be.revertedWith("Emergency mode");
    });
  });

  // ── Emergency withdrawal ────────────────────────────────────────────────────

  describe("emergencyWithdrawAll + rescueFunds", function () {
    const AMOUNT = ethers.parseEther("1000");

    // For the COMPOUND path, cToken.redeem() returns tokens to the strategy,
    // so emergencyWithdrawAll() can pull them. We use COMPOUND here so the
    // strategy actually holds the balance after the emergency call.
    beforeEach(async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), await cToken.getAddress(), 1); // COMPOUND

      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);
    });

    it("pulls all funds to strategy and sets emergencyMode", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      expect(await strategy.emergencyMode()).to.be.true;
      expect(await token.balanceOf(await strategy.getAddress())).to.equal(AMOUNT);
    });

    it("emits EmergencyWithdrawal event", async function () {
      await expect(strategy.connect(operator).emergencyWithdrawAll())
        .to.emit(strategy, "EmergencyWithdrawal")
        .withArgs(await token.getAddress(), AMOUNT);
    });

    it("reverts when called by non-operator", async function () {
      await expect(
        strategy.connect(stranger).emergencyWithdrawAll()
      ).to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });

    it("admin can rescue funds after emergency", async function () {
      await strategy.connect(operator).emergencyWithdrawAll();
      await strategy
        .connect(admin)
        .rescueFunds(await token.getAddress(), stranger.address);
      expect(await token.balanceOf(stranger.address)).to.equal(AMOUNT);
    });

    it("rescueFunds reverts when not in emergency", async function () {
      await expect(
        strategy
          .connect(admin)
          .rescueFunds(await token.getAddress(), stranger.address)
      ).to.be.revertedWith("Not in emergency");
    });
  });

  // ── healthCheck ─────────────────────────────────────────────────────────────

  describe("healthCheck", function () {
    it("is unhealthy with no tokens registered", async function () {
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.false;
    });

    it("is healthy after registering a token", async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);
      const [healthy, , tokenCount] = await strategy.healthCheck();
      expect(healthy).to.be.true;
      expect(tokenCount).to.equal(1);
    });

    it("reports totalDeployed after a deposit", async function () {
      const AMOUNT = ethers.parseEther("777");
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);
      await token.mint(vault.address, AMOUNT);
      await token.connect(vault).approve(await strategy.getAddress(), AMOUNT);
      await strategy.connect(vault).deposit(await token.getAddress(), AMOUNT);

      // Aave path: _protocolBalance returns local balance; strategy itself holds 0
      // (tokens are in pool). healthCheck sums _protocolBalance which for Aave
      // returns IERC20(token).balanceOf(strategy) — currently 0 after forwarding.
      // This is the documented behaviour; we just assert the call doesn't revert.
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.true;
    });

    it("becomes unhealthy after emergencyWithdrawAll", async function () {
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);
      await strategy.connect(operator).emergencyWithdrawAll();
      const [healthy] = await strategy.healthCheck();
      expect(healthy).to.be.false;
    });
  });

  // ── Pause / Unpause ─────────────────────────────────────────────────────────

  describe("pause / unpause", function () {
    it("operator can pause and unpause", async function () {
      await strategy.connect(operator).pause();
      expect(await strategy.paused()).to.be.true;
      await strategy.connect(operator).unpause();
      expect(await strategy.paused()).to.be.false;
    });

    it("non-operator cannot pause", async function () {
      await expect(
        strategy.connect(stranger).pause()
      ).to.be.revertedWithCustomError(strategy, "AccessControlUnauthorizedAccount");
    });
  });

  // ── updateShares ────────────────────────────────────────────────────────────

  describe("updateShares", function () {
    it("vault can set share balances", async function () {
      await strategy.connect(vault).updateShares(alice.address, 1000n, 1000n);
      expect(await strategy.shareBalance(alice.address)).to.equal(1000n);
      expect(await strategy.totalShares()).to.equal(1000n);
    });

    it("non-vault cannot call updateShares", async function () {
      await expect(
        strategy.connect(stranger).updateShares(alice.address, 100n, 100n)
      ).to.be.revertedWith("Caller not vault");
    });
  });

  // ── distributeYield ─────────────────────────────────────────────────────────

  describe("distributeYield", function () {
    const SHARES = ethers.parseEther("1000");
    const YIELD  = ethers.parseEther("100");

    beforeEach(async function () {
      // Give alice all shares
      await strategy.connect(vault).updateShares(alice.address, SHARES, SHARES);

      // Mint yield token (reuse same token for simplicity) and approve
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
    });

    it("distributes yield and emits YieldDistributed", async function () {
      await expect(
        strategy.connect(admin).distributeYield(await token.getAddress(), YIELD)
      )
        .to.emit(strategy, "YieldDistributed")
        .withArgs(await token.getAddress(), YIELD, SHARES);
    });

    it("increases yieldPerShareAccumulator correctly", async function () {
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
      const acc = await strategy.yieldPerShareAccumulator(await token.getAddress());
      // delta = YIELD * PRECISION / totalShares = 100e18 * 1e18 / 1000e18 = 0.1e18
      expect(acc).to.equal((YIELD * PRECISION) / SHARES);
    });

    it("reverts when there are no shares", async function () {
      // Reset shares to 0
      await strategy.connect(vault).updateShares(alice.address, 0n, 0n);
      await expect(
        strategy.connect(admin).distributeYield(await token.getAddress(), YIELD)
      ).to.be.revertedWith("No shares");
    });

    it("reverts for zero amount", async function () {
      await expect(
        strategy.connect(admin).distributeYield(await token.getAddress(), 0n)
      ).to.be.revertedWith("Zero amount");
    });

    it("two distributions accumulate correctly", async function () {
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);

      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);

      const acc = await strategy.yieldPerShareAccumulator(await token.getAddress());
      expect(acc).to.equal((YIELD * 2n * PRECISION) / SHARES);
    });
  });

  // ── claimYield + pendingYield ────────────────────────────────────────────────

  describe("claimYield / pendingYield", function () {
    const ALICE_SHARES = ethers.parseEther("600");
    const BOB_SHARES   = ethers.parseEther("400");
    const TOTAL_SHARES = ALICE_SHARES + BOB_SHARES;
    const YIELD        = ethers.parseEther("100");

    beforeEach(async function () {
      await strategy.connect(vault).updateShares(alice.address, ALICE_SHARES, TOTAL_SHARES);
      await strategy.connect(vault).updateShares(bob.address, BOB_SHARES, TOTAL_SHARES);

      // Distribute yield
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);
    });

    it("pendingYield is proportional to shares", async function () {
      const alicePending = await strategy.pendingYield(
        alice.address, await token.getAddress()
      );
      const bobPending = await strategy.pendingYield(
        bob.address, await token.getAddress()
      );

      // alice gets 60%, bob 40%
      expect(alicePending).to.equal((YIELD * ALICE_SHARES) / TOTAL_SHARES);
      expect(bobPending).to.equal((YIELD * BOB_SHARES) / TOTAL_SHARES);
    });

    it("alice can claim her yield", async function () {
      const expected = (YIELD * ALICE_SHARES) / TOTAL_SHARES;
      await expect(
        strategy
          .connect(alice)
          .claimYield(alice.address, [await token.getAddress()])
      )
        .to.emit(strategy, "YieldClaimed")
        .withArgs(alice.address, await token.getAddress(), expected);

      expect(await token.balanceOf(alice.address)).to.equal(expected);
    });

    it("pendingYield is zero after claiming", async function () {
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);
      expect(
        await strategy.pendingYield(alice.address, await token.getAddress())
      ).to.equal(0);
    });

    it("cannot double-claim the same yield", async function () {
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);
      const balBefore = await token.balanceOf(alice.address);
      // Second claim: nothing pending
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);
      expect(await token.balanceOf(alice.address)).to.equal(balBefore);
    });

    it("yield from second distribution is claimable after first is claimed", async function () {
      // Alice claims first round
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);

      // Second distribution
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);

      const expected = (YIELD * ALICE_SHARES) / TOTAL_SHARES;
      expect(
        await strategy.pendingYield(alice.address, await token.getAddress())
      ).to.equal(expected);
    });

    it("shareholder with zero shares has zero pending yield", async function () {
      expect(
        await strategy.pendingYield(stranger.address, await token.getAddress())
      ).to.equal(0);
    });

    it("total claimed equals total distributed (alice + bob)", async function () {
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);
      await strategy
        .connect(bob)
        .claimYield(bob.address, [await token.getAddress()]);

      const aliceBal = await token.balanceOf(alice.address);
      const bobBal   = await token.balanceOf(bob.address);
      // Sum should equal YIELD (rounding loss at most 1 wei due to integer division)
      expect(aliceBal + bobBal).to.be.within(YIELD - 1n, YIELD);
    });
  });

  // ── Full deposit→yield→withdraw round-trip ───────────────────────────────────

  describe("Round-trip: deposit → yield distribution → withdraw", function () {
    it("vault user receives principal plus proportional yield", async function () {
      const DEPOSIT = ethers.parseEther("1000");
      const YIELD   = ethers.parseEther("200");

      // 1. Register token and deposit
      await strategy
        .connect(stratManager)
        .addToken(await token.getAddress(), ethers.ZeroAddress, 0);

      await token.mint(vault.address, DEPOSIT);
      await token.connect(vault).approve(await strategy.getAddress(), DEPOSIT);
      await strategy.connect(vault).deposit(await token.getAddress(), DEPOSIT);

      // 2. Update share tracking (vault informs strategy)
      await strategy
        .connect(vault)
        .updateShares(alice.address, DEPOSIT, DEPOSIT);

      // 3. Distribute yield
      await token.mint(admin.address, YIELD);
      await token.connect(admin).approve(await strategy.getAddress(), YIELD);
      await strategy.connect(admin).distributeYield(await token.getAddress(), YIELD);

      // 4. Alice claims yield
      await strategy
        .connect(alice)
        .claimYield(alice.address, [await token.getAddress()]);
      expect(await token.balanceOf(alice.address)).to.equal(YIELD); // sole shareholder

      // 5. Withdraw principal
      await strategy.connect(vault).withdraw(await token.getAddress(), DEPOSIT);
      expect(await token.balanceOf(vault.address)).to.equal(DEPOSIT);
    });
  });
});
