import { Card, GameStage, GameState, HandEvaluation, Player, Rank, Suit, HandRank } from './types';

export class PokerEngine {
  private gameState: GameState;
  private addLog(entry: string) {
    this.gameState.logs.push(entry);
  }

  /** Replace current game state with a previously saved state (deep clone). */
  public loadState(state: GameState) {
    // Defensive deep clone to avoid mutating the passed object
    this.gameState = JSON.parse(JSON.stringify(state));
  }
  constructor(
    playerNames: string[], 
    startingChips = 1000, 
    autoStart: boolean = true,
    smallBlind: number = 10,
    bigBlind: number = 20
  ) {
    this.gameState = this.initializeGame();
    // Update game state with custom blinds
    this.gameState.smallBlind = smallBlind;
    this.gameState.bigBlind = bigBlind;
    this.gameState.lastRaiseAmount = bigBlind;
    // create players
    this.gameState.players = playerNames.map((name, idx) => ({
      id: idx,
      name,
      chips: startingChips,
      holeCards: [],
      isActive: true,
      isFolded: false,
      isAllIn: false,
      currentBet: 0,
      totalBetInRound: 0,
      isAI: false
    }));
    // Start the first hand automatically (dealer=0) if requested
    if (autoStart) {
      this.startNewHand();
    }
  }
  /* ---------------- Public API ---------------- */
  /** Return the index of the player whose turn it is */
  getCurrentPlayerIndex() {
    return this.gameState.currentPlayerIndex;
  }
  /** Advance turn to the next active player (not folded and with chips) */
  advanceTurn() {
    // Keep as utility if UI wishes to manually advance, but postActionHandler handles automatic flow.
    const n = this.gameState.players.length;
    if (n === 0) return;
    let next = this.gameState.currentPlayerIndex;
    for (let i = 0; i < n; i++) {
      next = (next + 1) % n;
      const candidate = this.gameState.players[next];
      if (!candidate.isFolded && candidate.chips > 0) {
        this.gameState.currentPlayerIndex = next;
        return;
      }
    }
    // no eligible player found – leave index unchanged
  }
  /* ---------------- Internal Flow Helpers ---------------- */
  /** Check if the betting round is complete (all active, non-all-in players have matched currentBet) */
  private isBettingRoundComplete(originIdx?: number): boolean {
    const contenders = this.gameState.players.filter(p => !p.isFolded && !p.isAllIn && p.chips > 0);
    if (contenders.length === 0) return true;
    const allMatched = contenders.every(p => p.currentBet === this.gameState.currentBet);
    if (!allMatched) return false;
    if (this.gameState.stage === GameStage.PreFlop) {
      // Pre-flop: betting ends if big blind just acted and all bets are matched
      return originIdx !== undefined && originIdx === this.gameState.lastToActIndex;
    }
    // Post-flop logic differs depending on whether any bet has been placed in this round.
    // 1) If there IS a bet (currentBet > 0), the round ends once action *returns* to the last raiser.
    // 2) If there is NO bet (currentBet === 0), every active player must check. In that case the
    //    round ends only when the *dealer/lastToAct* player has actually taken his action.
    if (this.gameState.currentBet === 0) {
      // No wagers yet – require lastToAct to have just acted (originIdx === lastToActIndex)
      return originIdx !== undefined && originIdx === this.gameState.lastToActIndex;
    }
    // There was at least one bet/raise – round ends when action returns to the last raiser
    return originIdx !== undefined && originIdx === this.gameState.lastToActIndex;
  }
  /** Set currentPlayerIndex to the first eligible player after startIdx */
  private advanceFrom(startIdx: number) {
    const n = this.gameState.players.length;
    for (let offset = 1; offset <= n; offset++) {
      const idx = (startIdx + offset) % n;
      const cand = this.gameState.players[idx];
      if (!cand.isFolded && cand.chips > 0) {
        this.gameState.currentPlayerIndex = idx;
        return;
      }
    }
  }
  /** Handle automatic flow after each betting action */
  private postActionHandler(originIdx: number) {
    // Count this action
    this.gameState.bettingActions++;
    // If only one player remains (others folded), go to showdown
    const remaining = this.gameState.players.filter(p => !p.isFolded);
    if (remaining.length === 1) {
      this.gameState.stage = GameStage.Showdown;
      return;
    }
    // Move turn to the next eligible player
    this.advanceFrom(originIdx);
    // If all active bets are matched and action has returned to the player after last raiser, finish the round
    if (this.isBettingRoundComplete(originIdx)) {
      this.nextStage();
      const stageAfter = this.gameState.stage as GameStage;
      if (stageAfter !== GameStage.Showdown) {
        // If no player can act because all remaining players are all-in, automatically run out the board to showdown.
        const canAct = this.gameState.players.some(p => !p.isFolded && !p.isAllIn && p.chips > 0);
        if (!canAct) {
          while (this.gameState.stage !== GameStage.Showdown) {
            this.nextStage();
          }
        } else {
          // Otherwise, first action of new stage: player to left of dealer
          this.advanceFrom(this.gameState.dealerPosition);
        }
      }
    }
  }
  /* ---------------- Public API ---------------- */
  /** Bet/Raise chips for a player. Enforces NLHE min-bet/min-raise rules */
  bet(playerId: number, amount: number, skipPost = false) {
    const player = this.gameState.players[playerId];
    if (player.isFolded || player.isAllIn || this.gameState.stage === GameStage.Showdown || player.chips <= 0 || amount <= 0) return;
    const prevBet = this.gameState.currentBet;
    const minRaise = prevBet === 0 ? this.gameState.bigBlind : this.gameState.lastRaiseAmount;
    // enforce minimum bet/raise (except when player goes all-in for less – then it's treated as call)
    if (amount < minRaise && amount < player.chips) {
      // treat as call
      return this.call(playerId);
    }
    const wager = Math.min(amount, player.chips);
    player.chips -= wager;
    player.currentBet += wager;
    player.totalBetInRound += wager;
    this.gameState.pot += wager;
    if (player.chips === 0) {
      player.isAllIn = true;
    }
    // update current highest bet in the round
    if (player.currentBet > prevBet) {
      const raiseDelta = player.currentBet - prevBet;
      // update min raise for next players
      this.gameState.lastRaiseAmount = raiseDelta;
      this.gameState.currentBet = player.currentBet;
      // a new highest bet (raise) means this player becomes last to act
      this.gameState.lastToActIndex = playerId;
    }
    if (!skipPost) {
      // log action
      const actionMsg = player.currentBet > prevBet ? prevBet === 0 ? `bets ${player.currentBet}` : `raises to ${player.currentBet}` : `calls ${wager}`;
      this.addLog(`${player.name} ${actionMsg}`);
      this.postActionHandler(playerId);
    }
  }
  /** Player checks (no wager) */
  check(playerId: number) {
    const player = this.gameState.players[playerId];
    if (player.isFolded || player.isAllIn || this.gameState.stage === GameStage.Showdown || player.chips <= 0) return;
    if (player.currentBet !== this.gameState.currentBet) return; // cannot check when facing a bet
    this.addLog(`${player.name} checks`);
    this.postActionHandler(playerId);
  }
  /** Player calls to match the current bet */
  call(playerId: number) {
    const player = this.gameState.players[playerId];
    if (player.isFolded || player.isAllIn || this.gameState.stage === GameStage.Showdown || player.chips <= 0) return;
    const toCall = this.gameState.currentBet - player.currentBet;
    if (toCall <= 0) {
      // nothing to call, treat as check
      return this.check(playerId);
    }
    const wager = Math.min(toCall, player.chips);
    player.chips -= wager;
    player.currentBet += wager;
    player.totalBetInRound += wager;
    this.gameState.pot += wager;
    if (player.chips === 0) player.isAllIn = true;
    this.addLog(`${player.name} calls ${wager}`);
    this.postActionHandler(playerId);
  }
  /** Player folds */
  fold(playerId: number) {
    const player = this.gameState.players[playerId];
    if (player.isFolded || player.isAllIn || this.gameState.stage === GameStage.Showdown) return;
    player.isFolded = true;
    this.addLog(`${player.name} folds`);
    this.postActionHandler(playerId);
  }
  /** All-in helper */
  allIn(playerId: number) {
    const player = this.gameState.players[playerId];
    if (player.isFolded || player.isAllIn || this.gameState.stage === GameStage.Showdown || player.chips <= 0) return;
    this.addLog(`${this.gameState.players[playerId].name} goes all-in (${this.gameState.players[playerId].chips})`);
    this.bet(playerId, player.chips);
    player.isAllIn = true;
  }
  getState(): GameState {
    // return a deep-ish clone to keep state immutable for React
    return JSON.parse(JSON.stringify(this.gameState));
  }
  /**
   * Transition to the next stage and reset per-round bets.
   */
  nextStage(): void {
    switch (this.gameState.stage) {
      case GameStage.PreFlop:
        this.gameState.stage = GameStage.Flop;
        this.addLog('--- Flop ---');
        this.burn();
        this.gameState.communityCards.push(...this.drawMany(3));
        this.resetRoundBets();
        break;
      case GameStage.Flop:
        this.gameState.stage = GameStage.Turn;
        this.addLog('--- Turn ---');
        this.burn();
        this.gameState.communityCards.push(...this.drawMany(1));
        this.resetRoundBets();
        break;
      case GameStage.Turn:
        this.gameState.stage = GameStage.River;
        this.addLog('--- River ---');
        this.burn();
        this.gameState.communityCards.push(...this.drawMany(1));
        this.resetRoundBets();
        break;
      case GameStage.River:
        this.gameState.stage = GameStage.Showdown;
        break;
      default:
        break;
    }
  }
  /** Reset all players' currentBet and game currentBet for new betting round */
  private resetRoundBets() {
    this.gameState.players.forEach(p => {
      p.currentBet = 0;
    });
    this.gameState.currentBet = 0;
    // Determine who acts last in the new betting round (dealer or the closest active player counter-clockwise).
    const n = this.gameState.players.length;
    for (let offset = 0; offset < n; offset++) {
      const idx = (this.gameState.dealerPosition - offset + n) % n;
      if (!this.gameState.players[idx].isFolded) {
        this.gameState.lastToActIndex = idx;
        break;
      }
    }
    // reset minimum raise to big blind size for new round
    this.gameState.lastRaiseAmount = this.gameState.bigBlind;
  }
  /**
   * Evaluate hands of active players and return winners (may be multiple).
   */
  evaluateWinners(): {
    winners: Player[];
    evaluations: Map<number, HandEvaluation>;
  } {
    const active = this.gameState.players.filter(p => !p.isFolded && p.isActive);
    // If only one active player remains (others folded), they are the winner without hand evaluation
    if (active.length === 1) {
      return {
        winners: [active[0]],
        evaluations: new Map<number, HandEvaluation>()
      };
    }
    const evaluations = new Map<number, HandEvaluation>();
    active.forEach(p => {
      const hand = [...p.holeCards, ...this.gameState.communityCards];
      // Only attempt to evaluate if there are at least 5 cards available (2 hole + 3 community)
      if (hand.length >= 5) {
        try {
          evaluations.set(p.id, this.evaluateHand(hand));
        } catch {
          // ignore evaluation errors; they'll be missing from the map
        }
      }
    });
    // If no evaluations could be made (e.g., showdown before flop), declare all active players winners (split)
    if (evaluations.size === 0) {
      return {
        winners: active,
        evaluations
      };
    }
    // Determine highest rank among all evaluations
    const maxRank = Math.max(...Array.from(evaluations.values()).map(ev => ev.rank));
    const topRankEvals = [...evaluations.entries()].filter(([, ev]) => ev.rank === maxRank);
    // Among those, find best value within the same rank
    const bestValue = Math.max(...topRankEvals.map(([, ev]) => ev.value));
    const winners = topRankEvals.filter(([, ev]) => ev.value === bestValue).map(([id]) => this.gameState.players[id]);
    return {
      winners,
      evaluations
    };
  }
  /**
   * Distribute the pot among winners and reset bets for new hand
   */
  settlePot() {
    // If only one player remains active (others folded), award entire pot directly
    const remaining = this.gameState.players.filter(p => !p.isFolded && p.isActive);
    if (remaining.length === 1) {
      remaining[0].chips += this.gameState.pot;
      // Do not auto-start next hand here; UI controls starting next hand after on-chain shuffle
      return;
    }

    // If side pots are needed, calculate them first
    this.calculateSidePots();
    if (this.gameState.sidePots.length === 0) {
      // Simple case – no side pots
      const {
        winners
      } = this.evaluateWinners();
      if (winners.length === 0) return;
      const share = Math.floor(this.gameState.pot / winners.length);
      winners.forEach(w => w.chips += share);
    } else {
      // Distribute each side pot separately
      const evaluationsCache = new Map<number, HandEvaluation>();
      const active = this.gameState.players.filter(p => !p.isFolded && p.isActive);
      active.forEach(p => {
        const cards = [...p.holeCards, ...this.gameState.communityCards];
        if (cards.length >= 5) {
          try {
            evaluationsCache.set(p.id, this.evaluateHand(cards));
          } catch {
            // ignore; will fall back to equal split for that side pot
          }
        }
      });
      this.gameState.sidePots.forEach(sidePot => {
        const eligiblePlayers = sidePot.eligiblePlayers.map(pid => this.gameState.players[pid]);
        const eligibleEvaluations = eligiblePlayers
          .map(p => ({ player: p, evaluation: evaluationsCache.get(p.id) }))
          .filter((e): e is { player: Player; evaluation: HandEvaluation } => !!e.evaluation);

        if (eligibleEvaluations.length === 0) {
          // Not enough cards to evaluate – split this side pot evenly among eligible players
          const share = Math.floor(sidePot.amount / eligiblePlayers.length);
          eligiblePlayers.forEach(p => p.chips += share);
          return;
        }

        // Determine winners by rank first, then value
        const maxRank = Math.max(...eligibleEvaluations.map(e => e.evaluation.rank));
        const topRankEvals = eligibleEvaluations.filter(e => e.evaluation.rank === maxRank);
        const bestVal = Math.max(...topRankEvals.map(e => e.evaluation.value));
        const winners = topRankEvals.filter(e => e.evaluation.value === bestVal);
        const share = Math.floor(sidePot.amount / winners.length);
        winners.forEach(w => w.player.chips += share);
      });
    }
    // Do not auto-start next hand here; UI will start a new hand after obtaining the shuffled deck
  }
  /**
   * Compute side pots based on totalBetInRound / all-in amounts
   */
  private calculateSidePots() {
    const activePlayers = this.gameState.players.filter(p => !p.isFolded && p.totalBetInRound > 0);
    const allInAmounts = activePlayers.filter(p => p.isAllIn).map(p => p.totalBetInRound).sort((a, b) => a - b);
    this.gameState.sidePots = [];
    let previous = 0;
    for (const amount of allInAmounts) {
      const potAmount = activePlayers.reduce((sum, player) => {
        return sum + Math.max(0, Math.min(player.totalBetInRound, amount) - previous);
      }, 0);
      if (potAmount > 0) {
        const eligible = activePlayers.filter(p => p.totalBetInRound >= amount).map(p => p.id);
        this.gameState.sidePots.push({
          amount: potAmount,
          eligiblePlayers: eligible
        });
      }
      previous = amount;
    }
    // main pot from remaining chips beyond the last all-in level
    const mainAmount = activePlayers.reduce((sum, player) => sum + Math.max(0, player.totalBetInRound - previous), 0);
    if (mainAmount > 0) {
      this.gameState.sidePots.push({
        amount: mainAmount,
        eligiblePlayers: activePlayers.map(p => p.id)
      });
    }
  }
  /* ---------------- External deck integration ---------------- */
  /**
   * Accept a packed 52-byte deck as emitted by the PokerEntropyDealer contract and start a new hand using
   * that exact order. This must be called **before** any cards are dealt for the new hand.
   *
   * Encoding assumption: Each byte is a uint8 between 0-51 inclusive representing the index within a
   * standard ordered deck where indices increase first by rank then by suit, i.e. index = (rankIndex * 4) + suitIndex.
   *
   * rankIndex: 0 = Two, …, 12 = Ace
   * suitIndex: 0 = Hearts, 1 = Diamonds, 2 = Clubs, 3 = Spades.
   */
  public startNewHandWithPackedDeck(packedDeck: Uint8Array | number[] | string) {
    // Convert hex string (0x… or …) to Uint8Array if necessary
    let bytes: Uint8Array;
    if (typeof packedDeck === 'string') {
      const hex = packedDeck.startsWith('0x') ? packedDeck.slice(2) : packedDeck;
      const arr: number[] = [];
      for (let i = 0; i < hex.length; i += 2) {
        arr.push(parseInt(hex.substr(i, 2), 16));
      }
      bytes = Uint8Array.from(arr);
    } else if (Array.isArray(packedDeck)) {
      bytes = Uint8Array.from(packedDeck);
    } else {
      bytes = packedDeck;
    }
    if (bytes.length < 52) throw new Error('Packed deck must contain 52 bytes');

    // Decode bytes → Card[] using mapping described above
    const deck: Card[] = [];
    const suitValues: Suit[] = [Suit.Hearts, Suit.Diamonds, Suit.Clubs, Suit.Spades];
    bytes.slice(0, 52).forEach((val) => {
      const suitIdx = val % 4;
      const rankIdx = Math.floor(val / 4); // 0-12
      const rankVal = rankIdx + 2; // Rank enum 2-14
      deck.push({ rank: rankVal as Rank, suit: suitValues[suitIdx] });
    });

    // Begin new hand using the decoded deck
    this.startNewHandInternal(deck);
  }

  /* ---------------- Internal helpers ---------------- */
  /**
   * Start a new hand after the previous pot has been settled.
   */
  /** Shared new-hand initialization. If `externalDeck` is provided it will be used, otherwise a fresh shuffled deck is created. */
  private startNewHandInternal(externalDeck?: Card[]) {
    const players = this.gameState.players;
    const activeCount = players.filter(p => p.chips > 0 && p.isActive).length;
    if (activeCount < 2) {
      this.gameState.stage = GameStage.Showdown;
      return;
    }
    // Helper to get next active player index
    const nextIdx = (from: number): number => {
      const n = players.length;
      for (let off = 1; off <= n; off++) {
        const idx = (from + off) % n;
        if (players[idx].chips > 0 && players[idx].isActive) return idx;
      }
      return from; // fallback
    };
    // Rotate dealer to next active player
    this.gameState.dealerPosition = nextIdx(this.gameState.dealerPosition === undefined ? -1 : this.gameState.dealerPosition);
    // Assign blinds (heads-up or multi-hand)
    if (activeCount === 2) {
      this.gameState.smallBlindPosition = this.gameState.dealerPosition;
      this.gameState.bigBlindPosition = nextIdx(this.gameState.dealerPosition);
    } else {
      this.gameState.smallBlindPosition = nextIdx(this.gameState.dealerPosition);
      this.gameState.bigBlindPosition = nextIdx(this.gameState.smallBlindPosition);
    }
    this.addLog('--- New Hand ---');
    // Reset state
    this.gameState.pot = 0;
    this.gameState.sidePots = [];
    this.gameState.currentBet = 0;
    this.gameState.stage = GameStage.PreFlop;
    this.gameState.communityCards = [];
    this.gameState.bettingActions = 0;
    players.forEach(p => {
      p.holeCards = [];
      p.isFolded = false;
      p.isAllIn = false;
      p.currentBet = 0;
      p.totalBetInRound = 0;
    });
    // Deck
    this.gameState.deck = externalDeck ? [...externalDeck] : this.createDeck();
    // Deal
    this.dealHoleCards();
    // --- Manually post blinds (do NOT trigger betting flow) ---
    const postBlind = (idx: number, amount: number) => {
      const p = players[idx];
      const stake = Math.min(amount, p.chips);
      p.chips -= stake;
      p.currentBet += stake;
      p.totalBetInRound += stake;
      this.gameState.pot += stake;
      if (p.chips === 0) p.isAllIn = true;
    };
    postBlind(this.gameState.smallBlindPosition, this.gameState.smallBlind);
    postBlind(this.gameState.bigBlindPosition, this.gameState.bigBlind);
    // First action params
    this.gameState.currentBet = players[this.gameState.bigBlindPosition].currentBet;
    this.gameState.currentPlayerIndex = nextIdx(this.gameState.bigBlindPosition);
    this.gameState.lastToActIndex = this.gameState.bigBlindPosition;
    this.gameState.lastRaiseAmount = this.gameState.bigBlind;
  }

  // Original startNewHand now delegates to internal helper
  private startNewHand() {
    this.startNewHandInternal();
  }

  // -------- Existing helper methods below --------
  private initializeGame(): GameState {
    return {
      players: [],
      deck: [],
      communityCards: [],
      pot: 0,
      currentBet: 0,
      stage: GameStage.PreFlop,
      dealerPosition: 0,
      smallBlindPosition: 0,
      bigBlindPosition: 0,
      currentPlayerIndex: 0,
      lastToActIndex: 0,
      lastRaiseAmount: 20,
      smallBlind: 10,
      bigBlind: 20,
      sidePots: [],
      bettingActions: 0,
      logs: []
    };
  }
  private createDeck(): Card[] {
    const deck: Card[] = [];
    for (const suit of Object.values(Suit)) {
      for (let rank = 2; rank <= 14; rank++) {
        deck.push({
          rank: rank as Rank,
          suit
        });
      }
    }
    return this.shuffleDeck(deck);
  }
  private shuffleDeck(deck: Card[]): Card[] {
    const shuffled = [...deck];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }
  private drawMany(n: number): Card[] {
    return this.gameState.deck.splice(0, n);
  }
  private burn() {
    this.gameState.deck.shift();
  }
  private dealHoleCards(): void {
    for (let i = 0; i < 2; i++) {
      this.gameState.players.forEach(p => p.holeCards.push(...this.drawMany(1)));
    }
  }
  cardToString(card: Card): string {
    return `${this.getRankName(card.rank)}${card.suit}`;
  }
  private getRankName(rank: Rank): string {
    switch (rank) {
      case Rank.Jack:
        return 'J';
      case Rank.Queen:
        return 'Q';
      case Rank.King:
        return 'K';
      case Rank.Ace:
        return 'A';
      default:
        return rank.toString();
    }
  }
  /* ---------------- Full Hand Evaluation ---------------- */
  private evaluateHand(cards: Card[]): HandEvaluation {
    if (cards.length < 5) {
      throw new Error('Need at least 5 cards to evaluate hand');
    }
    const sortedCards = [...cards].sort((a, b) => b.rank - a.rank);
    const ranks = sortedCards.map(c => c.rank);
    // Count rank occurrences
    const rankCounts = new Map<Rank, number>();
    ranks.forEach(rank => {
      rankCounts.set(rank, (rankCounts.get(rank) || 0) + 1);
    });
    const counts = Array.from(rankCounts.values()).sort((a, b) => b - a);
    const countRanks = Array.from(rankCounts.entries()).sort((a, b) => b[1] - a[1] || b[0] - a[0]).map(([rank]) => rank);
    // Check for flush
    const suitCounts = new Map<Suit, Card[]>();
    sortedCards.forEach(card => {
      if (!suitCounts.has(card.suit)) {
        suitCounts.set(card.suit, []);
      }
      suitCounts.get(card.suit)!.push(card);
    });
    const flushSuit = Array.from(suitCounts.entries()).find(([, cards]) => cards.length >= 5);
    const isFlush = !!flushSuit;
    const flushCards = flushSuit ? flushSuit[1].slice(0, 5) : [];
    // Check for straight
    const straightResult = this.checkStraight(sortedCards);
    const isStraight = straightResult.isStraight;
    const straightCards = straightResult.cards;
    // Royal Flush
    if (isFlush && isStraight && straightCards[0].rank === Rank.Ace) {
      return {
        rank: HandRank.RoyalFlush,
        value: 10_000000,
        description: 'Royal Flush',
        cards: straightCards
      };
    }
    // Straight Flush
    if (isFlush && isStraight) {
      return {
        rank: HandRank.StraightFlush,
        value: 9_000000 + straightCards[0].rank,
        description: 'Straight Flush',
        cards: straightCards
      };
    }
    // Four of a Kind
    if (counts[0] === 4) {
      const fourKind = countRanks[0];
      const kicker = countRanks[1];
      return {
        rank: HandRank.FourOfAKind,
        value: 8_000000 + fourKind * 100 + kicker,
        description: 'Four of a Kind',
        cards: sortedCards.filter(c => c.rank === fourKind || c.rank === kicker).slice(0, 5)
      };
    }
    // Full House
    if (counts[0] === 3 && counts[1] === 2) {
      const threeKind = countRanks[0];
      const pair = countRanks[1];
      return {
        rank: HandRank.FullHouse,
        value: 7_000000 + threeKind * 100 + pair,
        description: 'Full House',
        cards: sortedCards.filter(c => c.rank === threeKind || c.rank === pair)
      };
    }
    // Flush
    if (isFlush) {
      const value = 6_000000 + flushCards.reduce((sum, card, idx) => sum + card.rank * Math.pow(100, 4 - idx), 0);
      return {
        rank: HandRank.Flush,
        value,
        description: 'Flush',
        cards: flushCards
      };
    }
    // Straight
    if (isStraight) {
      return {
        rank: HandRank.Straight,
        value: 5_000000 + straightCards[0].rank,
        description: 'Straight',
        cards: straightCards
      };
    }
    // Three of a Kind
    if (counts[0] === 3) {
      const threeKind = countRanks[0];
      const kickers = countRanks.slice(1, 3);
      return {
        rank: HandRank.ThreeOfAKind,
        value: 4_000000 + threeKind * 10000 + kickers[0] * 100 + kickers[1],
        description: 'Three of a Kind',
        cards: sortedCards.filter(c => c.rank === threeKind || kickers.includes(c.rank)).slice(0, 5)
      };
    }
    // Two Pair
    if (counts[0] === 2 && counts[1] === 2) {
      const highPair = countRanks[0];
      const lowPair = countRanks[1];
      const kicker = countRanks[2];
      return {
        rank: HandRank.TwoPair,
        value: 3_000000 + highPair * 10000 + lowPair * 100 + kicker,
        description: 'Two Pair',
        cards: sortedCards.filter(c => c.rank === highPair || c.rank === lowPair || c.rank === kicker).slice(0, 5)
      };
    }
    // One Pair
    if (counts[0] === 2) {
      const pairRank = countRanks[0];
      const kickers = countRanks.slice(1, 4);
      return {
        rank: HandRank.OnePair,
        value: 2_000000 + pairRank * 10000 + kickers[0] * 100 + kickers[1] * 10 + kickers[2],
        description: 'One Pair',
        cards: sortedCards.filter(c => c.rank === pairRank || kickers.includes(c.rank)).slice(0, 5)
      };
    }
    // High Card
    const highCards = sortedCards.slice(0, 5);
    const value = 1_000000 + highCards.reduce((sum, card, idx) => sum + card.rank * Math.pow(100, 4 - idx), 0);
    return {
      rank: HandRank.HighCard,
      value,
      description: 'High Card',
      cards: highCards
    };
  }
  /** Return showdown result: winners array and evaluations by player id */
  public getShowdownData(): {
    winners: Player[];
    evaluations: Map<number, HandEvaluation>;
  } {
    return this.evaluateWinners();
  }
  public getHandEvaluation(playerId: number): HandEvaluation | null {
    const player = this.gameState.players[playerId];
    if (!player) return null;
    const cards = [...player.holeCards, ...this.gameState.communityCards];
    if (cards.length < 5) return null;
    return this.evaluateHand(cards);
  }
  private checkStraight(sortedCards: Card[]): {
    isStraight: boolean;
    cards: Card[];
  } {
    const rankSet = new Set(sortedCards.map(c => c.rank));
    const uniqueRanks = Array.from(rankSet).sort((a, b) => b - a);
    // Regular straight
    for (let i = 0; i <= uniqueRanks.length - 5; i++) {
      let consecutive = true;
      for (let j = 0; j < 4; j++) {
        if (uniqueRanks[i + j] - uniqueRanks[i + j + 1] !== 1) {
          consecutive = false;
          break;
        }
      }
      if (consecutive) {
        const straightCards: Card[] = [];
        for (let j = 0; j < 5; j++) {
          const card = sortedCards.find(c => c.rank === uniqueRanks[i + j]);
          if (card) straightCards.push(card);
        }
        return {
          isStraight: true,
          cards: straightCards
        };
      }
    }
    // Wheel straight (A-2-3-4-5)
    const wheel = [Rank.Ace, Rank.Five, Rank.Four, Rank.Three, Rank.Two];
    if (wheel.every(r => rankSet.has(r))) {
      const wheelCards: Card[] = wheel.map(r => sortedCards.find(c => c.rank === r)).filter((c): c is Card => c !== undefined);
      return {
        isStraight: true,
        cards: wheelCards
      };
    }
    return {
      isStraight: false,
      cards: []
    };
  }
}
